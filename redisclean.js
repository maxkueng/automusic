var redis = require("redis");

var r = redis.createClient();
r.on('connect', function () {
	r.keys('*:*', function (err, res) {
		var keys = [];
		if (typeof res === 'object') {
			keys = res;
		} else {
			keys = res.split(" ");
		}
		var counter = keys.length;

		if (counter === 0) {
			console.log('No keys');
			process.exit(0);
		}

		console.log('Removing ' + counter + ' keys');
		for (var i = 0; i < keys.length; i++) {
			r.del(keys[i], function (err, res) {

				if (!--counter) {
					console.log('OK');
					process.exit(0);
				}
			});
		}
	});		
});
