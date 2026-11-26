// Fuzzy search over torrent names and the names of the files inside them.
//
// Every word in the query has to match somewhere (the torrent name or one of
// its file names). Each query word is scored against each word of the text:
//
//   * word prefix match ("bun" in "Big Buck Bunny")      -> best
//   * substring match in the middle of a word            -> good
//   * typo-tolerant prefix match ("bunyn" ~ "bunny")     -> ok, worse per edit
//
// The number of typos allowed grows with the length of the query word, so
// short queries stay precise and long ones are forgiving.

module.exports = {
  searchTorrents,
  scoreTorrent,
  normalize,
  maxEdits,
  prefixEditDistance
}

const NAME_WEIGHT = 1
const FILE_WEIGHT = 0.6 // A match in the torrent's own name beats one in a file

// Lowercase, strip accents, and treat the separators common in torrent and file
// names (dots, underscores, dashes, brackets, ...) as spaces
function normalize (str) {
  return (str || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function tokenize (str) {
  const s = normalize(str)
  return s ? s.split(' ') : []
}

// How many typos to tolerate for a query word of a given length
function maxEdits (len) {
  if (len <= 3) return 0
  if (len <= 5) return 1
  if (len <= 8) return 2
  return 3
}

// Optimal-string-alignment (Damerau-Levenshtein) distance between `query` and
// the closest *prefix* of `word`, so "bunn" matches "bunny" with 0 edits and
// "bnuny" matches "bunny" with 1 (a transposition). Gives up early, returning
// Infinity, once the distance must exceed `limit`.
function prefixEditDistance (query, word, limit = Infinity) {
  const n = query.length
  const m = word.length
  if (n === 0) return 0
  if (n - m > limit) return Infinity

  let prevPrev = null
  let prev = new Array(m + 1)
  for (let j = 0; j <= m; j++) prev[j] = j

  for (let i = 1; i <= n; i++) {
    const cur = new Array(m + 1)
    cur[0] = i
    let rowMin = cur[0]
    for (let j = 1; j <= m; j++) {
      const cost = query[i - 1] === word[j - 1] ? 0 : 1
      let d = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      if (i > 1 && j > 1 && query[i - 1] === word[j - 2] && query[i - 2] === word[j - 1]) {
        d = Math.min(d, prevPrev[j - 2] + 1)
      }
      cur[j] = d
      if (d < rowMin) rowMin = d
    }
    if (rowMin > limit) return Infinity
    prevPrev = prev
    prev = cur
  }

  // Best over all prefixes of `word` = min of the last row
  let best = Infinity
  for (let j = 0; j <= m; j++) if (prev[j] < best) best = prev[j]
  return best
}

// Scores one query word against the words of a text. Returns 0 for no match.
function scoreToken (token, words, joined) {
  let best = 0
  const allowed = maxEdits(token.length)

  for (let i = 0; i < words.length; i++) {
    const word = words[i]
    let score = 0
    if (word.startsWith(token)) {
      score = 100
      if (word.length === token.length) score += 10 // Whole word
      if (i === 0) score += 5 // Start of the name
    } else if (allowed > 0) {
      const d = prefixEditDistance(token, word, allowed)
      if (d <= allowed) score = 60 - 15 * d
    }
    if (score > best) best = score
    if (best >= 115) break
  }

  // Not at a word boundary, but contained somewhere ("ny" in "bunny")
  if (best < 50 && token.length >= 2 && joined.includes(token)) best = 50

  return best
}

// Caches normalized words per string, since names don't change while typing
const textCache = new Map()
function prepare (text) {
  let entry = textCache.get(text)
  if (!entry) {
    const words = tokenize(text)
    entry = { words, joined: words.join(' ') }
    if (textCache.size > 20000) textCache.clear()
    textCache.set(text, entry)
  }
  return entry
}

function scoreText (tokens, text) {
  if (!text) return null
  const { words, joined } = prepare(text)
  return tokens.map((t) => scoreToken(t, words, joined))
}

// Returns { score, matchedFiles } or null if the torrent doesn't match.
// matchedFiles lists the indexes of files whose names matched the query.
function scoreTorrent (torrentSummary, queryOrTokens) {
  const tokens = Array.isArray(queryOrTokens) ? queryOrTokens : tokenize(queryOrTokens)
  if (tokens.length === 0) return { score: 0, matchedFiles: [] }

  const best = (scoreText(tokens, torrentSummary.name) || tokens.map(() => 0))
    .map((s) => s * NAME_WEIGHT)

  // A file name counts on its own when it matches the *whole* query, and also
  // fills in for individual words the torrent name is missing
  const matchedFiles = []
  let bestFileTotal = 0
  const files = torrentSummary.files || []
  for (let i = 0; i < files.length; i++) {
    const scores = scoreText(tokens, files[i].name)
    if (!scores) continue
    let allMatch = true
    let total = 0
    scores.forEach((s, k) => {
      if (s === 0) allMatch = false
      total += s
      if (s * FILE_WEIGHT > best[k]) best[k] = s * FILE_WEIGHT
    })
    if (allMatch) {
      matchedFiles.push(i)
      if (total > bestFileTotal) bestFileTotal = total
    }
  }

  if (best.some((s) => s === 0)) return null
  const combined = best.reduce((a, b) => a + b, 0)
  const score = Math.max(combined, bestFileTotal * FILE_WEIGHT)
  return { score, matchedFiles }
}

// Filters torrents by the query and orders them by relevance (best first).
// Ties keep their original order. Returns the torrents unchanged for an empty query.
function searchTorrents (torrents, query) {
  const tokens = tokenize(query)
  if (tokens.length === 0) return torrents
  return torrents
    .map((t, i) => ({ t, i, match: scoreTorrent(t, tokens) }))
    .filter((x) => x.match)
    .sort((a, b) => (b.match.score - a.match.score) || (a.i - b.i))
    .map((x) => x.t)
}
