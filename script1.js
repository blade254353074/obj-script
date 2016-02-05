'use strict';
// 依赖模块
var fs = require('fs');
var path = require('path');
var _ = require('underscore');
var Q = require('q'); // q promise
// var jsonFormat = require('json-format'); // json格式化
var jsonFormat = function(json) {
  return JSON.stringify(json, null, 2);
}
var PythonShell = require('python-shell'); // py脚本 调用
var imgc = require('imgc'); // tga 图片格式转换
var gm = require('gm'); // GraphicsMagick and ImageMagick for node.js
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

function delay(ms) {
  return function(value) {
    return new Promise(function(resolve, reject) {
      setTimeout(resolve, ms, value);
    });
  }
}

/**
 * 调用 convert_obj_three.py 处理模型文件
 * @param  {String}   input    输入文件路径
 * @param  {String}   output   输出文件路径
 * @return {Object}            Promise对象
 */
function py(input, output) {
  return new Promise(function(resolve, reject) {
    // console.log('processing ' + input);
    PythonShell.run('convert_obj_three.py', {
      mode: 'text',
      args: ['-i', input, '-o', output, '-x', 0.5],
    }, function(err, results) {
      // 直接抛出，需检查模型文件
      if (err) {
        console.error('转换出错，请检查文件：', input, output);
        console.log(err);
        reject(err);
        return;
      }
      console.log('processed ' + input);
      resolve(results);
    });
  });
}

/**
 * 对py转换的JSON再进行处理（修改materials属性，将tga转为png）
 * @param  {String}  output json文件的路径
 * @param  {String}  brand  lastDir
 * @param  {String}  part   配件名，如tyre rim spoiler
 * @param  {Boolean} area   是否是 area
 * @return {undefined}
 */
