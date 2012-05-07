var express = require('express');
var socketio = require('socket.io');
var Automusic = require('./lib/automusic').Automusic;
var automusic = new Automusic();

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
	console.log(disc.id);
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
