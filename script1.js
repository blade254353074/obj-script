'use strict';
// 依赖模块
var fs = require('fs');
var path = require('path');
var _ = require('underscore');
var Q = require('q'); // q promise
var jsonFormat = require('json-format'); // json格式化

var PythonShell = require('python-shell'); // py脚本 调用
var imgc = require('imgc'); // tga 图片格式转换
var glob = require('glob-promise'); // 文件遍历
var rimraf = require('rimraf'); // 清空目录

var templateJSON = JSON.parse(fs.readFileSync('./template.json', 'utf8').toString());
// 转换json, matrial模板
var tplConvert = templateJSON.convert;
// chassis.json 模板
var tplParts = templateJSON.parts;

/**
 * 因为 fs.existsSync 已被废弃，所以使用
 * fileExists 检测文件或文件夹是否存在
 * @param  {String} path 文件或文件夹是否存在
 * @return {Boolean}     存在则返回 true, 不存在反之
 */
function fileExists(relativePath) {
  if (typeof relativePath === 'string') {
    try {
      fs.accessSync(path.resolve(process.cwd(), relativePath));
      return true;
    } catch (e) {
      return false;
    }
  } else {
    throw 'relativePath is not a string';
  }
}

// 存有汽车品牌的数组
var brandArr = [];

/**
 * 调用 convert_obj_three.py 处理模型文件
 * @param  {String}   input    输入文件路径
 * @param  {String}   output   输出文件路径
 * @return {Object}            Promise对象
 */
var queue = Promise.resolve();

function py(input, output) {
  return new Promise(function(resolve, reject) {
    // console.log('processing ' + input);
    PythonShell.run('convert_obj_three.py', {
      mode: 'text',
      args: ['-i', input, '-o', output, '-x', 0.5],
    }, function(err, results) {
      // 直接抛出，需检查模型文件
      if (err) {
        console.log(input);
        console.error('转换出错，请检查文件');
        reject(err);
      }
      console.log('processed ' + input);
      resolve(results);
    });
  });
}

/**
 * 对py转换的JSON再进行处理（修改materials属性，将tga转为png）
 * @param  {String} output json文件的路径
 * @param  {String} brand  lastDir
 * @param  {String} part   配件名，如tyre rim spoiler
 * @return {undefined}
 */
function reJSON(output, brand, part) {
  var outputJSON;
  try {
    outputJSON = JSON.parse(fs.readFileSync(output));
  } catch (e) {
    console.error(output + 'JSON格式有误');
    console.error(e);
    return;
  }
  if (outputJSON.materials) {
    if (outputJSON.materials.length > 1) {
      console.log('两个以上材质的: ' + brand, part)
    }
    outputJSON.materials.forEach(function(value, index, array) {
      if (tplConvert[part]) {
        value = Object.assign(value, tplConvert[part]);
      }
      // 若materials中包含tga，则转换为png
      if (value.mapAmbient) {
        value.mapDiffuse = value.mapAmbient = value.mapAmbient && value.mapAmbient.replace(/\.tga$/g, '.png');
      }
    });
  }
  fs.writeFileSync(output, jsonFormat(outputJSON));
}


function init() {
  return new Promise(function(resolve, reject) {
    // 删除 output 目录
    rimraf.sync('output');
    /*
      chassis (机架)
      source: accessory(加配件组合) & area(简装车)
      output: ./output/chassis/
      json: ./output/chassis.json
     */
    // 生成 output 目录结构
    fs.mkdirSync('output');
    fileExists('output/chassis') || fs.mkdirSync('output/chassis');
    fileExists('output/chassis/spoiler') || fs.mkdirSync('output/chassis/spoiler');
    fileExists('output/wheels') || fs.mkdirSync('output/wheels');
    resolve();
  });
}

/**
 * 返回父目录的文件名
 * @param  {String} path    文件路径
 * @param  {String} resolve 相对路径，如 '../'
 * @return {String}         文件名
 */
