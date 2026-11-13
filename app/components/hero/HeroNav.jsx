function HeroNav() {
  return (
    <header className="hero-nav">
      <a className="firewatch-brand" href="#top" aria-label="Firewatch home">
        <span className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 32 36" fill="none">
            <path
              d="M17.8 2.5c1.1 6.4-5.8 8.3-3.1 14.2 1.5-2.2 3.3-3.5 5.3-4.1 5.4 4.5 7.3 8.4 6.2 13.1-1 4.6-5.1 7.8-10.4 7.8S5.7 29.7 5.7 24.3c0-4.6 2.1-8 6.1-11.4-.2 4.5.7 6.3 2.7 7.1C11.5 12.8 18.3 9.2 17.8 2.5Z"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span className="brand-wordmark">FIREWATCH</span>
        <span className="brand-divider" />
        <span className="brand-descriptor">EARLY SIGNAL SYSTEM</span>
      </a>

      <a
        className="nav-reference"
        href="https://firms.modaps.eosdis.nasa.gov/map/"
        target="_blank"
        rel="noreferrer"
      >
        NASA FIRMS <span aria-hidden="true">↗</span>
      </a>
    </header>
  );
}

export default HeroNav;
