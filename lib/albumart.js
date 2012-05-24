var LastFmNode = require('lastfm').LastFmNode;
var http = require('http');
var url = require('url');
var path = require('path');
var fs = require('fs');
var im = require('imagemagick');

var lastfm = new LastFmNode({
	'api_key' : 'b282f3d244afae826b2d5603a7227444',
	'useragent' : 'automusic/v0.0.1'
});

var types = {
	'image/jpeg' : 'jpg', 
	'image/png' : 'png', 
	'image/gif' : 'gif'
};

var get = function (releaseId, destinationPath, uri, force, callback) {
	if (typeof callback === 'undefined') { // optional uri
		callback = force;
		force = uri;
		uri = null;
	}

	var albumartURI = uri;
	var jpgPath = path.join(destinationPath, releaseId + '.jpg');

	if (!force && path.existsSync(jpgPath)) {
		callback(false, jpgPath);
		return;
	}

	var next = function () {
		download(albumartURI, path.join(destinationPath, releaseId), function (err, filePath) {
			if (err) throw new Error('Couldn\'t download albumart ' + albumartURI);
			im.identify(filePath, function(err, features){
				if (err) { callback(true, null); return; }

				if (features.width < 300 || features.height < 300) { 
					callback(true, null) 
					fs.unlink(filePath, function (err) { });
					return;
				}

				if (features.format == 'JPEG') { callback(false, filePath); return; }

				im.convert([filePath, jpgPath], function(err, metadata){
					if (err) { callback(err, null); return; }
					callback(false, jpgPath);
				});
			});
		});
	};

	if (albumartURI) {
		next();	
	} else {
		getImageURI(releaseId, function (err, uri) {
			if (err) { callback(true, null); return; }
			albumartURI = uri;
			next();
		});
	}

};

var download = function (uri, filePath, callback) {
	var uriParts = url.parse(uri);

	var options = {
		'host' : uriParts.hostname,
		'port' : 80,
		'path' : uriParts.pathname
	};

	http.get(options, function(res) {
		res.setEncoding('binary')
		var imagedata = ''
		res.on('data', function (chunk) {
			imagedata += chunk; 
		});

		res.on('end', function () {
			var type = res.headers['content-type'];
			if (!types[type]) { callback(true, null); return; }
			var ext = types[type];
			filePath = filePath + '.' + ext;

			fs.writeFile(filePath, imagedata, 'binary', function (err) {
				if (err) { callback(true, null); return; }
				callback(false, filePath);
			});
		});

	}).on('error', function (e) {
		callback(true, null);
	});

};

var getImageURI = function (releaseId, callback) {
	var lreq = lastfm.request('album.getinfo', {
		'mbid' : releaseId
	});

	lreq.on('success', function (json) {
		if (!json.album) { callback(true); return; }
		if (!json.album.image) { callback(true); return; }

		var imageUrl;
		var images = json.album.image;
		for (var i = 0; i < images.length; i++) {
			var img = images[i];
			if (!imageUrl && img.size == 'extralarge') imageUrl = img['#text'];
			if (img.size == 'mega') imageUrl = img['#text'];
		}

		if (!imageUrl) { callback(true, null); return; }

		callback(false, imageUrl);
	});

	lreq.on('error', function (err) {
		callback(err, null);
	});
};

exports.get = get;
