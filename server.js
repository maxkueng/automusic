var express = require('express');
var automusic = require('./lib/automusic');

var app = express.createServer(
	express.bodyParser(), 
	express.methodOverride()
);

app.listen(9090, function () {
	console.log('API listening on port 9090');
});

app.get('/api', function (req, res) {
	res.send('Automusic API is running');
}); 

app.get('/scan', function (req, res) {
	res.send('Scanning');
	automusic.scan();
	return;

	res.send('Already scanning');
}); 
