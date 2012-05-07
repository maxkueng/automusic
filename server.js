var express = require('express');
var socketio = require('socket.io');
var ejs = require('ejs');
var Automusic = require('./lib/automusic').Automusic;
var automusic = new Automusic();

ejs.filters.normalize = function (s) {
	return s.replace(/[^a-z0-9]+/ig, '');
};

var app = express.createServer(
	express.static('./public'), 
	express.bodyParser(), 
	express.methodOverride()
);

var io = socketio.listen(app);
io.set('log level', 1);

automusic.on('scanning', function () {
	io.sockets.emit('scanning');
});

automusic.on('scanningcomplete', function () {
	io.sockets.emit('scanningcomplete');
});

automusic.on('disc', function (disc) {
	io.sockets.emit('disc', disc);
});

automusic.on('release', function (discId, release) {
	io.sockets.emit('release', discId, release);
});

automusic.on('queueupdate', function (queue, len) {
	io.sockets.emit('queueupdate', queue, len);
});

io.sockets.on('connection', function (socket) {
});

app.listen(9090, function () {
	console.log('API listening on port 9090');
});

app.get('/', function (req, res) {
	res.render('index.ejs', {
		'req' : req, 
		'res' : res
	});
});

app.get('/disc/:discId', function (req, res) {
	var discId = req.params['discId'];
	var disc = automusic.disc(discId);

	res.render('disc.ejs', {
		'layout' : false, 
		'req' : req, 
		'res' : res, 
		'disc' : disc
	});
});

app.get('/api/status', function (req, res) {
	res.send('Automusic API is running');
}); 

app.get('/api/scan', function (req, res) {
	res.send('Scanning');
	automusic.scan();
	return;
}); 




var repl = require("repl");
var net = require('net');
net.createServer(function (socket) {
	var myrepl = repl.start("automusic> ", socket, true);
	myrepl.context.a = automusic;
}).listen("/tmp/automusic-repl-sock");
