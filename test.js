var fs = require('fs');
var path = require('path');
var walk = require('walk');
var mb = require('musicbrainz');
var metaflac = require('metaflac');
var redis = require("redis");
var program = require('commander');

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
		console.log('activated', data);
		io.sockets.emit('releaseactivated', data);
		trackQueue[data.discid].release = data.release;
		trackQueue[data.discid].activated = true;

		for (var i = 0; i < trackQueue[data.discid].callbacks.length; i++) {
			trackQueue[data.discid].callbacks[i](trackQueue[data.discid].release);
		}
	});

	socket.on('releaseselected', function (data) {
		console.log('selected', data);
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


var lookupQueue = {};
var trackQueue = {};

function tagTrack (discId, callback) {
	if (trackQueue[discId].activated && trackQueue[discId].release) {
		callback(trackQueue[discId].release);
		return;
	}

	trackQueue[discId].callbacks.push(callback);
};

mb.lookupCache = function (uri, callback, lookup) {
	var key = 'lookup:' + uri;

	if (typeof lookupQueue[key] === 'undefined') {
		lookupQueue[key] = {
			'callbacks' : [callback], 
			'error' : null, 
			'resource' : null, 
			'ready' : false
		};

		var r = redis.createClient();
		r.on('connect', function () {
			r.get(key, function (error, reply) {
				if (reply) {
					lookupQueue[key].error = null;
					lookupQueue[key].resource = JSON.parse(reply);
					lookupQueue[key].ready = true;
					for (var i = 0; i < lookupQueue[key].callbacks.length; i++) {
						lookupQueue[key].callbacks[i](lookupQueue[key].error, lookupQueue[key].resource);
					}
					r.quit();

				} else {
					lookup(function (err, resource) {
						lookupQueue[key].error = err;
						lookupQueue[key].resource = resource;
						lookupQueue[key].ready = true;

						if (err) { 
							console.log(err); 
							for (var i = 0; i < lookupQueue[key].callbacks.length; i++) {
								lookupQueue[key].callbacks[i](lookupQueue[key].error, lookupQueue[key].resource);
							}
							return; 
						}; 
						r.set(key, JSON.stringify(resource), function (e, re) {
							for (var i = 0; i < lookupQueue[key].callbacks.length; i++) {
								lookupQueue[key].callbacks[i](lookupQueue[key].error, lookupQueue[key].resource);
							}
							r.quit();
						});
					});
				}
			});

		});
	} else if (lookupQueue[key].ready === true) {
		callback(lookupQueue[key].error, lookupQueue[key].resource);
	} else {
		lookupQueue[key].callbacks.push(callback);
	}
};

function handleFLAC (resolvedPath, next) {
	metaflac.vorbisComment(resolvedPath, function (err, tags) {
		if (err) { console.log(resolvedPath, err); next(); return; }

		mb.lookupDiscId(tags['MUSICBRAINZ_DISCID'], [], function (err, disc) {
			if (err) { console.log(resolvedPath, err.data()); next(); return; }

			if (typeof trackQueue[disc.id] === 'undefined') {
				trackQueue[disc.id] = { 'releases' : {}, 'callbacks' : [], 'complete' : false, 'activated' : false, 'release' : null };
			}

			tagTrack(disc.id, function (releaseId) {
				console.log(tags['MUSICBRAINZ_DISCID'], tags['TRACKNUMBER']);
			});

			var counter = disc.releases.length;
			for (var i = 0; i < disc.releases.length; i++) {
				(function(_i) {
					var release = disc.releases[_i];
					release.load(['release-groups', 'recordings', 'mediums', 'labels', 'artists'], function () {
						if (release.isComplete()) console.log(release.id, 'COMPLETE');
						if (typeof trackQueue[disc.id].releases[release.id] === 'undefined') {
							trackQueue[disc.id].releases[release.id] = release;
						}

						if (typeof release.releaseGroups[0] === 'undefined') {
							console.log('no groups:', release.id);
						}

						if (!--counter) {
							if (!trackQueue[disc.id].complete) {
								io.sockets.emit('disc', disc);
								trackQueue[disc.id].complete = true;
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
				handleFLAC(resolvedPath, next);
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
