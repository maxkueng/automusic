var fs = require('fs');
var path = require('path');
var walk = require('walk');
var mb = require('musicbrainz');
var metaflac = require('metaflac');
var redis = require('redis');
var program = require('commander');
var timers = require('timers');
var ReadyList = require('./lib/readylist').ReadyList;

var app = require('http').createServer(handler);
var io = require('socket.io').listen(app);

io.set('log level', 1);
app.listen(8000);

function handler (req, res) {
	fs.readFile(__dirname + '/monitor.html',
	function (err, data) {
		if (err) {
			res.writeHead(500);
			return res.end('Error loading monitor.html');
		}

		res.writeHead(200);
		res.end(data);
	});
}

io.sockets.on('connection', function (socket) {
	socket.on('releaseactivated', function (data) {
		io.sockets.emit('releaseactivated', data);
		flacTagQueue.data(data.discid).release = data.release;
		flacTagQueue.ready(data.discid, true);
	});

	socket.on('releaseselected', function (data) {
		io.sockets.emit('releaseselected', data);
	});
});

program
  .version('0.0.1')
  .option('-p, --peppers', 'Add peppers')
  .option('-P, --pineapple', 'Add pineapple')
  .option('-b, --bbq', 'Add bbq sauce')
  .option('-c, --cheese [type]', 'Add the specified type of cheese [marble]', 'marble')
  .parse(process.argv);

var lookupQueue = new ReadyList();
var flacTagQueue = new ReadyList();

mb.lookupCache = function (uri, callback, lookup) {
	var key = 'lookup:' + uri;

	lookupQueue.add(key, true, function (data) {
		callback(data.error, data.resource);
	});

	if (!lookupQueue.isReady(key)) {
		var r = redis.createClient();
		r.on('connect', function () {
			r.get(key, function (err, reply) {
				if (reply) {
					lookupQueue.data(key).error = null;
					lookupQueue.data(key).resource = JSON.parse(reply);
					lookupQueue.ready(key, true);
					r.quit();

				} else {
					lookup(function (err, resource) {

						lookupQueue.data(key).error = err;
						lookupQueue.data(key).resource = resource;
						lookupQueue.ready(key, true);

						if (err) { r.quit(); return; }

						r.set(key, JSON.stringify(resource), function (err, reply) {
							r.quit();
						});

					});
				}
			});
		});
	}
};

function tagFLAC (discId, trackNumber, releaseId, filePath) {
	var release = new mb.Release(releaseId);
	release.load(['release-groups', 'recordings', 'mediums', 'labels', 'artists', 'discids'], function (error) {
		var medium = release.getMediumByDiscId(discId);
		if (medium) {
			var track = medium.getTrackByPosition(trackNumber);
			if (track) {
				console.log(discId, medium.position, track.position, track.recording.id);
				
				io.sockets.emit('tracktagged', {
					'release' : release.id, 
					'mediumPosition' : medium.position, 
					'trackPosition' : track.position, 
					'recording' : track.recording.id
				});
			}
		}
	});
};

function handleFLAC (resolvedPath) {
	metaflac.vorbisComment(resolvedPath, function (err, tags) {
		if (err) { console.log(resolvedPath, err); return; }

		mb.lookupDiscId(tags['MUSICBRAINZ_DISCID'], [], function (err, disc) {
			if (err) { console.log(resolvedPath, err.data()); return; }

			flacTagQueue.add(disc.id, true, function (data) {
				var discId = tags['MUSICBRAINZ_DISCID'];
				var trackNumber = tags['TRACKNUMBER'];
				var filePath = resolvedPath;
				var releaseId = data.release;
				tagFLAC(discId, trackNumber, releaseId, filePath);
			});

			var counter = disc.releases.length;
			for (var i = 0; i < disc.releases.length; i++) {
				(function(_i) {
					var release = disc.releases[_i];
					release.load(['release-groups', 'recordings', 'mediums', 'labels', 'artists'], function () {
						if (!--counter) {
							if (!flacTagQueue.data(disc.id, 'releasesCompleted')) {
								io.sockets.emit('disc', disc);
								flacTagQueue.data(disc.id).releasesCompleted = true;

								if (disc.releases.length == 1 && release.isComplete()) {
									io.sockets.emit('releaseactivated', { 'discid' : disc.id, 'release' : release.id });
									flacTagQueue.data(disc.id).release = release.id;
									flacTagQueue.ready(disc.id, true);
								}
							}
						}
					});
				})(i);
			}

		});
	});

}

function start () {
	walker = walk.walk("./data", { 'followLinks' : false });

	walker.on("file", function (root, fileStats, next) {
		fs.realpath(path.join(root, fileStats.name), function (err, resolvedPath) {
			if (err) return;

			if (path.extname(resolvedPath) === '.flac') {
				handleFLAC(resolvedPath);
			}

			next();

		});
	});

	walker.on('end', function () {
		console.log('all done');
	});
}


program.prompt('start?: ', function(y){
	if (y === 'y') start();
});
