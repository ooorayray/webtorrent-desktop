const React = require('react')
const prettyBytes = require('prettier-bytes')

const Checkbox = require('material-ui/Checkbox').default
const LinearProgress = require('material-ui/LinearProgress').default

const TorrentSummary = require('../lib/torrent-summary')
const TorrentPlayer = require('../lib/torrent-player')
const { dispatch, dispatcher } = require('../lib/dispatcher')
const { calculateEta } = require('../lib/time')
const Search = require('../lib/search')

module.exports = class TorrentList extends React.Component {
  render () {
    const state = this.props.state

    const contents = []
    if (state.downloadPathStatus === 'missing') {
      contents.push(
        <div key='torrent-missing-path'>
          <p>Download path missing: {state.saved.prefs.downloadPath}</p>
          <p>Check that all drives are connected?</p>
          <p>Alternatively, choose a new download path
            in <a href='#' onClick={dispatcher('preferences')}>Preferences</a>
          </p>
        </div>
      )
    }
    const prefs = state.saved.prefs
    const isCompact = prefs.torrentListView === 'compact'

    let torrents = state.saved.torrents
    if (prefs.showFavoritesOnly) {
      torrents = torrents.filter((s) => s.favorite)
      if (torrents.length === 0) {
        contents.push(
          <div key='no-favorites' className='torrent-list-empty'>
            <p>No favorite torrents yet. Click the <i className='icon'>star_border</i> on
              a torrent to add it to your favorites, or
              {' '}<a href='#' onClick={dispatcher('toggleShowFavoritesOnly')}>show all torrents</a>.
            </p>
          </div>
        )
      }
    }

    // Search: filter by torrent and file names, best matches first
    const query = state.search.query.trim()
    const isSearching = query !== ''
    const sortByRelevance = isSearching && !(isCompact && state.search.sortByColumn)
    if (isSearching) {
      const total = torrents.length
      torrents = Search.searchTorrents(torrents, query)
      if (total > 0 && torrents.length === 0) {
        contents.push(
          <div key='no-search-results' className='torrent-list-empty'>
            <p>No torrents or files match “{query}”.
              {' '}<a href='#' onClick={dispatcher('setSearchQuery', '')}>Clear search</a>
            </p>
          </div>
        )
      }
    }

    if (isCompact) {
      if (!sortByRelevance) {
        torrents = sortTorrents(torrents, prefs.torrentListSortBy, prefs.torrentListSortDesc)
      }
      if (torrents.length > 0) contents.push(this.renderCompactHeader(sortByRelevance))
      contents.push(...torrents.map((s) => this.renderCompactTorrent(s)))
    } else {
      contents.push(...torrents.map((s) => this.renderTorrent(s)))
    }

    contents.push(
      <div key='torrent-placeholder' className='torrent-placeholder'>
        <span className='ellipsis'>Drop a torrent file here or paste a magnet link</span>
      </div>
    )

    return (
      <div
        key='torrent-list'
        className={'torrent-list' + (isCompact ? ' compact' : '')}
        onContextMenu={dispatcher('openTorrentListContextMenu')}
      >
        {contents}
      </div>
    )
  }

  renderTorrent (torrentSummary) {
    const state = this.props.state
    const infoHash = torrentSummary.infoHash
    const isSelected = infoHash && state.selectedInfoHash === infoHash

    // Background image: show some nice visuals, like a frame from the movie, if possible
    const style = {}
    if (torrentSummary.posterFileName) {
      const gradient = 'linear-gradient(to bottom, rgba(0, 0, 0, 0.4) 0%, rgba(0, 0, 0, 0.4) 100%)'
      const posterPath = TorrentSummary.getPosterPath(torrentSummary)
      style.backgroundImage = `${gradient}, url('${posterPath}')`
    }

    // Foreground: name of the torrent, basic info like size, play button,
    // cast buttons if available, and delete
    const classes = ['torrent']
    if (isSelected) classes.push('selected')
    if (!infoHash) classes.push('disabled')
    if (torrentSummary.favorite) classes.push('is-favorite')
    if (!torrentSummary.torrentKey) throw new Error('Missing torrentKey')
    return (
      <div
        id={torrentSummary.testID && ('torrent-' + torrentSummary.testID)}
        key={torrentSummary.torrentKey}
        style={style}
        className={classes.join(' ')}
        onContextMenu={infoHash && dispatcher('openTorrentContextMenu', infoHash)}
        onClick={infoHash && dispatcher('toggleSelectTorrent', infoHash)}
      >
        {this.renderTorrentMetadata(torrentSummary)}
        {infoHash ? renderFavoriteButton(torrentSummary) : null}
        {infoHash ? this.renderTorrentButtons(torrentSummary) : null}
        {isSelected ? this.renderTorrentDetails(torrentSummary) : null}
        <hr />
      </div>
    )
  }

  // Compact list: clickable column headers to sort by
  renderCompactHeader (sortByRelevance) {
    const prefs = this.props.state.saved.prefs
    // While searching, rows are ranked by relevance until a column is clicked
    const sortBy = sortByRelevance ? null : prefs.torrentListSortBy
    const arrow = prefs.torrentListSortDesc ? 'arrow_drop_down' : 'arrow_drop_up'
    const col = (key, label) => (
      <div
        key={key}
        className={'col col-' + key + ' sortable' + (sortBy === key ? ' sorted' : '')}
        onClick={dispatcher('setTorrentListSort', key)}
        title={'Sort by ' + label.toLowerCase()}
      >
        {label}
        {sortBy === key ? <i className='icon sort-arrow'>{arrow}</i> : null}
      </div>
    )
    return (
      <div key='compact-header' className='torrent-compact-header'>
        <div className='col col-favorite' />
        <div className='col col-toggle' />
        {col('name', 'Name')}
        {col('status', 'Status')}
        <div className='col col-progress'>Progress</div>
        <div className='col col-size'>Size</div>
        {col('dateAdded', 'Date Added')}
        <div className='col col-play' />
        <div className='col col-remove' />
      </div>
    )
  }

  // Compact list: one torrent per line, no poster image
  renderCompactTorrent (torrentSummary) {
    const state = this.props.state
    const infoHash = torrentSummary.infoHash
    const isSelected = infoHash && state.selectedInfoHash === infoHash
    if (!torrentSummary.torrentKey) throw new Error('Missing torrentKey')

    const classes = ['torrent', 'compact']
    if (isSelected) classes.push('selected')
    if (!infoHash) classes.push('disabled')
    if (torrentSummary.error) classes.push('error')

    const name = torrentSummary.name || 'Loading torrent...'
    const status = getListStatus(torrentSummary)
    const prog = torrentSummary.progress
    const percent = prog ? Math.floor(100 * prog.progress) + '%' : (torrentSummary.done ? '100%' : '')
    const length = (prog && prog.length) || getTotalLength(torrentSummary)

    let speeds = ''
    if (prog && torrentSummary.status !== 'paused') {
      if (prog.downloadSpeed > 0) speeds += ' ↓ ' + prettyBytes(prog.downloadSpeed) + '/s'
      if (prog.uploadSpeed > 0) speeds += ' ↑ ' + prettyBytes(prog.uploadSpeed) + '/s'
    }

    let playButton
    if (infoHash && !torrentSummary.error && TorrentPlayer.isPlayableTorrentSummary(torrentSummary)) {
      playButton = (
        <i
          key='play-button'
          title='Start streaming'
          className='icon play'
          onClick={dispatcher('playFile', infoHash)}
        >
          play_arrow
        </i>
      )
    }

    return (
      <div
        id={torrentSummary.testID && ('torrent-' + torrentSummary.testID)}
        key={torrentSummary.torrentKey}
        className={classes.join(' ')}
        onContextMenu={infoHash && dispatcher('openTorrentContextMenu', infoHash)}
        onClick={infoHash && dispatcher('toggleSelectTorrent', infoHash)}
      >
        <div className='torrent-compact-row'>
          <div className='col col-favorite'>
            {infoHash ? renderFavoriteButton(torrentSummary) : null}
          </div>
          <div className='col col-toggle'>
            {infoHash && !torrentSummary.error ? renderTorrentCheckbox(torrentSummary) : null}
          </div>
          <div className='col col-name ellipsis' title={name}>{name}</div>
          <div className={'col col-status ellipsis status-' + status.key}>
            {status.label}
            {torrentSummary.error ? renderRetryButton(torrentSummary) : null}
          </div>
          <div className='col col-progress ellipsis' title={speeds.trim()}>
            {percent}{speeds ? <span className='speeds'>{speeds}</span> : null}
          </div>
          <div className='col col-size ellipsis'>{length ? prettyBytes(length) : ''}</div>
          <div className='col col-dateAdded ellipsis' title={formatDate(torrentSummary.dateAdded, true)}>
            {formatDate(torrentSummary.dateAdded)}
          </div>
          <div className='col col-play'>{playButton}</div>
          <div className='col col-remove'>
            {infoHash
              ? (
                <i
                  key='delete-button'
                  className='icon delete'
                  title='Remove torrent'
                  onClick={dispatcher('confirmDeleteTorrent', infoHash, false)}
                >
                  close
                </i>
                )
              : null}
          </div>
        </div>
        {isSelected ? this.renderTorrentDetails(torrentSummary) : null}
      </div>
    )
  }

  // Show name, download status, % complete
  renderTorrentMetadata (torrentSummary) {
    const name = torrentSummary.name || 'Loading torrent...'
    const elements = [(
      <div key='name' className='name ellipsis'>{name}</div>
    )]

    // If it's downloading/seeding then show progress info
    const prog = torrentSummary.progress
    let progElems
    if (torrentSummary.error) {
      progElems = [getErrorMessage(torrentSummary)]
    } else if (torrentSummary.status !== 'paused' && prog) {
      progElems = [
        renderDownloadCheckbox(),
        renderTorrentStatus(),
        renderProgressBar(),
        renderPercentProgress(),
        renderTotalProgress(),
        renderPeers(),
        renderSpeeds(),
        renderEta()
      ]
    } else {
      progElems = [
        renderDownloadCheckbox(),
        renderTorrentStatus()
      ]
    }
    elements.push(
      <div key='progress-info' className='ellipsis'>
        {progElems}
      </div>
    )

    return (<div key='metadata' className='metadata'>{elements}</div>)

    function renderDownloadCheckbox () {
      return renderTorrentCheckbox(torrentSummary)
    }

    function renderProgressBar () {
      const progress = Math.floor(100 * prog.progress)
      const styles = {
        wrapper: {
          display: 'inline-block',
          marginRight: 8
        },
        progress: {
          height: 8,
          width: 30
        }
      }
      return (
        <div key='progress-bar' style={styles.wrapper}>
          <LinearProgress style={styles.progress} mode='determinate' value={progress} />
        </div>
      )
    }

    function renderPercentProgress () {
      const progress = Math.floor(100 * prog.progress)
      return (<span key='percent-progress'>{progress}%</span>)
    }

    function renderTotalProgress () {
      const downloaded = prettyBytes(prog.downloaded)
      const total = prettyBytes(prog.length || 0)
      if (downloaded === total) {
        return (<span key='total-progress'>{downloaded}</span>)
      } else {
        return (<span key='total-progress'>{downloaded} / {total}</span>)
      }
    }

    function renderPeers () {
      if (prog.numPeers === 0) return
      const count = prog.numPeers === 1 ? 'peer' : 'peers'
      return (<span key='peers'>{prog.numPeers} {count}</span>)
    }

    function renderSpeeds () {
      let str = ''
      if (prog.downloadSpeed > 0) str += ' ↓ ' + prettyBytes(prog.downloadSpeed) + '/s'
      if (prog.uploadSpeed > 0) str += ' ↑ ' + prettyBytes(prog.uploadSpeed) + '/s'
      if (str === '') return
      return (<span key='download'>{str}</span>)
    }

    function renderEta () {
      const downloaded = prog.downloaded
      const total = prog.length || 0
      const missing = total - downloaded
      const downloadSpeed = prog.downloadSpeed
      if (downloadSpeed === 0 || missing === 0) return

      const etaStr = calculateEta(missing, downloadSpeed)

      return (<span key='eta'>{etaStr}</span>)
    }

    function renderTorrentStatus () {
      let status
      if (torrentSummary.status === 'paused') {
        if (!torrentSummary.progress) status = ''
        else if (torrentSummary.progress.progress === 1) status = 'Not seeding'
        else status = 'Paused'
      } else if (torrentSummary.status === 'downloading') {
        if (!torrentSummary.progress) status = ''
        else if (!torrentSummary.progress.ready) status = 'Verifying'
        else status = 'Downloading'
      } else if (torrentSummary.status === 'seeding') {
        status = 'Seeding'
      } else { // torrentSummary.status is 'new' or something unexpected
        status = ''
      }
      return (<span key='torrent-status'>{status}</span>)
    }
  }

  // Download button toggles between torrenting (DL/seed) and paused
  // Play button starts streaming the torrent immediately, unpausing if needed
  renderTorrentButtons (torrentSummary) {
    const infoHash = torrentSummary.infoHash

    // Only show the play/dowload buttons for torrents that contain playable media
    let playButton
    if (!torrentSummary.error && TorrentPlayer.isPlayableTorrentSummary(torrentSummary)) {
      playButton = (
        <i
          key='play-button'
          title='Start streaming'
          className='icon play'
          onClick={dispatcher('playFile', infoHash)}
        >
          play_circle_outline
        </i>
      )
    }

    return (
      <div className='torrent-controls'>
        {playButton}
        <i
          key='delete-button'
          className='icon delete'
          title='Remove torrent'
          onClick={dispatcher('confirmDeleteTorrent', infoHash, false)}
        >
          close
        </i>
      </div>
    )
  }

  // Show files, per-file download status and play buttons, and so on
  renderTorrentDetails (torrentSummary) {
    let filesElement
    if (torrentSummary.error || !torrentSummary.files) {
      let message = ''
      if (torrentSummary.error === 'path-missing') {
        // Special case error: this torrent's download dir or file is missing
        message = 'Missing path: ' + TorrentSummary.getFileOrFolder(torrentSummary)
      } else if (torrentSummary.error) {
        // General error for this torrent: just show the message
        message = torrentSummary.error.message || torrentSummary.error
      } else if (torrentSummary.status === 'paused') {
        // No file info, no infohash, and we're not trying to download from the DHT
        message = 'Failed to load torrent info. Click the download button to try again...'
      } else {
        // No file info, no infohash, trying to load from the DHT
        message = 'Downloading torrent info...'
      }
      filesElement = (
        <div key='files' className='files warning'>
          {message}
          {torrentSummary.error ? renderRetryButton(torrentSummary) : null}
        </div>
      )
    } else {
      // We do know the files. List them and show download stats for each one
      const sortByName = this.props.state.saved.prefs.sortByName
      const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
      let fileRows = torrentSummary.files
        .filter((file) => !file.path.includes('/.____padding_file/'))
        .map((file, index) => ({ file, index }))

      if (sortByName) {
        fileRows = fileRows.sort((a, b) => collator.compare(a.file.name, b.file.name))
      }

      // While searching, highlight the files whose names match
      const query = this.props.state.search.query.trim()
      const match = query && Search.scoreTorrent(torrentSummary, query)
      const matchedFiles = new Set(match ? match.matchedFiles : [])

      fileRows = fileRows.map((obj) =>
        this.renderFileRow(torrentSummary, obj.file, obj.index, matchedFiles.has(obj.index)))

      filesElement = (
        <div key='files' className='files'>
          <table>
            <tbody>
              {fileRows}
            </tbody>
          </table>
        </div>
      )
    }

    return (
      <div key='details' className='torrent-details'>
        {filesElement}
      </div>
    )
  }

  // Show a single torrentSummary file in the details view for a single torrent
  renderFileRow (torrentSummary, file, index, isSearchMatch) {
    // First, find out how much of the file we've downloaded
    // Are we even torrenting it?
    const isSelected = torrentSummary.selections && torrentSummary.selections[index]
    let isDone = false // Are we finished torrenting it?
    let progress = ''
    if (torrentSummary.progress && torrentSummary.progress.files &&
        torrentSummary.progress.files[index]) {
      const fileProg = torrentSummary.progress.files[index]
      isDone = fileProg.numPiecesPresent === fileProg.numPieces
      progress = Math.floor(100 * fileProg.numPiecesPresent / fileProg.numPieces) + '%'
    }

    // Second, for media files where we saved our position, show how far we got
    let positionElem
    if (file.currentTime) {
      // Radial progress bar. 0% = start from 0:00, 270% = 3/4 of the way thru
      positionElem = this.renderRadialProgressBar(file.currentTime / file.duration)
    }

    // Finally, render the file as a table row
    const isPlayable = TorrentPlayer.isPlayable(file)
    const infoHash = torrentSummary.infoHash
    let icon
    let handleClick
    if (isPlayable) {
      icon = 'play_arrow' /* playable? add option to play */
      handleClick = dispatcher('playFile', infoHash, index)
    } else {
      icon = 'description' /* file icon, opens in OS default app */
      handleClick = isDone
        ? dispatcher('openPath', infoHash, index)
        : (e) => e.stopPropagation() // noop if file is not ready
    }
    // TODO: add a css 'disabled' class to indicate that a file cannot be opened/streamed
    let rowClass = ''
    if (!isSelected) rowClass = 'disabled' // File deselected, not being torrented
    if (!isDone && !isPlayable) rowClass = 'disabled' // Can't open yet, can't stream
    return (
      <tr key={index} onClick={handleClick} className={isSearchMatch ? 'search-match' : ''}>
        <td className={'col-icon ' + rowClass}>
          {positionElem}
          <i className='icon'>{icon}</i>
        </td>
        <td className={'col-name ' + rowClass}>
          {file.name}
        </td>
        <td className={'col-progress ' + rowClass}>
          {isSelected ? progress : ''}
        </td>
        <td className={'col-size ' + rowClass}>
          {prettyBytes(file.length)}
        </td>
        <td
          className='col-select'
          onClick={dispatcher('toggleTorrentFile', infoHash, index)}
        >
          <i className='icon deselect-file'>{isSelected ? 'close' : 'add'}</i>
        </td>
      </tr>
    )
  }

  renderRadialProgressBar (fraction, cssClass) {
    const rotation = 360 * fraction
    const transformFill = { transform: 'rotate(' + (rotation / 2) + 'deg)' }
    const transformFix = { transform: 'rotate(' + rotation + 'deg)' }

    return (
      <div key='radial-progress' className={'radial-progress ' + cssClass}>
        <div className='circle'>
          <div className='mask full' style={transformFill}>
            <div className='fill' style={transformFill} />
          </div>
          <div className='mask half'>
            <div className='fill' style={transformFill} />
            <div className='fill fix' style={transformFix} />
          </div>
        </div>
        <div className='inset' />
      </div>
    )
  }
}

