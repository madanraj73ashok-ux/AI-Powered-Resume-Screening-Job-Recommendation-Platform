export function InterviewerAvatar({ level, speaking }: { level: number; speaking: boolean }) {
  return <div className={`avatar-stage ${speaking ? 'is-speaking' : ''}`}>
    <svg viewBox="0 0 600 420" role="img" aria-label="Original illustrated virtual interviewer">
      <defs>
        <linearGradient id="room" x2="1" y2="1"><stop stopColor="#173146"/><stop offset="1" stopColor="#0b1728"/></linearGradient>
        <linearGradient id="jacket" x2="1" y2="1"><stop stopColor="#346a82"/><stop offset="1" stopColor="#16334f"/></linearGradient>
        <radialGradient id="glow"><stop stopColor="#53d5e9" stopOpacity=".18"/><stop offset="1" stopColor="#53d5e9" stopOpacity="0"/></radialGradient>
      </defs>
      <rect width="600" height="420" fill="url(#room)"/>
      <circle cx="300" cy="210" r="240" fill="url(#glow)"/>
      <rect x="38" y="54" width="116" height="185" rx="8" fill="#d8e9ec" opacity=".07"/>
      <path d="M64 209h64M96 80v120M448 247h106M472 247v-76h54v76" stroke="#94c5d5" strokeWidth="5" opacity=".15"/>
      <path d="M499 173q-45-72-29-90 35 25 29 90m0-5q25-96 43-80 5 52-43 80" fill="#43746b" opacity=".7"/>
      <g className="avatar-person">
        <path d="M181 420v-65q5-90 119-95 115 5 120 95v65" fill="url(#jacket)"/>
        <path d="M271 265h58l23 155H247z" fill="#ecf0ef"/>
        <path d="M272 242v42q28 28 56 0v-42" fill="#b97d60"/>
        <path d="M225 195q-34-115 78-122 110 8 74 142l-25 66H245z" fill="#19242d"/>
        <ellipse cx="300" cy="186" rx="65" ry="85" fill="#d09b7b"/>
        <path d="M232 178q9-112 93-91 53 10 45 88-16-8-31-55-50 39-107 58" fill="#202c35"/>
        <path d="M251 165q15-9 30-1m38 0q16-8 29 2" stroke="#4b3430" strokeWidth="5" strokeLinecap="round" fill="none"/>
        <g className="avatar-eyes"><ellipse cx="269" cy="181" rx="7" ry="5" fill="#24303a"/><ellipse cx="333" cy="181" rx="7" ry="5" fill="#24303a"/><circle cx="271" cy="179" r="1.5" fill="white"/><circle cx="335" cy="179" r="1.5" fill="white"/></g>
        <path d="M300 183l-7 25q6 4 13 0" stroke="#b57b61" strokeWidth="3" fill="none" strokeLinecap="round"/>
        <ellipse cx="300" cy="233" rx={speaking ? 13 + level * 5 : 17} ry={speaking ? 2 + level * 12 : 2.5} fill="#834c4a"/>
        <path d="M272 277l-33 34 28 33-16 76m77-143 34 34-28 33 16 76" stroke="#57879c" strokeWidth="3" fill="none"/>
        <circle cx="352" cy="324" r="4" fill="#7be0eb"/>
      </g>
    </svg>
    <span className="participant-tag">Ava · virtual interviewer</span>
  </div>;
}