function parentDir(filepath, resolve) {
  var dir = path.dirname(filepath);
  dir = path.resolve(dir, resolve || '');
  return dir.match('[^\\' + path.sep + ']+$')[0];
}

function toLowerCase(string) {
  if (typeof string === 'string') {
    return string ? string.toLocaleLowerCase() : string;
  } else {
    return string;
  }
}

/**
 * 将文件路径转化为，配件属性特征对象
 * @param  {String} filepath 文件路径
 * @return {Object}          配件属性对象
 */
function file2prop(filepath, type) {
  // filepath3(accessory):  cars/accessory/{{brand}}pj/{{part}}-{{choice}}.obj
  // filepath3(rim):        cars/wheels/{{size}}/{{brand}}/{{rim}}.obj
  // filepath2(tyre):       cars/wheels/{{size}}/{{tyre}}.obj
  var prop;
  var brand;
  var size;
  var fileprop = path.parse(filepath);
  var lastDir = toLowerCase(parentDir(filepath));
  var secondLastDir = toLowerCase(parentDir(filepath, '../'));
  var filename = toLowerCase(fileprop.name);

  // 判断类型的逻辑
  var sepNum = path.dirname(filepath).split('\/').length - 1;
  if (sepNum === 3) {
    type = 'rim';
  } else {
    type = filepath.indexOf('/wheels/') > -1 ? 'tyre' : 'accessory';
  }

  switch (type) {
    case 'accessory':
      // 配件 || preview
      if (fileprop.ext === '.png') {
        type = 'preview'
      }
      brand = toLowerCase(lastDir);
      if (/pj$/.test(lastDir)) {
        brand = brand.replace(/pj$/, ''); // bmwpj => bmw
      }
      // 文件名(去掉扩展名)，如：reflector-choice
      var partChoiceArr = filename.split('-'); // [{{part}}, {{choice}}]
      var part = toLowerCase(partChoiceArr[0]); // {{part}}
      var choice = toLowerCase(partChoiceArr[1]); // {{choice}}
      var partRaw = part.replace(/\d+/g, ''); // {{partRaw}}
      prop = {
        type: type,
        filename: filename,
        brand: brand,
        part: part,
        partRaw: partRaw,
        choice: choice
      };
      break;
    case 'rim':
      // 轮毂
      brand = lastDir; // oc
      size = secondLastDir; // 14
      prop = {
        type: type,
        filename: filename,
        size: size,
        brand: brand,
      };
      break;
    case 'tyre':
      // 轮胎
      size = lastDir; // 14
      prop = {
        type: type,
        filename: filename,
        size: size,
      };
      break;
    default:
      break;
  }
  return prop;
}

// 开始处理 chassis

/**
 * spoilerProcess 处理扰流板 生成扰流板数组
 * @param  {String} path 扰流板源文件目录
 * @return {Object}      Promise
 */
function spoilerProcess(pattern) {
  return new Promise(function(resolve, reject) {
    glob(pattern)
      .then(function(files) {
        var filesLen = files.length;
        var spoiler = [];
        if (filesLen === 0) {
          resolve(spoiler);
          return;
        }
        files.forEach(function(filepath, index) {
          var prop = file2prop(filepath);
          var outputDir = 'output/chassis/spoiler/';
          var outputPath = outputDir + prop.filename + '.json';
          py(filepath, outputPath)
            .then(function(results) {
              reJSON(outputPath, prop.filename, 'spoiler');
              spoiler.push(outputPath.slice(15));
              if (filesLen === index + 1) {
                // 返回 spoiler 数组
                resolve(spoiler);
              }
            });
        });
      });
  });
}

/**
 * makeChassis 根据转换的JSON和汽车信息，组合chassis对象
 * @param  {Object} chassis        chassis
 * @param  {String} brand          汽车品牌
 * @param  {String} partRaw        去数字的配件名
 * @param  {Array}  spoiler        扰流板数组
 * @param  {String} jsonPath       转换的JSON路径
 * @param  {String} areaJsonPath   转换的area JSON路径
 * @return {undefined}
 */
