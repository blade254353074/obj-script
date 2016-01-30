var fs = require('fs');
var path = require('path');
var glob = require('glob');
var _ = require('underscore');
var jsonFormat = require('json-format');
var imgc = require('imgc');
var PythonShell = require('python-shell');
var rimraf = require('rimraf');

// 转换json标准数据模板
var templateJSON = require('./template.json');

var tplConvert = templateJSON.convert;
var tplParts = templateJSON.parts;

// 导出数组
// chassis 机架
var carnameArr = [];
var outputObj = {};

var convert = {
  _time: 0,
  complete: function() {
    glob('output/**/*.json', function(err, files) {
      if (err) return console.error(err);
      var chassis = outputObj.chassis = outputObj.chassis || {};
      var wheels = outputObj.wheels = outputObj.wheels || {};

      files.forEach(function(filepath) {
        var id;
        var carname;
        var prop;
        var chunk;
        var json = JSON.parse(fs.readFileSync(filepath, 'utf8').toString());
        var dirname = path.dirname(filepath);
        var lastDir = dirname.match(/[^\/]+$/g)[0]; // audi-a41/19
        var secondLastDir = dirname.match(/[^\/]+(?=\/[^\/]+$)/g)[0]; // chassis/wheels
        var partname = path.basename(filepath, '.json'); // body body-area body1 chassis/rim tyre
        var partnameRaw = partname.replace(/(\d+|-area)/g, ''); // body chassis/rim tyre
        var isArea = partname.search(/-area/g) !== -1; // 是否是body-area
        var isChoice = partname.search(/\d+/g) !== -1; // 是否是rim1

        if (secondLastDir === 'output') {
          // output/wheels/caliper.json
          // console.log('caliper: ' + partname);
          outputObj.caliper = tplParts.caliper || {};
          outputObj.caliper.shading = 'phong';
          return;
        }
        prop = _.extend({}, tplParts[partnameRaw] || {});
        if (secondLastDir === 'chassis') {
          carname = lastDir; // audi-a4l
          // console.log('chassis: ' + partname);
          chassis[carname] = chassis[carname] || {};
          chunk = chassis[carname][partnameRaw] = prop;
          switch (partnameRaw) {
            case 'body':
              break;
            case 'spoiler':
              // if (!isChoice) break;
              // spoiler至少有一个choice
              chunk.choices = isChoice && chunk.choices || [''];
              // 增加choices 如果有 -area 就不添加choices了
              isArea || chunk.choices.push(partname);
              break;
            default:
              if (!isChoice) break;
              chunk.choices = chunk.choices || [];
              // 增加choices
              isArea || chunk.choices.push(partname);
              break;
          }
        } else if (secondLastDir === 'wheels') {
          id = lastDir; // id = 19
          // console.log('wheels: ' + partname);
          wheels[id] = wheels[id] || {};
          chunk = wheels[id][partnameRaw] = prop;
        }
        // 判断是否有贴图，没有则添加shading: 'phong'
        json.materials.forEach(function(item, index) {
          if (item.mapAmbient) {
            return;
          }
          chunk.shading = 'phong';
        });
        if (isArea) {
          newcarObjPart.area = true;
        }
      });
      // console.log(JSON.stringify(outputObj, null, 2));
      // 输出output.json
      fs.writeFileSync('output/output.json', jsonFormat(outputObj));
    });
    // _.each(carnameObj, function(car, _carname) {
    //   // key === carname
    //   _.each(car, function(part, _partname) {
    //     var _partnameRaw = _partname.replace(/\d+/g, '');
    //     if (_partnameRaw === 'body' || _partnameRaw === 'spoiler') return;

    //     if (part.choices.length === 1) {
    //       delete part.choices;
    //     }
    //   });
    // });

    // // 输出output.json
    // fs.writeFileSync('chassis/output.json', jsonFormat(carnameObj));
  }
};
Object.defineProperty(convert, 'time', {
  get: function() {
    return this._time;
  },
  set: function(newValue) {
    this._time = newValue;
    if (this._time >= 2) {
      this.complete();
    }
  }
});

// 清空目录
rimraf.sync('output');
// 生成output目录结构
fs.existsSync('output') || fs.mkdirSync('output');
fs.existsSync('output/chassis') || fs.mkdirSync('output/chassis');
fs.existsSync('output/wheels') || fs.mkdirSync('output/wheels');