function reJSON(output, brand, part, area) {
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
      // 若materials中包含tga，则转换为png
      if (value.mapAmbient) {
        value.mapDiffuse = value.mapAmbient = value.mapAmbient && value.mapAmbient.replace(/\.tga$/g, '.png');
        Object.assign(value, {
          colorAmbient: [1, 1, 1],
          colorDiffuse: [1, 1, 1],
          colorSpecular: [1, 1, 1]
        });
      } else if (!area) {
        // 没贴图且不是area，添加 shading: "phong" (不包括area)
        value.shading = 'phong';
        // Object.assign(value, {
        //   colorAmbient: [1, 1, 1],
        //   colorDiffuse: [1, 1, 1],
        //   colorSpecular: [1, 1, 1]
        // });
      }
      // 放在最后覆盖111配置
      if (tplConvert[part]) {
        Object.assign(value, tplConvert[part]);
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
  // filepath(accessory):  cars/accessory/{{brand}}pj/{{part}}-{{choice}}.obj
  // filepath(accessory):  cars/accessory/{{brand}}/{{part}}-{{choice}}.obj
  // filepath(rim):        cars/wheels/rims/{{size}}/{{filename}}.obj
  // filepath(tyre):       cars/wheels/tyres/{{size}}/{{filename}}.obj
  var prop;
  var brand;
  var size;
  var fileprop = path.parse(filepath);
  var lastDir = toLowerCase(parentDir(filepath));
  var secondLastDir = toLowerCase(parentDir(filepath, '../'));
  var filename = toLowerCase(fileprop.name);

  // 判断类型的逻辑 v2
  if (filepath.indexOf('/accessory/') > -1) {
    type = 'accessory';
  } else {
    if (filepath.indexOf('/wheels/rims/') > -1) {
      type = 'rim';
    } else if (filepath.indexOf('/wheels/tyres/') > -1) {
      type = 'tyre';
    }  else if (filepath.indexOf('/wheels/calipers/') > -1) {
      type = 'caliper';
    } else {
      type = 'accessory';
    }
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
        partRaw: partRaw
      };
      break;
    case 'rim':
      // 轮毂
      // 目前不要品牌
    case 'tyre':
      // 轮胎
    case 'caliper':
      // 卡钳
      size = lastDir; // 14
      prop = {
        type: type,
        filename: fileprop.name,
        size: size
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
  return function() {
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
}

function addMaterial(prop, partRaw) {
  switch (partRaw) {
    case 'body':
    case 'fbumper':
    case 'rbumper':
    case 'sideskirt':
    case 'hood':
    case 'roof':
    case 'trunk':
    case 'spoiler':
    case 'reflector':
      prop.material = 'normal';
      prop.materials = [
        'carbon',
        'discolor',
        'drawbench',
        'electroplate',
        'matte',
        'matting',
        'normal'
      ]
      break;
    case 'rim':
    case 'caliper':
      prop.material = 'steel';
      prop.materials = [
        'discolor',
        'electroplate',
        'matte'
      ]
      break;
    case 'tyre':
    case 'chassis':
    case 'interior':
      break;
    case 'lens':
    case 'glass':
      prop.material = 'glass';
      break;
    default:
      break;
  }
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
function makeChassis(chassis, brand, partRaw, spoiler, jsonPath, areaJsonPath, previewOriginPath, previewPath) {
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
      // 向数组末尾添加公共 spoiler 路径数组
      prop.choices = [];
      prop.choices = prop.choices.concat(spoiler);
    } else {
      prop.choices = [];
    }
  }
  // 给 prop 添加 material 属性
  addMaterial(prop, partRaw);
  // 在数组索引0位置 插入路径
  prop.choices.splice(0, 0, jsonPath.slice(15));
  // area
  if (areaJsonPath) {
    prop.area = areaJsonPath.slice(15);
  }
  // 硬编码, TODO
  prop.previews = prop.previews || false;
  if (fileExists(previewOriginPath)) {
    prop.previews = prop.previews || [];
    prop.previews.push(previewPath.slice(14));
  }
}


// 处理chassis中 choice顺序问题
function chassisPropSort(chassis) {
  _.forEach(chassis, function(car, brand) {
    // car为汽车信息对象，brand是品牌名
    _.forEach(car, function(part, partname) {
      // choices有多个，需处理choice顺序
      if (part.choices && part.choices.length > 1) {
        part.choices.sort(function(first, last) {
          if (first === '') {
            return false;
          } else {
            return last.length < first.length;
          }
        });
      }
      if (part.previews && part.previews.length > 1) {
        part.previews.sort(function(first, last) {
          return last.length < first.length;
        });
      }
    });
  });
}

// 处理模型的area，输出areaOutputPath
function chassisAreaProcess(outputDir, brand, part) {
  var outputPath;
  var areapath = 'cars/part_area/' + brand + '/' + part + '.obj';
  // 将转换的JSON再处理
  // 利用fs检查是否在简模车中有对应同名的obj
  // 如果存在则输出 {{part}}-area.json
  if (fileExists(areapath)) {
    // 有对应
    outputPath = outputDir + part + '-area.json';
    py(areapath, outputPath)
      .then(function() {
        reJSON(outputPath, brand, part, true);
      });
  }
  return outputPath; // 有path / undefined
}

/**
 * chassisProcess 处理机身配件
 * @param  {[type]} path    [description]
 * @param  {[type]} spoiler [description]
 * @return {undefined}
 */
function chassisProcess(pattern) {
  return function(spoiler) {
    return new Promise(function(resolve, reject) {
      // 遍历 ./cars/part/** 目录下的 *.obj 文件
      glob(pattern)
        .then(function(files) {
          var chassis = {}; // chassis对象，处理完成后会生成chassis.json
          var filesLen = files.length; // 模型总数
          // promises chain 避免 child_process过量
          var promises = Promise.resolve();
          files.forEach(function(filepath, index) {
            // 分析配件属性
            var prop = file2prop(filepath);
            // 输出json目录：./output/chassis/a4
            var outputDir = 'output/chassis/' + prop.brand + '/';
            var outputPath = outputDir + prop.filename + '.json';
            // 如果输出目录不存在,则新建目录
            fileExists(outputDir) || fs.mkdirSync(outputDir);

            // 处理模型文件
            promises = promises.then(function() {
              return py(filepath, outputPath)
                .then(function(results) {
                  reJSON(outputPath, prop.brand, prop.part);
                  var areaOutputPath = chassisAreaProcess(outputDir, prop.brand, prop.part);
                  var previewOriginPath = ['cars/previews', prop.brand, prop.filename + '.png'].join(path.sep);
                  var previewPath = ['cars/previews', prop.brand, prop.filename + '-preview.png'].join(path.sep);
                  makeChassis(chassis, prop.brand, prop.partRaw, spoiler, outputPath, areaOutputPath, previewOriginPath, previewPath);
                  // 当处理了所有的文件
                  if (filesLen === index + 1) {
                    // 处理chassis中 choice/previews 顺序问题
                    chassisPropSort(chassis);
                    fs.writeFileSync('output/chassis.json', jsonFormat(chassis));
                    resolve(chassis);
                  }
                });
            });
          });
        });
    });
  }
}

// 开始处理 wheels

function makePubWheels(areaWheels, size, type, jsonPath) {
  areaWheels[size] = areaWheels[size] || {};
  // output/wheels/rim/16.json
  areaWheels[size][type] = jsonPath.slice(14);
}

// cars/wheels_area/*/*.obj
function areaWheelsProcess(pattern) {
  return function() {
    return new Promise(function(resolve, reject) {
      glob(pattern)
        .then(function(files) {
          var areaWheels = {};
          var filesLen = files.length;
          files.forEach(function(filepath, index) {
            var prop = file2prop(filepath);
            /*var prop = file2prop('cars/wheels_area/rim/16.obj');
            { type: 'accessory',
              filename: '16',
              brand: 'rim',
              part: '16',
              partRaw: '',
              choice: undefined }
            var prop = file2prop('cars/wheels_area/tyre/tyre16.obj');
            { type: 'accessory',
              filename: 'tyre16',
              brand: 'tyre',
              part: 'tyre16',
              partRaw: 'tyre',
              choice: undefined }*/
            // 提取 tyre16/16 中的数字
            prop.part = prop.part.match(/\d+/)[0];
            var outputDir = 'output/wheels';
            outputDir += ('/' + prop.brand);
            fileExists(outputDir) || fs.mkdirSync(outputDir);
            // output/wheels/rim/16.json output/wheels/tyre/tyre16.json
            var outputPath = [outputDir, prop.filename + '.json'].join(path.sep);
            py(filepath, outputPath)
              .then(function(results) {
                reJSON(outputPath, prop.brand, prop.brand, true);
                makePubWheels(areaWheels, prop.part, prop.brand, outputPath);
                // 处理了所有的 obj
                if (filesLen === index + 1) {
                  resolve(areaWheels);
                }
              });
          });
        });
    });
  }
}

/**
 * makeWheels 根据转换JSON路径和材料模型信息，组合wheels对象
 * @param  {Object} wheels      wheels对象
 * @param  {String} type        类型 tyre|rim
 * @param  {String} size        轮胎尺寸 14|15|16
 * @param  {String} jsonPath    转换的JSON路径
 * @param  {Object} areaWheels  wheel area 对象
 * @param  {String} previewPath 轮毂预览图
 * @return {undefined}
 */
function makeWheels(wheels, type, size, jsonPath, areaWheels, previewPath) {
  var rimBrandObj;
  var choices;
  var prop;
  var outputJSON;
  var relativeJsonPath = jsonPath.slice(14);
  wheels[size] = wheels[size] || {
    tyre: {
      choices: []
    },
    rim: {
      choices: []
    },
    caliper: {
      choices: []
    }
  };
  prop = wheels[size][type];
  if (type === 'rim') {
    outputJSON = JSON.parse(fs.readFileSync(jsonPath));
    if (outputJSON.materials) {
      prop.color = '#ffffff';
    }
    addMaterial(prop, type);
    if (previewPath) {
      prop.previews = prop.previews || [];
      prop.previews.push(previewPath.slice(14));
    }
  } else if (type === 'caliper') {
    // HardCode
    prop.material = 'steel';
  }
  prop.area = areaWheels[size][type];
  prop.choices.push(relativeJsonPath);
  Object.assign(prop, tplParts[type]);

  prop.previews = prop.previews || false;
}

function wheelsProcess(pattern) {
  return function(areaWheels) {
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
              size: size
            };*/
            var outputDir;
            var outputPath;
            // 如果输出目录不存在,则新建目录
            var sizeDir = ['output/wheels', prop.size].join(path.sep);
            fileExists(sizeDir) || fs.mkdirSync(sizeDir);
            outputDir = sizeDir;
            outputPath = [outputDir, prop.filename + '.json'].join(path.sep);

            py(filepath, outputPath)
              .then(function(results) {
                var previewOriginPath;
                var previewOriginPNGPath = ['cars/wheels/rims', prop.size, prop.filename + '.png'].join(path.sep);
                var previewOriginJPGPath = ['cars/wheels/rims', prop.size, prop.filename + '.jpg'].join(path.sep);
                var previewPath;
                if (fileExists(previewOriginPNGPath)) {
                  previewOriginPath = previewOriginPNGPath;
                  previewPath = ['output/wheels', prop.size, prop.filename + '-preview.png'].join(path.sep);
                } else if (fileExists(previewOriginJPGPath)) {
                  previewOriginPath = previewOriginJPGPath;
                  previewPath = ['output/wheels', prop.size, prop.filename + '-preview.jpg'].join(path.sep);
                }
                // 复制jpg png
                previewOriginPath && fileCopy(previewOriginPath, previewPath);
                reJSON(outputPath, prop.size, prop.type);
                makeWheels(wheels, prop.type, prop.size, outputPath, areaWheels, previewPath);
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
    file2prop('cars/wheels/rims/15/MSW-11.png')
    Object {type: "rim", filename: "MSW-11", size: "15"}
    file2prop('cars/wheels/tyres/15/tyre15.png')
    Object {type: "tyre", filename: "tyre15", size: "15"}
  */
  return new Promise(function(resolve, reject) {
    var prop = file2prop(input);
    var outputDir;
    var outputPath;
    switch (prop.type) {
      case 'accessory':
        if (/pj$/.test(parentDir(input))) {
          outputDir = 'output/chassis/' + parentDir(input).slice(0, -2);
          break;
        }
        outputDir = 'output/chassis/' + parentDir(input);
        break;
      case 'rim':
      case 'tyre':
      case 'caliper':
        outputDir = 'output/wheels/' + prop.size;
        break;
      default:
        break;
    }
    if (outputDir) {
      outputPath = outputDir + '/' + prop.filename + '.png'
      fileExists(outputDir) || fs.mkdirSync(outputDir);
      gm(input)
        .write(outputPath, function(err) {
          if (err) {
            console.log(err);
            reject(err);
            return;
          }
          console.log('converted ' + outputPath);
          resolve(outputPath);
        });
    }
  });
}

function tgaProcess(pattern) {
  return function() {
    return new Promise(function(resolve, reject) {
      glob(pattern)
        .then(function(files) {
          var filesLen = files.length;
          files.forEach(function(filepath, index) {
            tga2png(filepath)
              .then(function(outputPath) {
                if (filesLen === index + 1) {
                  resolve(outputPath);
                }
              });
          });
        });
    });
  }
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
  return function() {
    return new Promise(function(resolve, reject) {
      glob(pattern)
        .then(function(files) {
          var position = {};
          var filesLen = files.length;
          files.forEach(function(filepath, index) {
            var type;
            var filename = toLowerCase(path.basename(filepath, '.txt'));
            var brand = filename.slice(filename.lastIndexOf('-') + 1);
            var pointArr = fs.readFileSync(filepath, 'utf8')
              .toString()
              .trim()
              .replace(/\r/g, '')
              .toLocaleLowerCase()
              .split('\n');
            pointArr = _.compact(pointArr);
            pointArr = pointArr.map(function(item) {
              return item.replace(/[^\d-\.]/g, '');
            })

            if (filepath.indexOf('wheels-') > -1) {
              type = 'wheels';
            } else {
              type = 'spoiler';
            }
            makePosition(position, brand, type, pointArr);
            if (filesLen === index + 1) {
              fs.writeFileSync('output/position.json', jsonFormat(position));
              resolve(position);
            }
          });
        });
    })
  }
}

function previewProcess(pattern) {
  return function() {
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
            fileCopy(filepath, destPath);
            console.log('converted ' + destPath);
            if (filesLen === index + 1) {
              resolve();
            }
          });
        });
    });
  }
}

