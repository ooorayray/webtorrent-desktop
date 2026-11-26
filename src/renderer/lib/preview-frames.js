// Scrubber thumbnail previews.
//
// Decoding a video frame on every mousemove is too slow to follow the mouse,
// so instead:
//
//   * Time is split into BUCKET_SECONDS slots. Each slot is decoded at most
//     once, by seeking a hidden <video>, and the frame is copied into a small
//     thumbnail-sized canvas that is cached (LRU, MAX_FRAMES entries).
//   * The visible preview <canvas> shows the cached frame for the slot under
//     the mouse. While that slot is still being decoded, it shows the nearest
//     slot that is already cached, so the preview never freezes.
//   * Only one seek runs at a time. When it finishes we jump straight to
//     wherever the mouse is now, skipping slots it passed over. New seeks
//     start at most every MIN_SEEK_INTERVAL ms.

module.exports = {
  show,
  hide
}

const BUCKET_SECONDS = 0.25
const MAX_FRAMES = 600 // ~150 KB each at 2x DPI: ~90 MB worst case
const MIN_SEEK_INTERVAL = 30 // ms
const SEEK_STUCK = 250 // ms: stop waiting on a seek (eg. no torrent data yet)
const RETRY_FAILED = 1000 // ms: don't retry a slot that failed to decode sooner
const THUMB_HEIGHT = 70 // css px, matches the preview box in player-page.js

const s = {
  video: null, // hidden <video> used for decoding
  src: null, // its src, to reset the cache when the file changes
  frames: new Map(), // bucket -> canvas, in LRU order (oldest first)
  failed: new Map(), // bucket -> time it failed to decode
  want: null, // bucket under the mouse
  pending: null, // bucket being decoded right now
  seekStartedAt: 0,
  timer: null,
  rafPending: false
}

// Shows the frame for `time` (seconds) in canvas#preview-canvas,
// decoding it with `video` if needed
function show (video, time) {
  if (!video || !Number.isFinite(time)) return
  attach(video)

  const duration = Number.isFinite(video.duration) ? video.duration : Infinity
  const lastBucket = Math.max(0, Math.floor(duration / BUCKET_SECONDS))
  s.want = Math.min(Math.max(Math.round(time / BUCKET_SECONDS), 0), lastBucket)

  scheduleDraw()
  pump()
}

// Mouse left the scrubber: stop decoding new frames (keep the cache)
function hide () {
  s.want = null
}

function attach (video) {
  if (s.video === video && s.src === video.src) return
  if (s.video) {
    s.video.removeEventListener('seeked', onSeeked)
    s.video.removeEventListener('loadeddata', pump)
  }
  video.addEventListener('seeked', onSeeked)
  video.addEventListener('loadeddata', pump)
  s.video = video
  s.src = video.src
  s.frames.clear()
  s.failed.clear()
  s.pending = null
  s.seekStartedAt = 0
}

// Starts decoding the wanted slot, if it isn't cached and nothing else is running
function pump () {
  const video = s.video
  if (!video || s.want === null) return
  const bucket = s.want
  if (s.frames.has(bucket)) return
  if (video.readyState < 1) return // No metadata yet: 'loadeddata' calls us again

  const failedAt = s.failed.get(bucket)
  if (failedAt && Date.now() - failedAt < RETRY_FAILED) return

  const elapsed = Date.now() - s.seekStartedAt
  // A seek is still decoding: wait for its 'seeked' event, which calls us again
  if (s.pending !== null && elapsed < SEEK_STUCK) return
  // Rate limit, but always catch up to the latest position afterwards
  if (elapsed < MIN_SEEK_INTERVAL) {
    if (!s.timer) {
      s.timer = setTimeout(() => {
        s.timer = null
        pump()
      }, MIN_SEEK_INTERVAL - elapsed)
    }
    return
  }

  s.pending = bucket
  s.seekStartedAt = Date.now()
  video.currentTime = bucket * BUCKET_SECONDS
}

function onSeeked () {
  const bucket = s.pending
  s.pending = null
  if (bucket !== null && !s.frames.has(bucket)) capture(bucket)
  pump()
}

// Copies the hidden video's current frame into a thumbnail-sized canvas
function capture (bucket) {
  const video = s.video
  if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
    s.failed.set(bucket, Date.now())
    return
  }

  const dpr = window.devicePixelRatio || 1
  const height = Math.round(THUMB_HEIGHT * dpr)
  const width = Math.round(height * video.videoWidth / video.videoHeight)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d').drawImage(video, 0, 0, width, height)

  s.failed.delete(bucket)
  s.frames.set(bucket, canvas)
  if (s.frames.size > MAX_FRAMES) {
    s.frames.delete(s.frames.keys().next().value) // Evict least recently used
  }
  scheduleDraw()
}

function scheduleDraw () {
  if (s.rafPending) return
  s.rafPending = true
  window.requestAnimationFrame(() => {
    s.rafPending = false
    draw()
  })
}

// Draws the wanted slot's frame, or the nearest cached one while it decodes
function draw () {
  const target = document.querySelector('canvas#preview-canvas')
  if (!target || s.want === null) return

  let bucket = s.want
  let frame = s.frames.get(bucket)
  if (!frame) {
    let bestDistance = Infinity
    for (const [b, f] of s.frames) {
      const d = Math.abs(b - s.want)
      if (d < bestDistance) {
        bestDistance = d
        bucket = b
        frame = f
      }
    }
  }
  if (!frame) return

  // Mark as recently used
  s.frames.delete(bucket)
  s.frames.set(bucket, frame)

  if (target.width !== frame.width || target.height !== frame.height) {
    target.width = frame.width
    target.height = frame.height
  }
  target.getContext('2d').drawImage(frame, 0, 0)
}
