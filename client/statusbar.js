/**
 * UI status bar
 */

var blessed = require('blessed');

function StatusBar(screen, label) {
	this.label = label || '{bold}SSH BBS Thing{/bold}';

	var sep = new blessed.Line({
		parent: screen,
		orientation: 'horizontal',
		bottom: 1,
		height: 1,
		left: 0,
		right: 0,
		style: {
			fg: 'green',
			bg: 'black'
		},
	});

	this.text = new blessed.Text({
		parent: screen,
		bottom: 0,
		height: 1,
		left: 0,
		right: 0,
		fg: 'green',
		bg: 'black',
		tags: true
	});

	this.set('ESC: Exit | TAB: Change tab');
}

StatusBar.prototype.set = function(text) {
	this.text.setContent(this.label + ' | ' + text);
};

module.exports = StatusBar;
