"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import countryList from "@/lib/country-list.json";

const FEATURED_COUNTRIES = [
  { iso3: "PAK", label: "PAKISTAN" },
  { iso3: "AUS", label: "AUSTRALIA" },
  { iso3: "USA", label: "USA" },
  { iso3: "CAN", label: "CANADA" },
  { iso3: "BRA", label: "BRAZIL" },
  { iso3: "GRC", label: "GREECE" },
  { iso3: "ESP", label: "SPAIN" },
  { iso3: "PRT", label: "PORTUGAL" },
  { iso3: "IDN", label: "INDONESIA" },
  { iso3: "IND", label: "INDIA" },
  { iso3: "CHL", label: "CHILE" },
  { iso3: "ZAF", label: "S. AFRICA" },
];

export default function CountryPicker({ currentIso3, onSelectCountry, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const inputId = useId();
  const rootRef = useRef(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return countryList;
    return countryList.filter(
      (c) => c.name.toLowerCase().includes(q) || c.iso3.toLowerCase().includes(q),
    );
  }, [search]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
        setSearch("");
      }
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        setSearch("");
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const handleSelect = (country) => {
    setOpen(false);
    setSearch("");
    onSelectCountry?.(country);
  };

  return (
    <div ref={rootRef} className="country-picker" data-open={open}>
      <button
        type="button"
        className="country-picker-btn"
        onClick={() => setOpen((prev) => !prev)}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Switch observation region / country"
      >
        <span className="country-picker-icon" aria-hidden="true">
          🌐
        </span>
        <span className="country-picker-label">Change region</span>
        <span className="country-picker-arrow" aria-hidden="true">
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open && (
        <div className="country-picker-dropdown" role="dialog" aria-label="Select Country">
          <div className="country-picker-search-wrap">
            <label htmlFor={inputId} className="visually-hidden">
              Search country or ISO code
            </label>
            <input
              id={inputId}
              type="text"
              className="country-picker-input"
              placeholder="Search country or ISO code..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
            {search && (
              <button
                type="button"
                className="country-picker-clear-search"
                onClick={() => setSearch("")}
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
          </div>

          <div className="country-picker-featured">
            <span className="country-picker-section-title">ACTIVE FIRE REGIONS</span>
            <div className="country-picker-chips">
              {FEATURED_COUNTRIES.map((feat) => {
                const match = countryList.find((c) => c.iso3 === feat.iso3);
                if (!match) return null;
                const isSelected = match.iso3 === currentIso3;
                return (
                  <button
                    key={match.iso3}
                    type="button"
                    className={`country-chip ${isSelected ? "is-selected" : ""}`}
                    onClick={() => handleSelect(match)}
                    disabled={isSelected || disabled}
                  >
                    {feat.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="country-picker-list-wrap">
            <span className="country-picker-section-title">ALL REGIONS ({filtered.length})</span>
            <ul className="country-picker-list" role="listbox">
              {filtered.map((item) => {
                const isSelected = item.iso3 === currentIso3;
                return (
                  <li key={item.iso3}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      className={`country-picker-item ${isSelected ? "is-selected" : ""}`}
                      onClick={() => handleSelect(item)}
                      disabled={isSelected || disabled}
                    >
                      <span className="country-iso-tag">{item.iso3}</span>
                      <span className="country-name-text">{item.name}</span>
                      {isSelected && <span className="country-current-badge">CURRENT</span>}
                    </button>
                  </li>
                );
              })}
              {filtered.length === 0 && (
                <li className="country-picker-empty">No matching countries found</li>
              )}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
