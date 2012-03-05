var fs = require('fs'); var path = require('path'); var walk = require('walk');
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
app.listen(8080);

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
	if (!discId) throw 'Missing DiscId';
	if (!trackNumber) throw 'Missing Track number';
	if (!releaseId) throw 'Missing ReleaseId';

	var release = new mb.Release(releaseId);
	release.load(['release-groups', 'recordings', 'mediums', 'labels', 'artists', 'discids'], function (err) {
		if (err) return;

		var medium = release.getMediumByDiscId(discId);
		if (medium) {
			var track = medium.getTrackByPosition(trackNumber);
			if (track) {
				var recording = track.recording;
				recording.load(['artists', 'work-rels', 'artist-rels'], function (err) {
					if (err) return;

					metaflac.showMD5sum([], filePath, function (err, md5sum) {
						var vorbisComment = [];
							vorbisComment.push([ 'MUSICBRAINZ_DISCID', discId ]);

							for (var i = 0; i < release.releaseGroups.length; i++) {
								vorbisComment.push([ 'MUSICBRAINZ_RELEASEGROUPID', release.releaseGroups[i].id ]);
							}

							vorbisComment.push([ 'MUSICBRAINZ_ALBUMID', release.id ]);

							for (var i = 0; i < release.artistCredits.length; i++) {
								vorbisComment.push([ 'MUSICBRAINZ_ALBUMARTISTID', release.artistCredits[i].artist.id ]);
							}

							vorbisComment.push([ 'MUSICBRAINZ_TRACKID', recording.id ]);

							for (var i = 0; i < recording.artistCredits.length; i++) {
								vorbisComment.push([ 'MUSICBRAINZ_ARTISTID', recording.artistCredits[i].artist.id ]);
							}

							for (var i = 0; i < release.labelInfo.length; i++) {
								if (release.labelInfo[0].label) {
									vorbisComment.push([ 'MUSICBRAINZ_LABELID', release.labelInfo[i].label.id ]);
								}
							}

							var performanceRel = recording.getWorkRelByType('performance');
							if (performanceRel && performanceRel.work) {
								vorbisComment.push([ 'MUSICBRAINZ_WORKID', performanceRel.work.id ]);
							}

							vorbisComment.push([ 'DISCTOTAL', release.mediums.length ]);
							vorbisComment.push([ 'TOTALDISCS', release.mediums.length ]);
							vorbisComment.push([ 'DISCNUMBER', medium.position ]);

							vorbisComment.push([ 'ALBUM', release.title ]);
							vorbisComment.push([ 'ALBUMARTIST', release.artistCreditsString() ]);
							vorbisComment.push([ 'ALBUMARTISTSORT', release.artistCreditsSortString() ]);
							vorbisComment.push([ 'DATE', release.date ]);
							vorbisComment.push([ 'ORIGINALDATE', release.releaseGroups[0].firstReleaseDate ]);
							vorbisComment.push([ 'MEDIA', medium.format ]);
							vorbisComment.push([ 'BARCODE', release.barcode ]);
							vorbisComment.push([ 'ASIN', release.asin ]);
							vorbisComment.push([ 'RELEASECOUNTRY', release.country ]);
							vorbisComment.push([ 'SCRIPT', release.script ]);
							vorbisComment.push([ 'LANGUAGE', release.language ]);
							vorbisComment.push([ 'ALBUMSTATUS', release.status ]);
							vorbisComment.push([ 'MUSICBRAINZ_ALBUMTYPE', release.releaseGroups[0].type ]);

							for (var i = 0; i < release.labelInfo.length; i++) {
								if (release.labelInfo[i].label) {
									vorbisComment.push([ 'LABEL', release.labelInfo[i].label.name ]);
									vorbisComment.push([ 'LABELSORT', release.labelInfo[i].label.sortName ]);
								}
								vorbisComment.push([ 'CATALOGNUMBER', release.labelInfo[i].catalogNumber ]);
							}

							vorbisComment.push([ 'TRACKTOTAL', medium.tracks.length ]);
							vorbisComment.push([ 'TOTALTRACKS', medium.tracks.length ]);
							vorbisComment.push([ 'TRACKNUMBER', track.position ]);

							vorbisComment.push([ 'TITLE', recording.title ]);
							vorbisComment.push([ 'ARTIST', recording.artistCreditsString() ]);
							vorbisComment.push([ 'ARTISTSORT', recording.artistCreditsSortString() ]);


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
	metaflac.vorbisComment(resolvedPath, true, function (err, tags) {
		if (err) { console.log(resolvedPath, err); return; }

		mb.lookupDiscId(tags['MUSICBRAINZ_DISCID'], [], function (err, disc) {
			if (!tags['MUSICBRAINZ_DISCID']) return;
		if (err) console.log(tags);
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
					release.load(['release-groups', 'recordings', 'mediums', 'labels', 'artists', 'discids'], function () {
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
