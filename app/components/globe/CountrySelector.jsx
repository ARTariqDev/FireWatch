"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import countryFlag from "./countryFlag";

const SUGGESTED_CODES = ["PAK", "USA", "IND", "BRA", "AUS", "CAN"];

export default function CountrySelector({ selectedIso3, onSelect, disabled = false }) {
  const rootRef = useRef(null);
  const [countries, setCountries] = useState([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch("/api/countries", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Country list request failed (${response.status}).`);
        return response.json();
      })
      .then((data) => {
        if (!controller.signal.aborted) {
          setCountries(Array.isArray(data) ? data : []);
          setError("");
        }
      })
      .catch((requestError) => {
        if (!controller.signal.aborted) {
          console.error("Country list request failed:", requestError);
          setError(requestError instanceof Error ? requestError.message : "Country list unavailable.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [reload]);

  useEffect(() => {
    const closeOnOutsideClick = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, []);

  const matches = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const candidates = normalizedQuery
      ? countries
      : SUGGESTED_CODES.map((code) => countries.find((country) => country.iso3 === code)).filter(Boolean);

    return candidates
      .filter((country) => !normalizedQuery || `${country.name} ${country.iso2} ${country.iso3}`.toLocaleLowerCase().includes(normalizedQuery))
      .slice(0, normalizedQuery ? 30 : SUGGESTED_CODES.length);
  }, [countries, query]);

  const choose = (country) => {
    setQuery("");
    setOpen(false);
    onSelect(country);
  };

  return (
    <div ref={rootRef} className="country-filter">
      <label className="country-filter-label" htmlFor="country-search">COUNTRY FILTER</label>
      <div className="country-search-wrap">
        <input
          id="country-search"
          type="search"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls="country-options"
          aria-label="Search countries"
          placeholder="Search countries…"
          value={query}
          disabled={disabled}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
            if (event.key === "Enter" && open && matches[0]) {
              event.preventDefault();
              choose(matches[0]);
            }
          }}
        />
        <span className="country-search-icon" aria-hidden="true">⌕</span>
      </div>
      {open && (
        <div className="country-options">
          <p className="country-options-heading">{query.trim() ? "MATCHING COUNTRIES" : "SUGGESTED COUNTRIES"}</p>
          <ul id="country-options" role="listbox" aria-label="Countries">
            {loading ? (
              <li className="country-options-message" role="presentation">Loading country list…</li>
            ) : error ? (
              <li className="country-options-message" role="presentation">
                {error}
                <button type="button" className="country-retry" onClick={() => setReload((value) => value + 1)}>Retry</button>
              </li>
            ) : matches.length ? matches.map((country) => (
              <li key={country.iso3} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={country.iso3 === selectedIso3}
                  className="country-option"
                  disabled={disabled}
                  onClick={() => choose(country)}
                >
                  <span className="country-flag" aria-hidden="true">{countryFlag(country.iso2)}</span>
                  <span>{country.name}</span>
                  <span className="country-iso">{country.iso3}</span>
                </button>
              </li>
            )) : (
              <li className="country-options-message" role="presentation">No countries match “{query}”.</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
