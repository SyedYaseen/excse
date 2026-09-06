/** Case-insensitive substring match, the only kind a phone keyboard search needs. */
export function matchesSearch(name, query) {
  return name.toLowerCase().includes(query.trim().toLowerCase())
}
