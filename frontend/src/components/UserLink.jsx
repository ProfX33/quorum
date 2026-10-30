export const shortKey = (key) => `${key.slice(0, 8)}…${key.slice(-6)}`;

export const displayName = (person) => person.name || shortKey(person.identityKey);

export const profileHref = (identityKey) => `#/users/${identityKey}`;

const SIZES = {
  xs: ['w-5', 'text-[0.6rem]'],
  sm: ['w-8', 'text-sm'],
  lg: ['w-24', 'text-4xl'],
};

/** The user's picture, or a circle coloured after their key with the initial of their name. */
export function Avatar({ person, size = 'sm' }) {
  const [width, text] = SIZES[size];
  if (person.avatarUrl) {
    return (
      <div className="avatar shrink-0">
        <div className={`${width} rounded-full`}>
          <img src={person.avatarUrl} alt="" />
        </div>
      </div>
    );
  }
  const hue = parseInt(person.identityKey.slice(2, 8), 16) % 360;
  return (
    <div className="avatar avatar-placeholder shrink-0">
      <div className={`${width} rounded-full text-white`} style={{ background: `hsl(${hue} 40% 40%)` }}>
        <span className={text}>{person.name?.[0]?.toUpperCase() ?? ''}</span>
      </div>
    </div>
  );
}

/** Picture and name of a user, linking to their profile page. */
export function UserLink({ person, you = false, size = 'xs', className = '' }) {
  return (
    <a
      href={profileHref(person.identityKey)}
      title={person.identityKey}
      className={`inline-flex max-w-full items-center gap-1.5 align-middle link link-hover ${className}`}
    >
      <Avatar person={person} size={size} />
      <span className={`truncate ${person.name ? '' : 'font-mono'}`}>
        {displayName(person)}
        {you && ' (you)'}
      </span>
    </a>
  );
}