function stopPropagation (e) {
  e.stopPropagation()
}

function getErrorMessage (torrentSummary) {
  const err = torrentSummary.error
  if (err === 'path-missing') {
    return (
      <span key='path-missing'>
        Download folder missing: {torrentSummary.path}<br />
        Reconnect the drive, then {renderRetryButton(torrentSummary)}
      </span>
    )
  }
  return (
    <span key='error'>
      Error {renderRetryButton(torrentSummary)}
    </span>
  )
}

function renderRetryButton (torrentSummary) {
  return (
    <a
      key='retry-button'
      href='#'
      className='retry'
      title='Try to start this torrent again'
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        dispatch('retryTorrent', torrentSummary.infoHash)
      }}
    >
      Retry
    </a>
  )
}

function renderTorrentCheckbox (torrentSummary) {
  const infoHash = torrentSummary.infoHash
  const isActive = ['downloading', 'seeding'].includes(torrentSummary.status)
  return (
    <Checkbox
      key='download-button'
      className={'control download ' + torrentSummary.status}
      style={{
        display: 'inline-block',
        width: 32
      }}
      iconStyle={{
        width: 20,
        height: 20
      }}
      checked={isActive}
      onClick={stopPropagation}
      onCheck={dispatcher('toggleTorrent', infoHash)}
    />
  )
}

