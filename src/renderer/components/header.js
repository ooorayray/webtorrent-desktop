const React = require('react')

const { dispatch, dispatcher } = require('../lib/dispatcher')

class Header extends React.Component {
  render () {
    const loc = this.props.state.location
    return (
      <div
        className='header'
        onMouseMove={dispatcher('mediaMouseMoved')}
        onMouseEnter={dispatcher('mediaControlsMouseEnter')}
        onMouseLeave={dispatcher('mediaControlsMouseLeave')}
        role='navigation'
      >
        {this.getTitle()}
        <div className='nav left float-left'>
          <i
            className={'icon back ' + (loc.hasBack() ? '' : 'disabled')}
            title='Back'
            onClick={dispatcher('back')}
            role='button'
            aria-disabled={!loc.hasBack()}
            aria-label='Back'
          >
            chevron_left
          </i>
          <i
            className={'icon forward ' + (loc.hasForward() ? '' : 'disabled')}
            title='Forward'
            onClick={dispatcher('forward')}
            role='button'
            aria-disabled={!loc.hasForward()}
            aria-label='Forward'
          >
            chevron_right
          </i>
          {this.getSearchBox()}
        </div>
        <div className='nav right float-right'>
          {this.getListViewButtons()}
          {this.getAddButton()}
        </div>
      </div>
    )
  }

  getTitle () {
    if (process.platform !== 'darwin') return null
    const state = this.props.state
    return (<div className='title ellipsis'>{state.window.title}</div>)
  }

  // Filters the torrent list by torrent and file names. Press / to focus it.
  getSearchBox () {
    const state = this.props.state
    if (state.location.url() !== 'home') return null
    const query = state.search.query
    return (
      <div className={'search' + (query ? ' has-query' : '')}>
        <i className='icon search-icon'>search</i>
        <input
          type='text'
          placeholder='Search'
          aria-label='Search torrents and files'
          title='Search torrent and file names (press / to focus)'
          spellCheck={false}
          value={query}
          onChange={(e) => dispatch('setSearchQuery', e.target.value)}
          onKeyDown={onSearchKeyDown}
        />
        {query
          ? (
            <i
              className='icon clear'
              title='Clear search'
              role='button'
              aria-label='Clear search'
              onClick={dispatcher('setSearchQuery', '')}
            >
              close
            </i>
            )
          : <span className='shortcut-hint'>/</span>}
      </div>
    )
  }

  // Favorites filter and compact/default list toggle, on the torrent list only
  getListViewButtons () {
    const state = this.props.state
    if (state.location.url() !== 'home') return null
    const prefs = state.saved.prefs
    const isCompact = prefs.torrentListView === 'compact'
    const favoritesOnly = !!prefs.showFavoritesOnly
    return [
      <i
        key='favorites-only'
        className={'icon favorites-only' + (favoritesOnly ? ' active' : '')}
        title={favoritesOnly ? 'Show all torrents' : 'Show favorites only'}
        onClick={dispatcher('toggleShowFavoritesOnly')}
        role='button'
        aria-pressed={favoritesOnly}
        aria-label='Show favorites only'
      >
        {favoritesOnly ? 'star' : 'star_border'}
      </i>,
      <i
        key='list-view'
        className='icon list-view'
        title={isCompact ? 'Switch to default view' : 'Switch to compact list'}
        onClick={dispatcher('toggleCompactList')}
        role='button'
        aria-pressed={isCompact}
        aria-label='Compact list'
      >
        {isCompact ? 'view_agenda' : 'view_headline'}
      </i>
    ]
  }

  getAddButton () {
    const state = this.props.state
    if (state.location.url() !== 'home') return null
    return (
      <i
        className='icon add'
        title='Add torrent'
        onClick={dispatcher('openFiles')}
        role='button'
      >
        add
      </i>
    )
  }
}

// Escape clears the search (and leaves the box when it's already empty).
// Enter leaves the box, so the keyboard shortcuts work again.
function onSearchKeyDown (e) {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    if (e.target.value) dispatch('setSearchQuery', '')
    else e.target.blur()
  } else if (e.key === 'Enter') {
    e.target.blur()
  }
}

module.exports = Header
