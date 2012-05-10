"use strict";

var async = require('async');
var walk = require('walk');
var util = require('util');
var events = require('events');
var fs = require('fs');
var path = require('path');
var metaflac = require('metaflac');
var mb = require('musicbrainz');
var redis = require('redis');
var ReadyList = require('./readylist').ReadyList;
var albumart = require('./albumart');

process.on('uncaughtException', function (ex) {
	console.log('uncaught exception: ' + ex);
});

var config = {
	'scan_dir' : fs.realpathSync('data/inbox'), 
	'albumart_dir' : fs.realpathSync('data/artwork')
};

var mbLookupQueue = new ReadyList();
mb.lookupCache = function (uri, callback, lookup) {
	var key = 'lookup:' + uri;

	if (!mbLookupQueue.exists(key)) {
		mbLookupQueue.createList(key);

		var r = redis.createClient();
		r.on('connect', function () {
			r.get(key, function (err, reply) {
				if (reply) {
					mbLookupQueue.data(key).error = null;
					mbLookupQueue.data(key).resource = JSON.parse(reply);
					mbLookupQueue.ready(key, true);
					r.quit();

				} else {
					lookup(function (err, resource) {

						mbLookupQueue.data(key).error = err;
						mbLookupQueue.data(key).resource = resource;
						mbLookupQueue.ready(key, true);

						if (err) { r.quit(); return; }

						r.set(key, JSON.stringify(resource), function (err, reply) {
							r.quit();
						});

					});
				}
			});
		});
	}

	mbLookupQueue.add(key, true, function (data) {
		callback(data.error, data.resource);
	});
};

var Automusic = function () {
	events.EventEmitter.call(this);
	var self = this;

	this.scanning = false;
	this.discs = {};
	this.releases = {};
	this.discLookupQueue = new ReadyList();
	this.discReleasesLookupQueue = new ReadyList();
	this.discReleaseMappingQueue = new ReadyList();
	this.releaseArtworkQueue = new ReadyList();

	this.discLookupQueue.on('update', function (len) { self.emit('queueupdate', 'disclookup', len); });
	this.discReleasesLookupQueue.on('update', function (len) { self.emit('queueupdate', 'discreleaseslookup', len); });
	this.discReleaseMappingQueue.on('update', function (len) { self.emit('queueupdate', 'discreleasemapping', len); });
	this.releaseArtworkQueue.on('update', function (len) { self.emit('queueupdate', 'releaseartwork', len); });

	var self = this;
	this.scanQueue = async.queue(function (task, callback) {
		var filePath = task.file;

		metaflac.vorbisComment(filePath, true, function (err, tags) {
			if (!tags['MUSICBRAINZ_DISCID']) throw new Error("Track has no MUSICBRAINZ_DISCID \n" + filePath);
			if (!tags['TRACKNUMBER']) throw new Error("Track has no TRACKNUMBER \n" + filePath);

			var discId = tags['MUSICBRAINZ_DISCID'];
			var trackNumber = tags['TRACKNUMBER'];

			self.discLookupQueue.add(discId, true, function (data) {
				self.lookupDiscReleases(filePath, trackNumber, data);
			});

			if (!self.discLookupQueue.isBusy(discId)) {
				self.discLookupQueue.busy(discId, true);

				mb.lookupDiscId(discId, [], function (err, disc) {
					if (err) throw new Error('Lookup failed for disc ' + discId);

					self.discLookupQueue.data(discId).file = filePath;
					self.discLookupQueue.data(discId).disc = disc;
					self.discLookupQueue.ready(discId, true);
				});
			}

			process.nextTick(function () {
				callback();
			});
		});
	}, 20);
};

util.inherits(Automusic, events.EventEmitter);

Automusic.prototype.disc = function (discId) {
	if (typeof this.discs[discId] === 'undefined') return null;

	return this.discs[discId];
};

Automusic.prototype.release = function (releaseId) {
	if (typeof this.releases[releaseId] === 'undefined') return null;
	
	return this.releases[releaseId];
};

Automusic.prototype.scan = function () {
	if (!this.scanning) {
		this.scanning = true;
		this.emit('scanning');
		var walker = walk.walk(config.scan_dir, { 'followLinks' : false });

		var self = this;
		walker.on('file', function (root, fileStats, next) {
			fs.realpath(path.join(root, fileStats.name), function (err, resolvedPath) {
				if (path.extname(resolvedPath) === '.flac') {
					self.scanQueue.push({'file': resolvedPath}, function (err) { });
				}
			});

			next();
		});

		walker.on('end', function () {
			self.scanning = false;
			self.emit('scanningcomplete');
		});
	}
};


Automusic.prototype.lookupDiscReleases = function (filePath, trackNumber, data) {
	var self = this;
	var disc = data.disc;
	var discId = disc.id;

	this.discReleasesLookupQueue.add(discId, true, function (data) {
		self.mapDiscRelease(filePath, trackNumber, data);
	});

	if (!this.discReleasesLookupQueue.isBusy(discId)) {
		this.discReleasesLookupQueue.busy(discId, true);

		var counter = disc.releases.length;
		for (var i = 0; i < disc.releases.length; i++) {
			(function(_i) {
				process.nextTick(function () {
					var release = disc.releases[_i];
					self.releases[release.id] = release;
					release.load(['release-groups', 'recordings', 'mediums', 'labels', 'artists', 'discids'], function () {

						if (!--counter) {
							self.discs[discId] = disc;
							self.discReleasesLookupQueue.data(discId).disc = disc;
							self.discReleasesLookupQueue.ready(discId, true);
						}
					});
				});
			})(i);
		}
	}
};

