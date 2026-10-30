import json
import time

# Schalter: True für sofortiges lokales Testen, False für echte Gemini-API
USE_MOCK = True

class MockGeminiClient:
    """Simuliert die Gemini-Antwort lokal ohne Netzwerkanfrage."""
    def generate_decision(self, market_listing: dict, agent_budget: int) -> dict:
        print("[MOCK] Analysiere Marktdaten...")
        time.sleep(0.5)  # Kurze Verzögerung zur Simulation
        
        # Simulierte Agenten-Entscheidung als valides JSON
        if market_listing["price_sats"] <= agent_budget:
            return {
                "decision": "BUY",
                "amount_sats": market_listing["price_sats"],
                "reasoning": f"Preis von {market_listing['price_sats']} Sats liegt im Budget ({agent_budget} Sats)."
            }
        return {
            "decision": "SKIP",
            "amount_sats": 0,
            "reasoning": "Angebot übersteigt das verfügbare Budget."
        }

def run_agent_cycle():
    # 1. State / Budget des Agenten
    budget_sats = 1000
    print(f"--- Agent gestartet | Startguthaben: {budget_sats} Sats ---")

    # 2. Wahrnehmung: Simulierte Marktdaten
    mock_listing = {
        "dataset_id": "iot_sensor_munich_01",
        "description": "Temperaturdaten Innenstadt München",
        "price_sats": 450
    }
    print(f"Neues Listing gefunden: {mock_listing['description']} ({mock_listing['price_sats']} Sats)")

    # 3. Brain: Entscheidung treffen
    if USE_MOCK:
        brain = MockGeminiClient()
        result = brain.generate_decision(mock_listing, budget_sats)
    else:
        # Hier greift später der echte API-Call
        pass

    print("\nEntscheidung des Agenten:")
    print(json.dumps(result, indent=2, ensure_ascii=False))

    # 4. Aktion: Transaktion simulieren & State anpassen
    if result["decision"] == "BUY":
        budget_sats -= result["amount_sats"]
        print(f"\n[Aktion] Simuliere BSV-Kauf-Transaktion über {result['amount_sats']} Sats...")
        print(f"[State Update] Neues Restbudget: {budget_sats} Sats")
    else:
        print("\n[Aktion] Kein Kauf getätigt.")

if __name__ == "__main__":
    run_agent_cycle()