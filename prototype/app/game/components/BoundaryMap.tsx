export default function BoundaryMap({complete=false}:{complete?:boolean}) {
 return <div className={`boundary-map ${complete?'complete':''}`}><svg viewBox="0 0 500 250" role="img" aria-label="Schematic boundary around the research district, homes, medical center, workshops and utilities; the island outside is unaffected.">
  <defs><pattern id="mapgrid" width="25" height="25" patternUnits="userSpaceOnUse"><path d="M25 0H0V25" fill="none" stroke="#558186" strokeOpacity=".16"/></pattern></defs>
  <rect width="500" height="250" fill="url(#mapgrid)"/>
  <g fill="none" stroke="#6e8588" strokeWidth="5" opacity=".35"><path d="M80 115H410M160 60V210M310 40V218M80 183H412"/></g>
  <g fill="#29484c" stroke="#73969a" strokeWidth="1"><rect x="87" y="54" width="57" height="43"/><rect x="176" y="50" width="97" height="46"/><rect x="335" y="55" width="64" height="44"/><rect x="84" y="137" width="61" height="28"/><rect x="181" y="135" width="97" height="29"/><rect x="333" y="138" width="65" height="29"/><rect x="184" y="196" width="95" height="23"/></g>
  <path className="boundary-trace" d="M65 37L291 25L425 39L447 185L373 231L110 237L54 193L47 102Z" fill="none" stroke={complete?'#91d9cb':'#e58a62'} strokeWidth="2" strokeDasharray="8 5"/>
  <g fill="#d7e6e5" fontSize="13" fontFamily="monospace"><text x="88" y="79">TOMBS</text><text x="181" y="78">RESEARCH</text><text x="344" y="80">HOMES</text><text x="87" y="156">POWER</text><text x="187" y="155">WORKSHOPS</text><text x="335" y="156">MEDICAL</text></g>
 </svg><span className="map-caption">Settlement schematic · developed zone boundary</span></div>;
}