function makeChassis(chassis, brand, partRaw, spoiler, jsonPath, areaJsonPath, previewPath) {
  var prop = Object.assign({}, tplParts[partRaw] || {});
  var outputJSON = JSON.parse(fs.readFileSync(jsonPath));
  if (outputJSON.materials) {
    prop.color = '#ffffff';
  }
  chassis[brand] = chassis[brand] || {};
  // 是否包含spoiler
  partRaw = partRaw.indexOf('spoiler') > -1 ? 'spoiler' : partRaw;
  // 每辆车的part属性
  prop = chassis[brand][partRaw] = chassis[brand][partRaw] || prop;
  // choice
  if (!prop.choices) {
    if (partRaw.indexOf('spoiler') > -1) {
      prop.choices = [''];
      // 向数组末尾添加spoiler路径数组
      prop.choices = prop.choices.concat(spoiler);
    } else {
      prop.choices = [];
    }
  }
  // 在数组索引1位置 插入路径
  prop.choices.splice(1, 0, jsonPath.slice(15));
  // area
  if (areaJsonPath) {
    prop.area = areaJsonPath.slice(15);
  }
  // 硬编码, TODO
  prop.previews = false;
  if (fileExists(previewPath)) {
    prop.previews = prop.previews || [];
    prop.previews.push(previewPath.slice(14));
  }
}

function chassisPromisePy(input, output) {
  return function(value) {
    return new Promise(function(resolve, reject) {

    });
  }
}

/**
 * chassisProcess 处理机身配件
 * @param  {[type]} path    [description]
 * @param  {[type]} spoiler [description]
 * @return {undefined}
 */
function chassisProcess(pattern, spoiler) {
  return new Promise(function(resolve, reject) {
    // 遍历 ./cars/accessory/ 目录下的 *.obj 文件
    glob(pattern)
      .then(function(files) {
        var chassis = {}; // chassis对象，处理完成后会生成chassis.json
        var filesLen = files.length; // 模型总数

        files.forEach(function(filepath, index) {
          // 分析配件属性
          var prop = file2prop(filepath);
          // 输出json目录：./output/chassis/a4
          var outputDir = 'output/chassis/' + prop.brand + '/';
          var outputPath = outputDir + prop.filename + '.json';
          // 如果输出目录不存在,则新建目录
          fileExists(outputDir) || fs.mkdirSync(outputDir);

          // 处理模型文件
          queue = queue.then(function() {
            return py(filepath, outputPath)
              .then(function(results) {
                var areaOutputPath;
                var areapath = 'cars/area/' + prop.brand + '/' + prop.part + '.obj';
                // 将转换的JSON再处理
                reJSON(outputPath, prop.brand, prop.part);
                // 利用fs检查是否在简模车中有对应同名的obj
                // 如果存在则输出 {{part}}-area.json
                if (fileExists(areapath)) {
                  // 有对应
                  areaOutputPath = outputDir + prop.part + '-area.json';
                  py(areapath, areaOutputPath)
                    .then(function(results) {
                      reJSON(areaOutputPath, prop.brand, prop.part);
                    });
                }

                var previewPath = ['cars/previews', prop.brand, prop.filename + '.png'].join(path.sep);
                makeChassis(chassis, prop.brand, prop.partRaw, spoiler, outputPath, areaOutputPath, previewPath);
                // 当处理了所有的文件
                if (filesLen === index + 1) {
                  fs.writeFileSync('output/chassis.json', jsonFormat(chassis));
                  resolve(chassis);
                }
              });
          });
        });
      });
  });
}

// 开始处理 wheels

/**
 * makeWheels 根据转换JSON路径和材料模型信息，组合wheels对象
 * @param  {Object} wheels   wheels对象
 * @param  {String} type     类型 tyre|rim
 * @param  {String} size     轮胎尺寸 14|15|16
 * @param  {String} brand    轮胎品牌 oz|antera|bbs
 * @param  {String} jsonPath 转换的JSON路径
 * @return {undefined}
 */
