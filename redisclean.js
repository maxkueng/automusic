var redis = require("redis");

var r = redis.createClient();
r.on('connect', function () {
	r.keys('*:*', function (err, res) {
		var keys = res.split(" ");
		for (var i = 0; i < keys.length; i++) {
			console.log(keys[i]);
			r.del(keys[i], function (err, res) {
				console.log(err, res);
			});
		}
	});		
});
