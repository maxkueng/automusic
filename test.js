var fs = require('fs');
var path = require('path');
var walk = require('walk');
var mb = require('musicbrainz');
var metaflac = require('metaflac');
var redis = require('redis');
var program = require('commander');
var timers = require('timers');
var ReadyList = require('./lib/readylist').ReadyList;
var Trickle = require('trickle').Trickle;

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
		if (!flacTagQueue.exists(data.discId)) return;

		io.sockets.emit('releaseactivated', data);
		flacTagQueue.data(data.discId).release = data.release;
		flacTagQueue.ready(data.discId, true);
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

	if (!lookupQueue.exists(key)) {
		lookupQueue.createList(key);

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

	lookupQueue.add(key, true, function (data) {
		callback(data.error, data.resource);
	});
};

function tagFLAC (discId, trackNumber, releaseId, filePath) {
	var release = new mb.Release(releaseId);
	release.load(['release-groups', 'recordings', 'mediums', 'labels', 'artists', 'discids'], function (err) {
		if (err) return;

		var medium = release.getMediumByDiscId(discId);
		if (medium) {
			var track = medium.getTrackByPosition(trackNumber);
			if (track) {
				var recording = track.recording;
				recording.load(['artists', 'work-rels'], function (err) {
					if (err) return;

					metaflac.showMD5sum([], filePath, function (err, md5sum) {
						var vorbisComment = [];
							vorbisComment.push([ 'MUSICBRAINZ_DISCID', discId ]);
							vorbisComment.push([ 'MUSICBRAINZ_RELEASEGROUPID', release.releaseGroups[0].id ]);
							vorbisComment.push([ 'MUSICBRAINZ_ALBUMID', release.id ]);
							vorbisComment.push([ 'MUSICBRAINZ_ALBUMARTISTID', release.artist.id ]);
							vorbisComment.push([ 'MUSICBRAINZ_TRACKID', recording.id ]);
							vorbisComment.push([ 'MUSICBRAINZ_ARTISTID', recording.artist.id ]);
							//vorbisComment.push([ 'MUSICBRAINZ_WORKID', recording.work.id ]);
							if (release.labelInfo[0] && release.labelInfo[0].label) {
								vorbisComment.push([ 'MUSICBRAINZ_LABELID', release.labelInfo[0].label.id ]);
							}
							var performanceRel = recording.getWorkRelByType('performance');
							if (performanceRel && performanceRel.work) {
								vorbisComment.push([ 'MUSICBRAINZ_WORKID', performanceRel.work.id ]);
							}
							vorbisComment.push([ 'TRACKTOTAL', medium.tracks.length ]);
							vorbisComment.push([ 'TOTALTRACKS', medium.tracks.length ]);
							vorbisComment.push([ 'TRACKNUMBER', track.position ]);


						var tmpVCFilename = '/tmp/' + md5sum + '.vorbisComment';
						var tmpVCWrite = fs.createWriteStream(tmpVCFilename, { 'flags' : 'w' });

						tmpVCWrite.on('close', function () {
							metaflac.removeAllTags([], filePath, function (err) {
								metaflac.importTagsFrom([], filePath, tmpVCFilename, function (err) {
									io.sockets.emit('tracktagged', {
										'release' : release.id, 
										'mediumPosition' : medium.position, 
										'trackPosition' : track.position, 
										'recording' : track.recording.id
									});
								});
							});

						});

						for (var i = 0; i < vorbisComment.length; i++) {
							if (vorbisComment[i][1]) {
								tmpVCWrite.write(vorbisComment[i][0] + '=' + vorbisComment[i][1] + '\n');
							}
						}
						tmpVCWrite.destroySoon();
					});
				});
				
			}
		}
	});
};

function handleFLAC (resolvedPath) {
	metaflac.vorbisComment(resolvedPath, function (err, tags) {
		if (err) { console.log(resolvedPath, err); return; }

		mb.lookupDiscId(tags['MUSICBRAINZ_DISCID'], [], function (err, disc) {
			if (!tags['MUSICBRAINZ_DISCID']) return;
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
					// NOTE: Something wrong here with the counter and _i
					var release = disc.releases[_i];
					release.load(['release-groups', 'recordings', 'mediums', 'labels', 'artists'], function () {
						if (!--counter) {
							if (!flacTagQueue.data(disc.id, 'releasesCompleted')) {
								for (var ii = 0; ii < disc.releases.length; ii++) {
									io.sockets.emit('release', { 'discId' : disc.id, 'release' : disc.releases[ii] });
								}
								flacTagQueue.data(disc.id).releasesCompleted = true;

								if (disc.releases.length == 1 && release.isComplete()) {
									io.sockets.emit('releaseactivated', { 'discId' : disc.id, 'release' : release.id });
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

var t = new Trickle(10, 1000);

function start () {
	walker = walk.walk('./data', { 'followLinks' : false });
	//walker = walk.walk('/media/DATA/audio/flac', { 'followLinks' : false });

	walker.on("file", function (root, fileStats, next) {
		
	t.trickle(1, function (err) {
		fs.realpath(path.join(root, fileStats.name), function (err, resolvedPath) {
			if (err) return;

			if (path.extname(resolvedPath) === '.flac') {
				handleFLAC(resolvedPath);
			}


		});

		next();
	});
	});

	walker.on('end', function () {
		console.log('all done');
	});
}

console.log('PID ' + process.pid);
program.prompt('start?: ', function(y){
	if (y === 'y') start();
});
