/**
 * UI tabbed menu component
 */

var blessed = require('blessed');

function TabMenu(screen) {
	var menu = new blessed.Box({
		parent: screen,
		top: 0,
		height: 3,
		left: 0,
		right: 0,
		style: {
			fg: 'green',
			bg: 'black'
		}
	});

	var tabChat = new blessed.Box({
		parent: menu,
		top: 0,
		left: 2,
		height: 3,
		width: '20%',
		align: 'center',
		keys: true,
		style: {
			fg: 'green',
			bg: 'black'
		},
		border: {
			type: 'line',
			fg: 'lightgreen',
			bg: 'black'
		},
		tags: true,
		content: '{bold}Chat{/bold}',
		name: 'Chat'
	});

	var tabBBS = new blessed.Box({
		parent: menu,
		top: 0,
		left: '25%',
		height: 3,
		width: '20%',
		align: 'center',
		keys: true,
		style: {
			fg: 'green',
			bg: 'black'
		},
		border: {
			type: 'line',
			fg: 'green',
			bg: 'black'
		},
		tags: true,
		content: 'BBS',
		name: 'BBS'
	});

	this.menu = menu;
	this.current = 0;
	this.tabs = [
		tabChat,
		tabBBS
	]
}

TabMenu.prototype.setTabStyle = function(tab, isActive) {
	var title = tab.name;
	if (isActive)
		title = '{bold}' + title + '{/bold}';
	tab.setContent(title);
};

TabMenu.prototype.setActive = function(tabName) {
	this.setTabStyle(this.tabs[0], false);
	this.setTabStyle(this.tabs[1], false);
	switch(tabName) {
		case 'chat':
			this.setTabStyle(this.tabs[0], true);
			this.current = 0;
			break;
		case 'bbs':
			this.setTabStyle(this.tabs[1], true);
			this.current = 1;
			break;
	}
};

module.exports = TabMenu;