function makeWheels(wheels, type, size, brand, jsonPath) {
  var brandObj;
  var choices;
  jsonPath = jsonPath.slice(14);
  wheels[size] = wheels[size] || {
    tyre: {},
    rim: {}
  };
  if (type === 'rim') {
    brandObj = wheels[size][type][brand] = wheels[size][type][brand] || {};
    choices = brandObj.choices = brandObj.choices || []; // init
  } else if (type === 'tyre') {
    choices = wheels[size][type].choices = wheels[size][type].choices || []; // init
  }
  choices.push(jsonPath);
}

function wheelsProcess(pattern) {
  return new Promise(function(resolve, reject) {
    glob(pattern)
      .then(function(files) {
        var wheels = {};
        var filesLen = files.length;
        files.forEach(function(filepath, index) {
          var prop = file2prop(filepath);
          /*prop = {
            type: type,
            filename: filename,
            size: size,
            brand?: brand,
          };*/
          var outputDir;
          var outputPath;
          // 如果输出目录不存在,则新建目录
          var sizeDir = ['output/wheels', prop.size].join(path.sep);
          fileExists(sizeDir) || fs.mkdirSync(sizeDir);
          if (prop.type == 'rim') {
            // 输出json目录：./output/wheels/{{size}}/{{brand}}
            outputDir = [sizeDir, prop.brand].join(path.sep);
            outputPath = [outputDir, prop.filename + '.json'].join(path.sep);
            fileExists(outputDir) || fs.mkdirSync(outputDir);
          } else if (prop.type == 'tyre') {
            // 输出json目录：./output/wheels/{{size}}
            outputDir = sizeDir;
            outputPath = [outputDir, prop.filename + '.json'].join(path.sep);
          }
          py(filepath, outputPath)
            .then(function(results) {
              reJSON(outputPath, prop.size, prop.type);
              makeWheels(wheels, prop.type, prop.size, prop.brand, outputPath);
              // 处理了所有的 obj
              if (filesLen === index + 1) {
                fs.writeFileSync('output/wheels.json', jsonFormat(wheels));
                resolve(wheels);
              }
            });
        });
      });
  });
}

/**
 * 将tga转为png，输出路径由输入路径「智能」判断解析
 * @param  {String} input tga源文件路径
 * @return {String}       outputDir
 */
function tga2png(input) {
  /*
    file2prop('cars/preview/a3/trunk.png')
    { type: 'accessory',
      filename: 'trunk',
      brand: 'a3',
      part: 'trunk',
      partRaw: 'trunk',
      choice: undefined }
    file2prop('cars/accessory/atenzapj/cventsema.tga')
    { type: 'accessory',
      filename: 'cventsema',
      brand: 'atenza',
      part: 'cventsema',
      partRaw: 'cventsema',
      choice: undefined }
      output/chassis/parentDir(input).slice(0, -2)
    file2prop('cars/wheels/17/tyre17.tga')
    { type: 'tyre', filename: 'tyre17', size: '17' }
      output/wheels/{{size}}
    file2prop('cars/wheels/17/oz/rim17.tga')
    { type: 'rim', filename: 'rim17', size: '17', brand: 'oz' }
      output/wheels/{{size}}/{{brand}}
    file2prop('cars/轮毂总成/bmw3/rimsignbmw.tga')
    { type: 'accessory',
      filename: 'rimsignbmw',
      brand: 'bm',
      part: 'rimsignbmw',
      partRaw: 'rimsignbmw',
      choice: undefined }
  */
  return new Promise(function(resolve, reject) {
    var prop = file2prop(input);
    var outputDir;
    switch (prop.type) {
      case 'accessory':
        if (/pj$/.test(parentDir(input))) {
          outputDir = 'output/chassis/' + parentDir(input).slice(0, -2);
          break;
        }
        outputDir = 'output/chassis/' + parentDir(input);
        break;
      case 'tyre':
        outputDir = 'output/wheels/' + prop.size;
        break;
      case 'rim':
        outputDir = ['output/wheels', prop.size, prop.brand].join(path.sep);
        break;
      default:
        break;
    }
    console.log('converted ' + outputDir + '/' + prop.filename);
    if (outputDir) {
      imgc('"' + input + '"', outputDir, {
          format: 'png',
          quality: 'best',
        })
        .then(function() {
          resolve(outputDir);
        });
    }
  });
}

