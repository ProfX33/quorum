import os
import json
import time
import subprocess
from datetime import datetime, timezone
from typing import Literal, Optional
import requests
from dotenv import load_dotenv
from pydantic import BaseModel, Field
from google import genai
from google.genai import types

# 1. Umgebungsvariablen laden
load_dotenv()

BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:4000")
BUDGET_SATS = int(os.getenv("AGENT_BUDGET_SATS", "10000"))
ESTIMATED_FEE_SATS = int(os.getenv("ESTIMATED_FEE_SATS", "150"))
USE_MOCK_LLM = os.getenv("USE_MOCK_LLM", "False").lower() == "true"
AGENT_WALLET = os.getenv("AGENT_WALLET", "buyer")
BACKEND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend")

# Mission & Suchprofil des Agenten
AGENT_MISSION = {
    "target_region": "Munich",
    "target_categories": ["environment", "weather", "mobility", "sensor"],
    "target_kind": "data",
    "max_willingness_to_pay_sats": 600,  # Absolutes Preislimit pro Datensatz inkl. Fees
    "min_economical_share_sats": 100     # Unter 100 Sats lohnen sich ~150 Sats Fees oft nicht, außer Daten sind kritisch
}

# 2. Verbindliches Output-Schema für Gemini (Pydantic)
class AgentDecision(BaseModel):
    decision: Literal["BID", "SKIP", "WITHDRAW", "CREATE_REQUEST"] = Field(
        description="Die gewählte Aktion für das Marktplatz-Backend."
    )
    offer_id: Optional[str] = Field(
        default=None,
        description="Die UUID des Angebots bei BID, SKIP oder WITHDRAW."
    )
    max_price_sats: Optional[int] = Field(
        default=None,
        description="Maximalgebot in Satoshis (ganzzahlig) für BID oder CREATE_REQUEST."
    )
    reasoning: str = Field(
        description="Kurze, präzise Begründung für die Entscheidung unter Einbezug von Share, Gruppe und Gebühren."
    )


