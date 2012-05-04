"use strict";

var async = require('async');
var walk = require('walk');
var fs = require('fs');
var path = require('path');
var metaflac = require('metaflac');
var mb = require('musicbrainz');
var redis = require('redis');
var ReadyList = require('./readylist').ReadyList;
var repl = require("repl");

var scanning = false;
var discLookupQueue = new ReadyList();
var discReleasesLookupQueue = new ReadyList();
var discReleaseMappingQueue = new ReadyList();

var scanQueue = async.queue(function (task, callback) {
	var filePath = task.file;

	metaflac.vorbisComment(filePath, true, function (err, tags) {
		if (!tags['MUSICBRAINZ_DISCID']) throw new Error("Track has no MUSICBRAINZ_DISCID \n" + filePath);
		if (!tags['TRACKNUMBER']) throw new Error("Track has no TRACKNUMBER \n" + filePath);

		var discId = tags['MUSICBRAINZ_DISCID'];
		var trackNumber = tags['TRACKNUMBER'];

		discLookupQueue.add(discId, true, function (data) {
			lookupDiscReleases(filePath, trackNumber, data);
		});

		if (!discLookupQueue.isBusy(discId)) {
			discLookupQueue.busy(discId, true);

			mb.lookupDiscId(discId, [], function (err, disc) {
				discLookupQueue.data(discId).file = filePath;
				discLookupQueue.data(discId).disc = disc;
				discLookupQueue.ready(discId, true);
			});
		}

		callback();
	});
}, 20);

var lookupDiscReleases = function (filePath, trackNumber, data) {
	var disc = data.disc;
	var discId = disc.id;

	discReleasesLookupQueue.add(discId, true, function (data) {
		mapDiscRelease(filePath, trackNumber, data);
	});

	if (!discReleasesLookupQueue.isBusy(discId)) {
		discReleasesLookupQueue.busy(discId, true);

		var counter = disc.releases.length;
		for (var i = 0; i < disc.releases.length; i++) {
			(function(_i) {
				var release = disc.releases[_i];
				release.load(['release-groups', 'recordings', 'mediums', 'labels', 'artists', 'discids'], function () {
					if (!--counter) {
						discReleasesLookupQueue.data(discId).disc = disc;
						discReleasesLookupQueue.ready(discId, true);
					}
				});
			})(i);
		}
	}
};

var mapDiscRelease = function (filePath, trackNumber, data) {
	var disc = data.disc;
	var discId = disc.id;

	discReleaseMappingQueue.add(discId, true, function (data) {
		console.log(data.releaseId, trackNumber);
	});

	if (!discReleaseMappingQueue.isBusy(discId)) {
		discReleaseMappingQueue.busy(discId, true);
		console.log(discId);
		for (var i = 0; i < disc.releases.length; i++) {
			console.log('  >', disc.releases[i].id);
		}
		console.log(' ');
	}
};

// Interaction

var setDiscRelease = function (discId, releaseId) {
	discReleaseMappingQueue.data(discId).releaseId = releaseId;
	if (!discReleaseMappingQueue.isReady(discId)) {
		discReleaseMappingQueue.ready(discId, true);
	}
};

var scan = function () {
	if (!scanning) {
		scanning = true;
		console.log('Scanning...');
		var walker = walk.walk('./data', { 'followLinks' : false });

		walker.on('file', function (root, fileStats, next) {
			fs.realpath(path.join(root, fileStats.name), function (err, resolvedPath) {
				if (path.extname(resolvedPath) === '.flac') {
					scanQueue.push({'file': resolvedPath}, function (err) { });
				}
			});

			next();
		});

		walker.on('end', function () {
			scanning = false;
			console.log('Scan complete');
		});
	}
};




var net = require('net');
net.createServer(function (socket) {
	var myrepl = repl.start("automusic> ", socket);
	myrepl.context.scan = scan;
	myrepl.context.setDiscRelease = setDiscRelease;
}).listen("/tmp/automusic-repl-sock");

exports.scan = scan;
