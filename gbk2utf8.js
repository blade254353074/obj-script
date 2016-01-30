var glob = require('glob');
var iconv = require('iconv-lite');

var fs = require('fs');
var path = require('path');

// glob('resource/2016-01-29/**/*.txt', function(err, files) {
//   files.forEach(function(filepath) {
//     fs.readFile(filepath, function(err, data) {
//       var utf8Sting = iconv.decode(data, 'gbk').toString('utf8');
//       fs.writeFile(filepath, utf8Sting, function(err) {
//         if (err) throw err;
//       });
//     });
//   });
// });

glob('cars/preview/*/*.png', function(err, files) {
  files.forEach(function(filepath) {
    var dir = path.dirname(filepath);
    var filename = path.basename(filepath, '.png');
    filename = filename.replace(/^\w+-/, '')
    var newPath = path.resolve(dir, filename + '.png');
    fs.renameSync(filepath, newPath);
  });
});