function tgaProcess(pattern) {
  return new Promise(function(resolve, reject) {
    glob(pattern)
      .then(function(files) {
        var filesLen = files.length;
        files.forEach(function(filepath, index) {
          tga2png(filepath)
            .then(function(outputDir) {
              if (filesLen === index + 1) {
                resolve();
              }
            });
        });
      });
  });
}

/**
 * makePosition 根据point.txt路径信息，组合position对象
 * @param  {Object} position position对象
 * @param  {String} brand    车型
 * @param  {String} type     wheels|spoiler
 * @param  {Array}  pointArr [x, y, z]
 * @return {undefined}
 */
function makePosition(position, brand, type, pointArr) {
  var brandObj = position[brand] = position[brand] || {};
  brandObj[type] = pointArr;
}

function pointProcess(pattern) {
  return new Promise(function(resolve, reject) {
    glob(pattern)
      .then(function(files) {
        var position = {};
        var filesLen = files.length;
        files.forEach(function(filepath, index) {
          var type;
          var brand = toLowerCase(parentDir(filepath));
          var pointArr = fs.readFileSync(filepath, 'utf8')
            .toString()
            .trim()
            .replace(/\r/g, '')
            .toLocaleLowerCase()
            .split('\n');

          if (filepath.indexOf('spoiler_point') > -1) {
            type = 'spoiler';
          } else {
            type = 'wheels';
          }
          pointArr = _.compact(pointArr);
          pointArr = pointArr.map(function(item) {
            return item.replace(/[^\d-\.]/g, '');
          })
          makePosition(position, brand, type, pointArr);
          if (filesLen === index + 1) {
            fs.writeFileSync('output/position.json', jsonFormat(position));
            resolve(position);
          }
        });
      });
  })
}

function previewProcess(pattern) {
  return new Promise(function(resolve, reject) {
    glob(pattern)
      .then(function(files) {
        var previews = {};
        var filesLen = files.length;
        files.forEach(function(filepath, index) {
          var prop = file2prop(filepath)
            /*{ type: 'preview',
              filename: 'trunk',
              brand: 'a3',
              part: 'trunk',
              partRaw: 'trunk',
              choice: undefined }*/
          var destPath = ['output/chassis', prop.brand, prop.filename + '-preview' + '.png'].join(path.sep);
          var readStream = fs.createReadStream(filepath);
          var writeStream = fs.createWriteStream(destPath);
          console.log('converted ' + destPath);
          readStream.pipe(writeStream);
          if (filesLen === index + 1) {
            resolve();
          }
        });
      });
  });
}

init()
  .then(function() {
    spoilerProcess('cars/spoiler/**/*.obj')
      .then(function(spoiler) {
        chassisProcess('cars/accessory/*/*.obj', spoiler)
          .then(function(chassis) {
            setTimeout(function() {
              wheelsProcess('cars/wheels/**/*.obj')
                .then(function(wheels) {
                  tgaProcess('cars/{wheels,accessory}/*/*.tga')
                    .then(function() {
                      pointProcess('cars/{spoiler_point,wheels_point}/**/*.txt')
                        .then(function(point) {
                          previewProcess('cars/previews/*/*.png')
                            .then(function() {

                            });
                        });
                    });
                });
            }, 3000); // 设定延时，以免读取错误
          });
      });
  });