// 读取cars/chassis下所有的obj文件
glob('cars/chassis/**/*.obj', function(err, files) {
  if (err) return console.error(err);

  var convertNum = 0;
  var filesLen = files.length;

  files.forEach(function(filepath) {
    var filename = path.basename(filepath, '.obj'); // 文件名 Honda-Spirior-Rim
    // 部件名 rim
    var suffix = '';
    var lastSlash = filename.lastIndexOf('-'); // > -Rim
    var partname = filename.slice(lastSlash + 1).toLocaleLowerCase();

    if (partname === 'l') {
      // 去掉 -l
      partname = filename.slice(filename.lastIndexOf('-', lastSlash - 1) + 1, lastSlash).toLocaleLowerCase();
      suffix = '-area';
      lastSlash = filename.lastIndexOf('-', lastSlash - 1);
      // console.log(partname + '-area');
    }
    // 去除partname中的数字
    var partnameRaw = partname.replace(/\d+/g, '');
    // Rim -> rim
    // 汽车车型 BMW-MINI Countryman -> bmw-mini-countryman
    // var carname = filename.slice(0, lastSlash).toLocaleLowerCase().replace(/\s/g, '-');
    var carname = path.dirname(filepath).match('[^\\' + path.sep + ']+$')[0];
    var outputDir = 'output/chassis/' + carname; // 输出目录
    var outputPath = outputDir + '/' + partname + suffix + '.json'; // 转换文件保存路径
    // console.log(outputPath);

    //console.log(carname, partname, filename);
    // 如果输出目录不存在,则新建目录
    fs.existsSync(outputDir) || fs.mkdirSync(outputDir);

    // 调用转换脚本
    PythonShell.run('convert_obj_three.py', {
      mode: 'text',
      args: ['-i', filepath, '-o', outputPath, '-x', 0.5],
    }, function(err, results) {
      // 已处理文件数量
      convertNum++;
      if (err) return console.error(err);

      var newcarObj;
      var newcarObjPart;
      // 当前已转换的json文件
      var outputJSON = JSON.parse(fs.readFileSync(outputPath));
      var isArea = outputPath.indexOf('-area');

      if (outputJSON.materials) {
        if (outputJSON.materials.length > 1) console.error('两个以上材质的: ' + carname, partname);

        // 对py转换的JSON再进行处理
        outputJSON.materials.forEach(function(value, index, array) {
          if (tplConvert[partnameRaw]) {
            value = _.extend(value, tplConvert[partnameRaw]);
          } else if (value.mapAmbient) { // tpl中没有json信息，则手动替换.tga为png
            value.mapDiffuse = value.mapAmbient = value.mapAmbient && value.mapAmbient.replace(/\.tga$/g, '.png');
          }
        });

        // 输出 .json
        fs.writeFileSync(outputPath, jsonFormat(outputJSON));
      }

      // 当处理了所有的文件
      if (convertNum === filesLen) {
        convert.time++;
      }

      /*// 新车型
      carnameObj[carname] = carnameObj[carname] || {};

      newcarObj = carnameObj[carname];
      newcarObjPart = newcarObj[partnameRaw] = tplParts[partnameRaw] || {};

      // 已添加的车型, 添加parts对象
      switch (partnameRaw) {
        case 'body':
          newcarObj[partname] = tplParts[partnameRaw];
          break;
        case 'spoiler':
          // spoiler至少有一个choice
          newcarObjPart.choices = newcarObjPart.choices || [''];
          // 增加choices
          isArea > -1 || newcarObjPart.choices.push(partname);
          break;
        default:
          newcarObjPart.choices = newcarObjPart.choices || [];
          // 增加choices
          isArea > -1 || newcarObjPart.choices.push(partname);
          break;
      }

      // 判断是否是area
      if (isArea > -1) {
        newcarObjPart.area = true;
      }*/
      //console.log('convert ' + filename + ' to ' + partname + '.json');
    });
  });
});