function renderFavoriteButton (torrentSummary) {
  const isFavorite = !!torrentSummary.favorite
  return (
    <i
      key='favorite-button'
      className={'icon favorite' + (isFavorite ? ' is-favorite' : '')}
      title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
      onClick={(e) => {
        e.stopPropagation()
        dispatch('toggleFavorite', torrentSummary.infoHash)
      }}
    >
      {isFavorite ? 'star' : 'star_border'}
    </i>
  )
}

function isFinished (torrentSummary) {
  if (torrentSummary.status === 'seeding') return true
  const prog = torrentSummary.progress
  if (prog && prog.ready) return prog.progress === 1
  return !!torrentSummary.done
}

// Status shown in the compact list, and used to sort it.
// group: 0 = downloading, 1 = unfinished (paused or errored), 2 = finished
function getListStatus (torrentSummary) {
  const s = torrentSummary
  if (s.error === 'path-missing') return { key: 'error', label: 'Path missing', group: 1 }
  if (s.error) return { key: 'error', label: 'Error', group: 1 }
  const active = s.status !== 'paused'
  if (isFinished(s)) {
    return active
      ? { key: 'seeding', label: 'Seeding', group: 2 }
      : { key: 'finished', label: 'Finished', group: 2 }
  }
  if (active) {
    const verifying = s.progress && !s.progress.ready
    return { key: 'downloading', label: verifying ? 'Verifying' : 'Downloading', group: 0 }
  }
  return { key: 'paused', label: 'Unfinished', group: 1 }
}

const nameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function sortTorrents (torrents, sortBy = 'dateAdded', desc = false) {
  const byName = (a, b) => nameCollator.compare(a.name || '', b.name || '')
  const compare = {
    name: byName,
    dateAdded: (a, b) => ((a.dateAdded || 0) - (b.dateAdded || 0)) || byName(a, b),
    status: (a, b) => (getListStatus(a).group - getListStatus(b).group) || byName(a, b)
  }[sortBy] || byName
  const sorted = torrents.slice().sort(compare)
  return desc ? sorted.reverse() : sorted
}

function getTotalLength (torrentSummary) {
  if (!torrentSummary.files) return 0
  return torrentSummary.files.reduce((sum, f) => sum + (f.length || 0), 0)
}

const dateFormat = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
const dateTimeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

function formatDate (timestamp, withTime) {
  if (!timestamp) return withTime ? 'Date added unknown' : '—'
  return (withTime ? dateTimeFormat : dateFormat).format(new Date(timestamp))
}
