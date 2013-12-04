var CORS_PROXY = 'http://cors.io/';

var exportWrapper = document.getElementById('export');
var placeholder = document.getElementById('svgPlaceholder');
var info = document.getElementById('info');
var submit = document.getElementById('submit');

var error = function(err) {
  info.innerHTML = "Can't visualize document due to error (error: " +
    err.error + "; reason: " + err.reason + ")";
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

  url.dbUrl = url.protocol + '//' + url.hostname + '/' + url.db;

  return url;
}

function initDB(dbUrl, callback) {

  new Pouch(dbUrl, function(err, db) {

    // Likely a CORS problem
    if (err && err.status === 0) {
      dbUrl = CORS_PROXY + dbUrl.replace(/^https?:\/\//, '');
      return new Pouch(dbUrl, callback);
    }

    callback(err, db);
  });
}

function doVisualisation(urlStr) {

  placeholder.innerHTML = '';
  info.innerHTML = 'Loading ...';
  exportWrapper.style.display = 'none';
  submit.setAttribute('disabled', 'disabled');

  var url = parseUrl(urlStr);

  initDB(url.dbUrl, function(err, db) {

    if (err) {
      return error(err);
    }

    visualizeRevTree(db, url.doc, function(err, box) {

      if (err) {
        return error(err);
      }

      var svg = box.getElementsByTagName('svg')[0];
      svg.style.width = svg.getAttribute('viewBox').split(' ')[2] * 7 + 'px';
      svg.style.height = svg.getAttribute('viewBox').split(' ')[3] * 7 + 'px';

      placeholder.appendChild(box);
      info.innerHTML = '';
      exportWrapper.style.display = 'block';
      submit.removeAttribute('disabled');

    });
  });
}

function exportDoc() {

  var url = parseUrl(document.getElementById('url').value);

  initDB(url.dbUrl, function(err, db) {

    if (err) {
      return error(err);
    }

    db.get(url.doc, {revs: true, open_revs: "all"}, function(err, results) {
      var docs = [];
      results.forEach(function(row){
        docs.push(row.ok);
      });
      console.log("Exported docs: ", JSON.stringify(docs));
      console.log("Pouchdb format: ", "db.bulkDocs({docs:" +
                  JSON.stringify(docs) +
                  "}, {new_edits:false}, function(err, res){})");
    });
  });
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