Automusic.prototype.mapDiscRelease = function (filePath, trackNumber, data) {
	var self = this;
	var disc = data.disc;
	var discId = disc.id;

	this.discReleaseMappingQueue.add(discId, true, function (data) {
		var releaseId = data.releaseId;

		self.trackMetadata(discId, releaseId, trackNumber, filePath, function (err, metadata) {
			self.releaseArtworkQueue.add(releaseId, true, function (data) {
				// Tag
			});

			if (!self.releaseArtworkQueue.isBusy(releaseId)) {
				self.releaseArtworkQueue.busy(releaseId, true);

				albumart.get(releaseId, config.albumart_dir, true, function (err, imgPath) {
					console.log(err, imgPath);
				});
			}
		});
	});

	if (!this.discReleaseMappingQueue.isBusy(discId)) {
		this.discReleaseMappingQueue.busy(discId, true);

		this.emit('disc', discId);

		for (var i = 0; i < disc.releases.length; i++) {
			this.emit('release', discId, disc.releases[i].id);
		}
	}
};

Automusic.prototype.trackMetadata = function (discId, releaseId, trackNumber, filePath, callback) {
	var release = new mb.Release(releaseId);
	release.load(['release-groups', 'recordings', 'mediums', 'labels', 'artists', 'discids'], function (err) {
		if (err) throw new Error('Failed to load release ' + releaseId);

		var medium = release.getMediumByDiscId(discId);
		if (!medium) throw new Error('No medium with DiscID ' + discId + ' for release ' + releaseId);

		var track = medium.getTrackByPosition(trackNumber);
		if (!track) throw new Error('Medium with DiscId ' + discId + ' has no track #' + trackNumber); 

		var recording = track.recording;
		recording.load(['artists', 'work-rels', 'artist-rels'], function (err) {
			if (err) throw new Error('Failed to load recording ' + recording.id + ' for release ' + releaseId);

			var metadata = {};
			metadata.musicbrainzDiscId = discId;

			metadata.musicbrainzReleaseGroupId = [];
			for (var i = 0; i < release.releaseGroups.length; i++) {
				metadata.musicbrainzReleaseGroupId.push(release.releaseGroups[i].id);
			}

			metadata.musicbrainzAlbumId = release.id;

			metadata.musicbrainzAlbumArtistId = [];
			for (var i = 0; i < release.artistCredits.length; i++) {
				metadata.musicbrainzAlbumArtistId.push(release.artistCredits[i].artist.id);
			}

			metadata.musicbrainzTrackId = recording.id;

			metadata.musicbrainzArtistId = [];
			for (var i = 0; i < recording.artistCredits.length; i++) {
				metadata.musicbrainzArtistId.push(recording.artistCredits[i].artist.id);
			}

			metadata.musicbrainzLabelId = [];
			for (var i = 0; i < release.labelInfo.length; i++) {
				metadata.musicbrainzLabelId.push(release.labelInfo[i].label.id);
			}

			metadata.musicbrainzWorkId = null;
			var performanceRel = recording.getWorkRelByType('performance');
			if (performanceRel && performanceRel.work) {
				metadata.musicbrainzWorkId = performanceRel.work.id;
			}

			metadata.totalDiscs = release.mediums.length;
			metadata.discNumber = medium.position;

			metadata.album = release.title;
			metadata.albumArtist = release.artistCreditsString();
			metadata.albumArtistSort = release.artistCreditsSortString();
			metadata.date = release.date;
			metadata.originalDate = release.releaseGroups[0].firstReleaseDate;
			metadata.media = medium.format;
			metadata.barcode = release.barcode;
			metadata.asin = release.asin;
			metadata.releaseCountry = release.country;
			metadata.script = release.script;
			metadata.language = release.language;
			metadata.releaseStatus = release.status;
			metadata.releaseType = release.releaseGroups[0].type;
			metadata.packaging = release.packaging;
			metadata.quality = release.quality;

			metadata.label = [];
			for (var i = 0; i < release.labelInfo.length; i++) {
				var info = {};
				if (release.labelInfo[i].label) {
					info.name = release.labelInfo[i].label.name;
					info.sortName = release.labelInfo[i].label.sortName;
				}
				info.catalogNumber = release.labelInfo[i].catalogNumber;
				metadata.label.push(info);
			}

			metadata.totalTracks = medium.tracks.length;
			metadata.trackNumber = track.position;

			metadata.title = recording.title;
			metadata.artist = recording.artistCreditsString();
			metadata.artistSort = recording.artistCreditsSortString();


			process.nextTick(function () {
				if (typeof callback == 'function') callback(false, metadata);
			});
		});
	});
};

// Interaction

Automusic.prototype.setDiscRelease = function (discId, releaseId) {
	this.discReleaseMappingQueue.data(discId).releaseId = releaseId;
	if (!this.discReleaseMappingQueue.isReady(discId)) {
		this.discReleaseMappingQueue.ready(discId, true);
	}
};

exports.Automusic = Automusic;
