import _ from "lodash"
import xml2js from "xml2js"
import forge from "node-forge"
import request from "request"
import md5 from "md5"


function findContent(content) {
  if (_.isString(content)) {
    return content
  }
  if (_.isPlainObject(content)) {
    return findContent(content.value)
  }
  if (_.isArray(content)) {
    return findContent(content[0])
  }

  return null;
  // msg2.rawCapture.content.value[0].value[0].value
}

// module.exports = class Ykassa
export default class Ykassa {


  constructor(params) {
    this.defaultParams = {
      mime: "application/pkcs7-mime",
      tmp: "/tmp",

      cardServer: "paymentcard.yamoney.ru",
    }
    this.params = _.assignInWith({}, params, this.defaultParams);
  }

  getXml(params) {
    const builder = new xml2js.Builder();
    return builder.buildObject(params);
  }

  getRequestParams(rawParams = {}) {
    const date = new Date()
    let params = _.clone(rawParams);
    if (!params.agentId && this.params.agentId) {
      params.agentId = this.params.agentId
    }
    if (!params.clientOrderId) {
      params.clientOrderId = date.getTime()
    }
    if (!params.requestDT) {
      params.requestDT = date.toISOString()
    }
    if (!params.currency && this.params.currency) {
      params.currency = this.params.currency
    }

    return params;
  }

  generateHash(request, shopPassword = this.params.shopPassword) {

    const {
      action,
      orderSumAmount,
      orderSumCurrencyPaycash,
      orderSumBankPaycash,
      shopId,
      invoiceId,
      customerNumber
    } = request;

    return (
      md5([
        action,
        orderSumAmount,
        orderSumCurrencyPaycash,
        orderSumBankPaycash,
        shopId,
        invoiceId,
        customerNumber,
        shopPassword
      ].join(';'))
      .toUpperCase()
    );
  }

  checkMD5(request, shopPassword) {
    const {
      md5: originalHash
    } = request;
    const resultHash = this.generateHash(request, shopPassword);

    return resultHash === originalHash;
  }


  //
  // Build XML response
  //
  buildResponse(action, params) {
    const performedDatetime = new Date().toISOString();
    console.log("buildResponse", action, params)

    const {code, shopId, invoiceId, message} = params;
    return this.getXml({
      [`${action}Response`]: {
        '$': {
          performedDatetime,
          code,
          invoiceId,
          shopId,
          message
        }
      }
    });
  }

  /**
   * API для массовых выплат
   */

  decryptPack2(pem) {
    var msg = forge.pem.decode(pem)[0];
    console.log("decryptPack", msg)
    var obj = forge.asn1.fromDer(msg.body);
    console.log("obj", obj)
    var msg2 = forge.pkcs7.messageFromAsn1(obj)
    console.log("msg2", msg2)
    return findContent(msg2.rawCapture.content)
  }

  decryptPack(pem) {
    const date = new Date();
    var id = date.getTime().toString()

    var fs = require("fs");
    var path = require("path");
    var file = path.join(this.params.tmp, id)
    var execSync = require('child_process').execSync;
    fs.writeFileSync(`${file}.pem`, pem)

// ../kassa/strategystroy/strategy_demo/depositresponsegenerator.cer
    var command = `openssl smime -verify \
    -in ${file}.pem \
    -inform PEM \
    -nointern \
    -certfile ${this.params.ssl.serverCertPath} \
    -CAfile ${this.params.ssl.serverCertPath} \
    -out ${file}.xml`

    // var command = `openssl smime -sign -in ${file}.xml -out ${file}.pem -nochain -nocerts -nodetach -outform PEM -signer ${this.params.ssl.certPath} -inkey ${this.params.ssl.keyDecPath}`;
    execSync(command);
    const data = fs.readFileSync(`${file}.xml`).toString();

    // fs.unlinkSync(`${file}.pem`)
    // fs.unlinkSync(`${file}.xml`)
    return data;

  }
  encryptPack(str) {
    const date = new Date();
    var id = date.getTime().toString()
    var fs = require("fs");
    var path = require("path");
    var file = path.join(this.params.tmp, id)
    var execSync = require('child_process').execSync;
    fs.writeFileSync(`${file}.xml`, str)
    var command = `openssl smime -sign -in ${file}.xml -out ${file}.pem -nochain -nocerts -nodetach -outform PEM -signer ${this.params.ssl.certPath} -inkey ${this.params.ssl.keyDecPath}`;
    execSync(command);
    const data = fs.readFileSync(`${file}.pem`).toString();

    // fs.unlinkSync(`${file}.pem`)
    // fs.unlinkSync(`${file}.xml`)
    return data;
  }

  doRequest(method, xml, next) {
    const url = "https://" + this.params.server + "/webservice/deposition/api/" + method
    const pack = this.encryptPack(xml);
    request.post({
      url: url,
      headers: {
        'Accept': this.params.mime,
        'Content-Type': this.params.mime,
      },
      agentOptions: this.params.ssl,
      body: pack
    }, function(err, response, body) {
      if (err) return next(err)
      const xml2 = this.decryptPack(body)
      next(null, xml2)
    }.bind(this));

  }


  storeCard(card, next) {
    const url = "https://" + this.params.cardServer + "/gates/card/storeCard"
    var json = {
      skr_destinationCardNumber: card,
      skr_responseFormat: "json"
    }
    request.post({
      url: url,
      form: json
    }, function(err, response, body) {
      if (err) return next(err)
      next(null, JSON.parse(body))
    }.bind(this))
  }

  getCardSynonim(card, next) {
    this.storeCard(card, (err, data) => {
      if (err) return next(err)
      next(null, data.storeCard.skr_destinationCardSynonim)
    })

  }

  testDeposition(rawParams, next) {
    const params = this.getRequestParams(rawParams)

    let root = {
      $: params
    };
    if (params.paymentParams) {
      root.paymentParams = params.paymentParams;
      delete params.paymentParams
    }

    const xml = this.getXml({
      testDepositionRequest: root
    });
    this.doRequest("testDeposition", xml, next)
  }

  makeDeposition(rawParams, next) {
    const params = this.getRequestParams(rawParams)

    let root = {
      $: params
    };
    if (params.paymentParams) {
      root.paymentParams = params.paymentParams;
      delete params.paymentParams
    }

    const xml = this.getXml({
      makeDepositionRequest: root
    });
    this.doRequest("makeDeposition", xml, next)
  }

  balance(rawParams, next) {
    if (typeof rawParams == "function") {
      next = rawParams;
      rawParams = {};
    }
    const params = this.getRequestParams(rawParams)
    const xml = this.getXml({
      balanceRequest: {
        $: params
      }
    });
    this.doRequest("balance", xml, next)
  }
}
