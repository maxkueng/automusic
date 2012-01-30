var fs = require('fs');
var path = require('path');
var walk = require('walk');
var mb = require('musicbrainz');
var metaflac = require('metaflac');
var redis = require("redis");
var program = require('commander');

program
  .version('0.0.1')
  .option('-p, --peppers', 'Add peppers')
  .option('-P, --pineapple', 'Add pineapple')
  .option('-b, --bbq', 'Add bbq sauce')
  .option('-c, --cheese [type]', 'Add the specified type of cheese [marble]', 'marble')
  .parse(process.argv);


var lookupQueue = {};
var discs = {};

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
							//callback(err, null);
							for (var i = 0; i < lookupQueue[key].callbacks.length; i++) {
								lookupQueue[key].callbacks[i](lookupQueue[key].error, lookupQueue[key].resource);
							}
							return; 
						}; 
						r.set(key, JSON.stringify(resource), function (e, re) {
							for (var i = 0; i < lookupQueue[key].callbacks.length; i++) {
								lookupQueue[key].callbacks[i](lookupQueue[key].error, lookupQueue[key].resource);
							}
							//callback(err, resource);
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

function start () {
	walker = walk.walk("./data", { 'followLinks' : false });

	walker.on("file", function (root, fileStats, next) {
		fs.realpath(path.join(root, fileStats.name), function (err, resolvedPath) {
			if (err) return;

			fs.readFile(resolvedPath, function (err, data) {
				metaflac.vorbisComment(resolvedPath, function (err, tags) {
					if (err) { next(); return; }

					mb.lookupDiscId(tags['MUSICBRAINZ_DISCID'], [], function (err, disc) {
						if (err) { console.log(err); next(); return; }

						console.log(disc.id, 'has the following releases:');
						for (var i = 0; i < disc.releases.length; i++) {
							(function(_i) {
							var release = disc.releases[_i];
							release.load(['release-groups', 'recordings'], function () {
								if (typeof release.releaseGroups[0] === 'undefined') {
									console.log('no groups:', release.id);
								} else {
								console.log(release.title, release.mediums[0].tracks.length, release.releaseGroups[0].firstReleaseDate, release.date, release.country, release.barcode);
								}
							});
							})(i);
						}

					});
				});
			});
			next();

		});
	});
}


program.prompt('start?: ', function(y){
	if (y === 'y') start();
});
