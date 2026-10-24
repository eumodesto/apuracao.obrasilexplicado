import Link from 'next/link';
export function Brand() {
  return (
    <Link className="brand" href="/" aria-label="Resultados Brasil, início">
      {/* Flag of Brazil in its official 10:7 proportions. */}
      <svg className="brand-flag" width="40" height="28" viewBox="0 0 1000 700" aria-hidden="true">
        <defs>
          <clipPath id="brand-flag-globe">
            <circle cx="500" cy="350" r="175" />
          </clipPath>
        </defs>
        <rect width="1000" height="700" rx="70" fill="#009c3b" />
        <path d="M85 350 500 85l415 265-415 265Z" fill="#ffdf00" />
        <circle cx="500" cy="350" r="175" fill="#002776" />
        <path
          d="M300 300c120-30 270-10 375 70"
          clipPath="url(#brand-flag-globe)"
          fill="none"
          stroke="#fff"
          strokeWidth="34"
        />
        <g fill="#fff">
          <circle cx="430" cy="410" r="11" />
          <circle cx="470" cy="440" r="9" />
          <circle cx="520" cy="425" r="10" />
          <circle cx="560" cy="455" r="9" />
          <circle cx="455" cy="480" r="8" />
          <circle cx="505" cy="490" r="11" />
          <circle cx="590" cy="410" r="8" />
          <circle cx="410" cy="455" r="8" />
          <circle cx="540" cy="275" r="10" />
        </g>
      </svg>
      <span>
        Resultados <b>Brasil</b>
        <small>ELEIÇÕES 2026</small>
      </span>
    </Link>
  );
}
