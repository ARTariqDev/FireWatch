export default function countryFlag(iso2) {
  if (typeof iso2 !== "string" || !/^[A-Z]{2}$/i.test(iso2)) return "";
  return String.fromCodePoint(...iso2.toUpperCase().split("").map((letter) => 127397 + letter.charCodeAt(0)));
}
