var CORS_PROXY =  'http://nodejs-neojski.rhcloud.com/';

var PouchDB = require('pouchdb');
var visualizeRevTree = require('./lib/visualizeRevTree');

var exportWrapper = document.getElementById('export');
var placeholder = document.getElementById('svgPlaceholder');
var info = document.getElementById('info');
var submit = document.getElementById('submit');

var error = function(err) {
  console.log(err);
  var str = '';
  if (err.error) {
    str = 'error: ' + err.error + ', reason: ' + err.toString();
  } else {
    str = err.toString();
  }
  info.innerHTML = "We encountered an error: " + str;
  submit.removeAttribute('disabled');
  exportWrapper.style.display = 'none';
};

function parseUrl(str) {
  var url = document.createElement('a');
  url.href = str;
  var path = url.pathname.split('/');

  // Remove '' cause by preceeding /
  path.shift();

  url.db = path.shift();
  url.doc = path.join('/');

  url.dbUrl = url.protocol + '//' + url.host + '/' + url.db;

  return url;
}

function isLocalhost(str) {
  var url = document.createElement('a');
  url.href = str;
  return url.host === 'localhost' || url.host === '127.0.0.1';
}

function initDB(dbUrl) {
  return new PouchDB(dbUrl).catch(function (err) {
    console.log('first try error', err);

    if (isLocalhost(dbUrl) && !isLocalhost(location.href)) {
      alert('Cannot reach your localhost from the web. Try something online.');
      throw 'Localhost not possible';
    }

    // Likely a CORS problem
    if (err && err.status === 500) {
      error('Re-trying with cors proxy.')

      dbUrl = CORS_PROXY + dbUrl.replace(/https?:\/\//, '');
      return new PouchDB(dbUrl);
    } else {
      throw err;
    }
  });
}

function doVisualisation(urlStr) {

  placeholder.innerHTML = '';
  info.innerHTML = 'Loading ...';
  exportWrapper.style.display = 'none';
  submit.setAttribute('disabled', 'disabled');

  var url = parseUrl(urlStr);

  initDB(url.dbUrl).then(function(db) {
    return visualizeRevTree(db, url.doc).then(function(box) {
      var svg = box.getElementsByTagName('svg')[0];
      svg.style.width = svg.getAttribute('viewBox').split(' ')[2] * 7 + 'px';
      svg.style.height = svg.getAttribute('viewBox').split(' ')[3] * 7 + 'px';

      placeholder.appendChild(box);
      info.innerHTML = '';
      exportWrapper.style.display = 'block';
      submit.removeAttribute('disabled');
    });
  }, error);
}

function exportDoc() {
  var url = parseUrl(document.getElementById('url').value);

  initDB(url.dbUrl).then(function (db) {
    db.get(url.doc, {revs: true, open_revs: "all"}, function(err, results) {
      var docs = results.forEach(function(row){
        return row.ok;
      });
      console.log("Exported docs: ", JSON.stringify(docs));
      console.log("Pouchdb format: ", "db.bulkDocs({docs:" +
                  JSON.stringify(docs) +
                  "}, {new_edits:false}, function(err, res){})");
    });
  }, error);
}

function parseArgs() {
  var query = location.search.substr(1);
  var data = query.split("&");
  var result = {};
  for(var i = 0; i < data.length; i++) {
    var item = data[i].split("=");
    result[item[0]] = decodeURIComponent(item[1]);
  }
  return result;
}

document.getElementById('exportButton').addEventListener('click', exportDoc);

var args = parseArgs();
if (args.url) {
  // Browsers are stupid and sometimes add a / to the end of the query param
  var url = args.url.replace(/\/+$/, "");
  document.getElementById('url').value = url;
  doVisualisation(url);
}