class BuyerAgent:
    def __init__(self):
        self.budget_sats = BUDGET_SATS
        self.token: Optional[str] = None
        self.client = genai.Client() if not USE_MOCK_LLM else None

    # ---------------------------------------------------------
    # AUTHENTIFIZIERUNG (via TypeScript Subprocess)
    # ---------------------------------------------------------
    def cli(self, *args: str) -> dict:
        """Ruft die Agent-CLI auf. Der Private Key bleibt in deren Wallet und landet nie in Python oder LLM-Prompts."""
        result = subprocess.run(
            ["bun", "agent/cli.ts", "--wallet", AGENT_WALLET, *args],
            cwd=BACKEND_DIR,
            capture_output=True,
            text=True,
            timeout=60,
            env={**os.environ, "API_URL": BACKEND_URL},
        )
        data = json.loads(result.stdout)
        if result.returncode != 0:
            raise RuntimeError(data.get("error", result.stderr))
        return data

    def authenticate(self) -> bool:
        """Holt über die Agent-CLI einen gültigen Bearer-Token (BSV Challenge-Response)."""
        print("[Auth] Hole Agent-Token über BSV Challenge-Response...")
        try:
            self.token = self.cli("login")["token"]
            print("[Auth] Erfolgreich eingeloggt!")
            return True
        except Exception as e:
            print(f"[Auth-Fallback] Login fehlgeschlagen ({e}). Arbeite im Read-Only/Mock-Modus.")
            return False

    def get_headers(self) -> dict:
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        return headers

    # ---------------------------------------------------------
    # WAHRNEHMUNG (Sense: GET /api/search)
    # ---------------------------------------------------------
    def fetch_market(self) -> dict:
        """Liest alle offenen und abgeschlossenen Angebote vom Backend."""
        resp = requests.get(
            f"{BACKEND_URL}/api/search",
            params={"status": "all"},
            headers=self.get_headers(),
            timeout=5
        )
        resp.raise_for_status()
        return resp.json()

    # ---------------------------------------------------------
    # HARTE REGELPRÜFUNG (Vorfilter vor dem LLM)
    # ---------------------------------------------------------
    def is_candidate_valid(self, offer: dict) -> tuple[bool, str]:
        """Prüft harte technische Ausschlusskriterien laut Schema."""
        if offer.get("status") != "open":
            return False, f"Status ist '{offer.get('status')}' (nicht open)."
        if offer.get("mine") is True:
            return False, "Eigenes Angebot (mine == True)."
        if offer.get("kind") == "data" and not offer.get("dataHash"):
            return False, "Daten-Angebot enthält keinen verifizierbaren dataHash."

        # Deadline-Check
        deadline_str = offer.get("deadline")
        if deadline_str:
            try:
                dl = datetime.fromisoformat(deadline_str.replace("Z", "+00:00"))
                if dl <= datetime.now(timezone.utc):
                    return False, "Deadline liegt in der Vergangenheit."
            except ValueError:
                pass

        # Falls wir bereits ein ausreichend hohes Gebot abgegeben haben, nicht erneut bieten
        my_bid = offer.get("myBid")
        if my_bid and my_bid.get("status") == "open":
            current_share = offer.get("share", offer.get("price", 0))
            if my_bid.get("maxPrice", 0) >= current_share:
                return False, f"Bereits aktives Gebot ({my_bid.get('maxPrice')} Sats) deckt aktuellen Share ({current_share} Sats)."

        return True, "Valider Kandidat"

    # ---------------------------------------------------------
    # GEHIRN (Think: Gemini Structured Decision + Fallback)
    # ---------------------------------------------------------
    def evaluate_offer_with_gemini(self, offer: dict) -> AgentDecision:
        """Übergibt das Angebot und die Abrechnungsregeln an Gemini und erzwingt das JSON-Schema."""
        system_instruction = f"""
Du bist ein autonomer Buyer-Agent auf einem dezentralen BSV-Gruppenkauf-Marktplatz.
Deine Mission: Kaufe kontinuierlich Daten gemäß diesem Profil: {json.dumps(AGENT_MISSION, ensure_ascii=False)}

WICHTIGE MARKTPLATZ- UND ABRECHNUNGSREGELN (settlement.ts):
1. Verkäufer listen Angebote zu einem Gesamt-Festpreis (`price` in Satoshis).
2. Käufer geben nur ein geheimes Maximalgebot (`max_price_sats`) ab.
3. Bei der Abrechnung wird `price` gleichmäßig auf alle Bieter (`payers`) aufgeteilt (Abrunden + Rest auf die höchsten Gebote). `share` zeigt den aktuellen Preis pro Kopf.
4. Wer ein `max_price_sats` unter dem finalen Anteil hat, geht leer aus. Du zahlst am Ende nie mehr als deinen Anteil (`share`) und nie mehr als dein `max_price_sats`.
   Dein gesamtes Gebot wird sofort hinterlegt (Pledge); nicht benötigte Sats bekommst du danach zurück.
5. TRANSAKTIONSGEBÜHREN BEACHTEN: Jede echte BSV-Zahlung kostet ca. {ESTIMATED_FEE_SATS} Sats an Miner-/Wallet-Gebühren!
   - Dein verfügbares Gesamtbudget beträgt aktuell: {self.budget_sats} Sats.
   - Dein Gebot (`max_price_sats`) PLUS {ESTIMATED_FEE_SATS} Sats Gebühr darf dein Budget und deine maximale Zahlungsbereitschaft ({AGENT_MISSION['max_willingness_to_pay_sats']} Sats) NICHT überschreiten.
   - Wenn ein Angebot bereits ein unsinniges eigenes Gebot hat (`myBid` vorhanden, aber Preis/Nutzen unrentabel), wähle `WITHDRAW`.
"""
        user_prompt = f"Bewerte folgendes Marktplatz-Angebot und triff eine Entscheidung:\n{json.dumps(offer, indent=2, ensure_ascii=False)}"

        if not USE_MOCK_LLM and self.client:
            candidate_models = ["gemini-flash-latest", "gemini-3.8-flash", "gemini-3.6-flash"]
            for model_name in candidate_models:
                try:
                    print(f"[Brain] Frage {model_name} nach Bewertung für Offer '{offer['name']}'...")
                    response = self.client.models.generate_content(
                        model=model_name,
                        contents=user_prompt,
                        config=types.GenerateContentConfig(
                            system_instruction=system_instruction,
                            response_mime_type="application/json",
                            response_schema=AgentDecision,
                            temperature=0.1,
                        ),
                    )
                    return AgentDecision.model_validate_json(response.text)
                except Exception as e:
                    print(f"[LLM-Warnung] {model_name} nicht verfügbar ({e}). Wechsle Fallback...")

        # Deterministischer Fallback (falls API 503 hat oder USE_MOCK_LLM=True)
        print("[Brain-Fallback] Berechne Entscheidung über lokales Regelwerk...")
        max_net_bid = AGENT_MISSION["max_willingness_to_pay_sats"] - ESTIMATED_FEE_SATS
        projected_share = offer["price"] // (offer.get("payers", 0) + 1)

        if (
            offer.get("region", "").lower() == AGENT_MISSION["target_region"].lower()
            and projected_share <= max_net_bid
            and ( max_net_bid + ESTIMATED_FEE_SATS ) <= self.budget_sats
        ):
            return AgentDecision(
                decision="BID",
                offer_id=offer["id"],
                max_price_sats=max_net_bid,
                reasoning=(
                    f"Angebot passt auf Zielregion {offer.get('region')}. "
                    f"Erwarteter Gruppen-Share (~{projected_share} Sats) liegt unter unserem Netto-Limit "
                    f"von {max_net_bid} Sats (inkl. {ESTIMATED_FEE_SATS} Sats Gebührenpuffer)."
                )
            )
        return AgentDecision(
            decision="SKIP",
            offer_id=offer["id"],
            max_price_sats=0,
            reasoning="Angebot passt nicht ins Suchprofil oder übersteigt unser Budget inkl. Transaktionsgebühren."
        )

    # ---------------------------------------------------------
    # AKTION (Act: REST-Calls ans Backend)
    # ---------------------------------------------------------
    def execute_decision(self, decision: AgentDecision):
        """Setzt die LLM-Entscheidung in die entsprechenden REST-Calls um."""
        print("\n[Entscheidung]:")
        print(json.dumps(decision.model_dump(), indent=2, ensure_ascii=False))

        if decision.decision == "SKIP":
            print("[Act] Überspringe Angebot.")
            return

        if decision.decision == "BID" and decision.offer_id and decision.max_price_sats:
            url = f"{BACKEND_URL}/api/offers/{decision.offer_id}/bid"
            payload = {"maxPrice": decision.max_price_sats}
            try:
                resp = requests.post(url, json=payload, headers=self.get_headers(), timeout=5)
                if resp.status_code in (200, 201):
                    print(f"[Act-Erfolg] Gebot über max. {decision.max_price_sats} Sats für {decision.offer_id} platziert!")
                    # Nur hinterlegtes Geld zählt zur Deadline, also sofort pledgen.
                    if self.trigger_bsv_payment(resp.json()["id"], decision.max_price_sats):
                        self.budget_sats -= decision.max_price_sats + ESTIMATED_FEE_SATS
                else:
                    print(f"[Act-Info] Backend-Antwort ({resp.status_code}): {resp.text}")
            except Exception as e:
                print(f"[Act-Simulation] Backend offline – hätte gesendet: POST {url} mit {payload} ({e})")

        elif decision.decision == "WITHDRAW" and decision.offer_id:
            url = f"{BACKEND_URL}/api/offers/{decision.offer_id}/bid"
            try:
                resp = requests.delete(url, headers=self.get_headers(), timeout=5)
                print(f"[Act] Gebot zurückgezogen (Status {resp.status_code}).")
            except Exception as e:
                print(f"[Act-Simulation] Hätte gesendet: DELETE {url} ({e})")

        elif decision.decision == "CREATE_REQUEST" and decision.max_price_sats:
            url = f"{BACKEND_URL}/api/requests"
            payload = {
                "kind": "data",
                "category": "environment",
                "region": AGENT_MISSION["target_region"],
                "name": "Suche Umweltdaten München",
                "description": "Automatisiertes Kaufgesuch des Buyer-Agenten für Münchner Sensordaten.",
                "maxPrice": decision.max_price_sats,
                "deadline": "2026-12-31T23:59:59Z"
            }
            try:
                resp = requests.post(url, json=payload, headers=self.get_headers(), timeout=5)
                print(f"[Act] Suchauftrag angelegt (Status {resp.status_code}).")
            except Exception as e:
                print(f"[Act-Simulation] Hätte gesendet: POST {url} mit {payload} ({e})")

    # ---------------------------------------------------------
    # ABHOLUNG GELIEFERTER DATEN (gezahlt wird automatisch aus dem Pledge)
    # ---------------------------------------------------------
    def check_settlements_and_pay(self, offers: list[dict]):
        """Prüft abgerechnete Angebote: gelieferte Daten abholen, Unbenutztes zurückholen."""
        for offer in offers:
            offer_id = offer.get("id")
            my_bid = offer.get("myBid")
            if not my_bid:
                continue

            status = my_bid.get("status")
            refundable = my_bid.get("refundable", 0)

            if refundable > 0:
                try:
                    self.cli("refund", my_bid["id"])
                    self.budget_sats += refundable
                    print(f"[Rückgabe] {refundable} Sats aus '{offer.get('name')}' zurückgeholt.")
                except Exception as e:
                    print(f"[Rückgabe-Warnung] Fehlgeschlagen ({e}).")

            if status == "delivered":
                try:
                    saved = self.cli("download", my_bid["id"])
                    print(f"[Lieferung] '{offer.get('name')}' entschlüsselt: {saved['file']} ({saved['bytes']} Bytes)")
                except Exception as e:
                    print(f"[Lieferung-Warnung] Download fehlgeschlagen ({e}).")

    def trigger_bsv_payment(self, bid_id: str, amount_sats: int) -> bool:
        """Pledged das Gebot. Die Zahlung geht erst raus, wenn die Gruppe den Preis deckt."""
        print(f"[BSV-Chain] Pledge über {amount_sats} Sats für Gebot {bid_id}...")
        try:
            result = self.cli("pay", bid_id)
            print(f"[BSV-Chain Erfolg]: Status {result['status']}, {result['pledged']}/{result['amount']} Sats gepledged.")
            return True
        except Exception as e:
            print(f"[BSV-Chain Fehler]: {e}")
            return False

    # ---------------------------------------------------------
    # HAUPTSCHLEIFE (Sense -> Think -> Act)
    # ---------------------------------------------------------
    def run_once(self):
        print(f"\n=======================================================")
        print(f" Starte Agent-Zyklus | Verfügbares Budget: {self.budget_sats} Sats")
        print(f"=======================================================")

        try:
            market_data = self.fetch_market()
        except Exception as e:
            print(f"[Markt-Fehler] Backend ({BACKEND_URL}) konnte nicht abgefragt werden: {e}")
            print("[Info] Zyklus wird ohne Marketplace-Entscheidungen beendet.")
            return
        offers = market_data.get("offers", [])

        # 1. Prüfe zuerst, ob vergangene Gebote gewonnen haben (Settlement)
        self.check_settlements_and_pay(offers)

        # 2. Suche nach neuen, validen Kaufkandidaten
        valid_candidates = []
        for offer in offers:
            is_valid, reason = self.is_candidate_valid(offer)
            if is_valid:
                valid_candidates.append(offer)
            else:
                print(f"[Filter] Überspringe '{offer.get('name')}': {reason}")

        # 3. Bewerte valide Angebote mit Gemini
        if not valid_candidates:
            print("[Info] Keine neuen offenen Angebote gefunden.")
            return

        for candidate in valid_candidates:
            decision = self.evaluate_offer_with_gemini(candidate)
            self.execute_decision(decision)


if __name__ == "__main__":
    agent = BuyerAgent()
    agent.authenticate()
    # Für den ersten Test führen wir einen einzelnen Durchlauf aus.
    # Für Dauerbetrieb im Pitch einfach in eine while True Schleife mit time.sleep(5) setzen!
    agent.run_once()