// 读取cars/wheels下所有的obj文件
glob('cars/wheels/**/*.obj', function(err, files) {
  if (err) return console.error(err);

  var convertNum = 0;
  var filesLen = files.length;

  files.forEach(function(filepath) {
    var filename = path.basename(filepath, '.obj'); // 文件名 Honda-Spirior-Rim
    var dirname = path.dirname(filepath);
    var id = dirname.match(/[^\/]+(?=\/[^\/]+$)/g)[0];
    var partname = dirname.match(/[^\/]+$/g)[0];
    var partnameLower = partname.toLocaleLowerCase();
    var outputDir = 'output/wheels/' + id; // 输出目录
    var outputPath = outputDir + '/' + partnameLower + '.json'; // 转换文件保存路径
    if (partname === 'wheels') {
      outputDir = 'output/wheels';
      outputPath = outputDir + '/' + filename + '.json';
    }

    // 如果输出目录不存在,则新建目录
    fs.existsSync(outputDir) || fs.mkdirSync(outputDir);
    glob(dirname + '/' + '*.tga', function(err, files) {
      if (err) return console.error(err);
      files.forEach(function(filepath) {
        var filename = path.basename(filepath, '.tga');

        imgc('"' + filepath + '"', outputDir, {
          format: 'png',
          quality: 'best',
        }).then(function() {
          //console.log('convert ' + filename + '.png' + ' to ' + partnameLower + '.png');
        });
      });
    });
    // 调用转换脚本
    PythonShell.run('convert_obj_three.py', {
      mode: 'text',
      args: ['-i', filepath, '-o', outputPath, '-x', 0.5],
    }, function(err, results) {
      // 已处理文件数量
      convertNum++;
      if (err) return console.error(err);
      // 当前已转换的json文件
      var outputJSON = JSON.parse(fs.readFileSync(outputPath));
      var isArea = outputPath.indexOf('-area') > -1;
      if (outputJSON.materials) {
        if (outputJSON.materials.length > 1) console.error('两个以上材质的 wheel: ' + id, partname);

        // 对py转换的JSON再进行处理
        outputJSON.materials.forEach(function(value, index, array) {
          if (tplConvert[partname]) {
            array[index] = _.extend(array[index], tplConvert[partname]);
          }
          if (value.mapAmbient) { // tpl中没有json信息，则手动替换.tga为png
            value.mapDiffuse = value.mapAmbient = value.mapAmbient && value.mapAmbient.replace(/\.tga$/g, '.png');
          }
        });

        // 输出 .json
        fs.writeFileSync(outputPath, jsonFormat(outputJSON));
      }
      // 当处理了所有的文件
      if (convertNum === filesLen) {
        convert.time++;
      }
      //console.log('convert ' + filename + ' to ' + partname + '.json');
    });
  });
});

glob('cars/chassis/**/*.tga', function(err, files) {
  if (err) return console.error(err);
  files.forEach(function(filepath) {

    var filename = path.basename(filepath, '.tga'); // 文件名 Honda-Spirior-Rim
    // 部件名 rim
    var lastSlash = filename.lastIndexOf('-'); // > -Rim
    var partname = filename.slice(lastSlash + 1); // Rim
    var partnameLower = partname.toLocaleLowerCase(); // rim
    // 汽车车型 BMW-MINI Countryman -> bmw-mini-countryman
    // var carname = filename.slice(0, lastSlash).toLocaleLowerCase().replace(/\s/g, '-');
    var carname = path.dirname(filepath).match('[^\\' + path.sep + ']+$')[0];
    var outputDir = 'output/chassis/' + carname; // 输出目录
    var outputPath = outputDir + '/' + filename + '.png'; // 转换文件保存路径
    var outputPathLower = outputDir + '/' + partnameLower + '.png'; // 转换文件名小写

    fs.existsSync(outputDir) || fs.mkdirSync(outputDir);

    imgc('"' + filepath + '"', outputDir, {
      format: 'png',
      quality: 'best',
    }).then(function() {
      // 重命名转换后的png文件
      fs.renameSync(outputPath, outputPathLower);

      //console.log('convert ' + filename + '.png' + ' to ' + partnameLower + '.png');
    });
  });
});

// 预览图生成
glob('cars/chassis/**/*.png', function(err, files) {
  if (err) return console.error(err);
  files.forEach(function(filepath) {

    var filename = path.basename(filepath, '.png'); // 文件名 Honda-Spirior-Rim
    // 部件名 rim
    var lastSlash = filename.lastIndexOf('-'); // > -Rim
    var partname = filename.slice(lastSlash + 1).toLocaleLowerCase(); // Rim
    var partnameLower = partname.toLocaleLowerCase(); // rim
    // 汽车车型 BMW-MINI Countryman -> bmw-mini-countryman
    // var carname = filename.slice(0, lastSlash).toLocaleLowerCase().replace(/\s/g, '-');
    var carname = path.dirname(filepath).match('[^\\' + path.sep + ']+$')[0];
    var outputDir = 'output/chassis/' + carname; // 输出目录
    var outputPathLower = outputDir + '/' + partnameLower + '-preview.png'; // 转换文件保存路径

    fs.existsSync(outputDir) || fs.mkdirSync(outputDir);

    fs.writeFileSync(outputPathLower, fs.readFileSync(filepath));
  });
});
