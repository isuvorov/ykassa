'use strict'


// // REVIEW: Не нашел как сделать лучше
// Promise = require('bluebird')
// Promise.longStackTraces()
// global.Promise = Promise

var isProduction = process.env.NODE_ENV === 'production'
// const nodePath = isProduction ? "lib" : "src"
var nodePath = "lib"
var entryPoint = './' + nodePath + '/ykassa'
//
// if (!isProduction) {
//   const PrettyError = require('pretty-error')
//   const pe = new PrettyError()
//
//   pe
//     .skipNodeFiles()
//     .skipPackage(
//       'babylon',
//       'babel-core',
//       'babel-traverse'
//     )
//     .start()
// }

module.exports = require(entryPoint)