function fileCopy(input, output) {
  var readStream = fs.createReadStream(input);
  var writeStream = fs.createWriteStream(output);
  // 复制
  readStream.pipe(writeStream);
}

function start() {
  return new Promise(function(resolve, reject) {
    try {
      var timeStart = Date.now().valueOf();
      // init()
        // .then(spoilerProcess('cars/spoiler/**/*.obj')) // 向后传递 spoiler 数组
        // .then(chassisProcess('cars/part/*/*.obj'))
        // .then(delay(3000))
        Promise.resolve()
        .then(areaWheelsProcess('cars/wheels_area/*/*.obj')) // 向后传递 areaWheels 对象
        .then(wheelsProcess('cars/wheels/**/*.obj')) // 向后传递 wheels 对象
        .then(tgaProcess('cars/{wheels,part}/**/*.tga'))
        // .then(pointProcess('cars/part_point/*.txt')) // 向后传递 point 对象
        // .then(previewProcess('cars/previews/*/*.png'))
        .then(function() {
          resolve(timeStart);
        })
        .catch(function(e) {
          console.log(e);
        });
    } catch (e) {
      reject(e);
    }
  });
}

start()
  .then(function(timeStart) {
    var timeEnd = Date.now().valueOf();
    console.log('总耗时: ' + (timeEnd / 1000 - timeStart / 1000).toFixed(2) + 's');
  })
  .catch(function(err) {
    throw err;
  });


// areaWheelsProcess('cars/wheels_area/*/*.obj')()
//   .then(wheelsProcess('cars/wheels/**/*.obj'));

// glob('cars/scenes/*.obj')
//   .then(function(files) {
//     var filesLen = files.length;
//     files.forEach(function(filepath, index) {
//       var prop = file2prop(filepath);
//       var outputDir = 'output/';
//       var outputPath = outputDir + prop.filename + '.json';
//       py(filepath, outputPath)
//         .then(function(results) {
//           reJSON(outputPath, prop.filename);
//           if (filesLen === index + 1) {
//             // 返回 spoiler 数组
//             //fs.writeFileSync('output/chassis.json', jsonFormat(chassis));
//           }
//         });
//     });
//   });
// glob('cars/scenes/*.tga')
//   .then(function(files) {
//     var filesLen = files.length;
//     files.forEach(function(filepath, index) {
//       var prop = file2prop(filepath);
//       var outputDir = 'output/';
//       var outputPath = outputDir + prop.filename + '.png';
//       gm(filepath)
//         .write(outputPath, function(err) {
//           if (err) {
//             console.log(err);
//             reject(err);
//             return;
//           }
//           console.log('converted ' + outputPath);
//         });
//     });
//   });
