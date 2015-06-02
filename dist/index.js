(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
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
    return db.get(url.doc, {revs: true, open_revs: "all"}).then(function(results) {
      var docs = results.map(function(row){
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

},{"./lib/visualizeRevTree":4,"pouchdb":34}],2:[function(require,module,exports){
module.exports = function (db, docId) {
  return db.get(docId).catch(function (err) {
    if (err.reason !== "deleted") {
      throw err;
    }
  }).then(function(doc){ // get winning revision here
    var winner = doc._rev;
    return db.get(docId, {revs: true, open_revs: "all"}).then(function(results){
      var deleted = {};
      var paths = results.map(function(res) {
        res = res.ok; // TODO: what about missing
        if (res._deleted) {
          deleted[res._rev] = true;
        }
        var revs = res._revisions;
        return revs.ids.map(function(id, i) {
          return (revs.start-i) + '-' + id;
        });
      });
      return {
        paths: paths,
        deleted: deleted,
        winner: winner
      };
    });
  });
};

},{}],3:[function(require,module,exports){
// returns minimal number i such that prefixes of lenght i are unique
// ex: ["xyaaa", "xybbb", "xybccc"] -> 4
function strCommon(a, b){
  if (a === b) return a.length;
  var i = 0;
  while(++i){
    if(a[i - 1] !== b[i - 1]) return i;
  }
}

module.exports = function(arr){
  var array = arr.slice(0);
  var com = 1;
  array.sort();
  for (var i = 1; i < array.length; i++){
    com = Math.max(com, strCommon(array[i], array[i - 1]));
  }
  return com;
};

},{}],4:[function(require,module,exports){
"use strict";

var getTree = require('./getTree');
var minUniq = require('./minUniq');

var grid = 10;
var scale = 7;
var r = 1;

module.exports = function(db, docId, callback) {
  function draw(paths, deleted, winner, minUniq){
    var maxX = grid;
    var maxY = grid;
    var levelCount = []; // numer of nodes on some level (pos)

    var map = {}; // map from rev to position
    var levelCount = [];

    function drawPath(path) {
      for (var i = 0; i < path.length; i++) {
        var rev = path[i];
        var isLeaf = i === 0;
        var pos = +rev.split('-')[0];

        if (!levelCount[pos]) {
          levelCount[pos] = 1;
        }
        var x = levelCount[pos] * grid;
        var y = pos * grid;

        if (!isLeaf) {
          var nextRev = path[i-1];
          var nextX = map[nextRev][0];
          var nextY = map[nextRev][1];

          if (map[rev]) {
            x = map[rev][0];
            y = map[rev][1];
          }

          line(x, y, nextX, nextY);
        }
        if (map[rev]) {
          break;
        }
        maxX = Math.max(x, maxX);
        maxY = Math.max(y, maxY);
        levelCount[pos]++;
        node(x, y, rev, isLeaf, rev in deleted, rev === winner, minUniq);
        map[rev] = [x, y];
      }
    }
    paths.forEach(drawPath);

    svg.setAttribute('viewBox', '0 0 ' + (maxX + grid) + ' ' + (maxY + grid));
    svg.style.width = scale * (maxX + grid) + 'px';
    svg.style.height = scale * (maxY + grid) + 'px';
    return box;
  };

  function error(err) {
    console.error(err);
    alert("error occured, see console");
  }

  var putAfter = function(doc, prevRev){
    var newDoc = JSON.parse(JSON.stringify(doc));
    newDoc._revisions = {
      start: +newDoc._rev.split('-')[0],
      ids: [
        newDoc._rev.split('-')[1],
        prevRev.split('-')[1]
      ]
    };
    return db.put(newDoc, {new_edits: false});
  };

  var svgNS = "http://www.w3.org/2000/svg";
  var box = document.createElement('div');
  box.className = "visualizeRevTree";
  var svg = document.createElementNS(svgNS, "svg");
  box.appendChild(svg);
  var linesBox = document.createElementNS(svgNS, "g");
  svg.appendChild(linesBox);
  var circlesBox = document.createElementNS(svgNS, "g");
  svg.appendChild(circlesBox);
  var textsBox = document.createElementNS(svgNS, "g");
  svg.appendChild(textsBox);

  var circ = function(x, y, r, isLeaf, isDeleted, isWinner) {
    var el = document.createElementNS(svgNS, "circle");
    el.setAttributeNS(null, "cx", x);
    el.setAttributeNS(null, "cy", y);
    el.setAttributeNS(null, "r", r);
    if (isLeaf) {
      el.classList.add("leaf");
    }
    if (isWinner) {
      el.classList.add("winner");
    }
    if (isDeleted) {
      el.classList.add("deleted");
    }
    circlesBox.appendChild(el);
    return el;
  };

  var line = function(x1, y1, x2, y2) {
    var el = document.createElementNS(svgNS, "line");
    el.setAttributeNS(null, "x1", x1);
    el.setAttributeNS(null, "y1", y1);
    el.setAttributeNS(null, "x2", x2);
    el.setAttributeNS(null, "y2", y2);
    linesBox.appendChild(el);
    return el;
  };

  var focusedInput;
  function input(text){
    var div = document.createElement('div');
    div.classList.add('input');
    var span = document.createElement('span');
    div.appendChild(span);
    span.appendChild(document.createTextNode(text));
    var clicked = false;
    var input;

    div.ondblclick = function() {
      if(clicked){
        input.focus();
        return;
      }
      clicked = true;
      div.removeChild(span);
      input = document.createElement('input');
      div.appendChild(input);
      input.value = text;
      input.focus();

      input.onkeydown = function(e){
        if(e.keyCode === 9 && !e.shiftKey){
          var next;
          if(next = this.parentNode.parentNode.nextSibling){
            next.firstChild.ondblclick();
            e.preventDefault();
          }
        }
      };
    };
    div.getValue = function() {
      return clicked ? input.value : text;
    };
    return div;
  }

  function node(x, y, rev, isLeaf, isDeleted, isWinner, shortDescLen){
    var nodeEl = circ(x, y, r, isLeaf, isDeleted, isWinner);
    var pos = rev.split('-')[0];
    var id = rev.split('-')[1];
    var opened = false;

    var click = function() {
      if (opened) return;
      opened = true;

      var div = document.createElement('div');
      div.classList.add("editor");
      div.classList.add("box");
      div.style.left = scale * (x + 3 * r) + "px";
      div.style.top = scale * (y - 2) + "px";
      div.style.zIndex = 1000;
      box.appendChild(div);

      var close = function() {
        div.parentNode.removeChild(div);
        opened = false;
      };

      db.get(docId, {rev: rev}).then(function(doc){
        var dl = document.createElement('dl');
        var keys = [];
        var addRow = function(key, value){
          var key = input(key);
          keys.push(key);
          var dt = document.createElement('dt');
          dt.appendChild(key);
          dl.appendChild(dt);
          var value = input(value);
          key.valueInput = value;
          var dd = document.createElement('dd');
          dd.appendChild(value);
          dl.appendChild(dd);
        };
        for (var i in doc) {
          if (doc.hasOwnProperty(i)) {
            addRow(i, JSON.stringify(doc[i]));
          }
        }
        div.appendChild(dl);
        var addButton = document.createElement('button');
        addButton.appendChild(document.createTextNode('add field'));
        div.appendChild(addButton);
        addButton.onclick = function(){
          addRow('key', 'value');
        };
        var cancelButton = document.createElement('button');
        cancelButton.appendChild(document.createTextNode('cancel'));
        div.appendChild(cancelButton);
        cancelButton.onclick = close;
        var okButton = document.createElement('button');
        okButton.appendChild(document.createTextNode('save'));
        div.appendChild(okButton);
        okButton.onclick = function() {
          var newDoc = {};
          keys.forEach(function(key){
            var value = key.valueInput.getValue();
            if (value.replace(/^\s*|\s*$/g, '')){
              newDoc[key.getValue()] = JSON.parse(key.valueInput.getValue());
            }
          });
          putAfter(newDoc, doc._rev).then(close, error);
        };
      }, error);
    };
    nodeEl.onclick = click;
    nodeEl.onmouseover = function() {
      this.classList.add("selected");
      //text.style.display = "block";
    };
    nodeEl.onmouseout = function() {
      this.classList.remove("selected");
      //text.style.display = "none";
    };

    var text = document.createElement('div');
    //text.style.display = "none";
    text.classList.add("box");
    text.style.left = scale * (x + 1 * r) + "px";
    text.style.top = scale * (y - 5) + "px";
    text.short = pos + '-' + id.substr(0, shortDescLen);
    text.long = pos + '-' + id;
    text.appendChild(document.createTextNode(text.short));
    text.onmouseover = function() {
      this.style.zIndex = 1000;
    };
    text.onmouseout = function() {
      this.style.zIndex = 1;
    };
    text.onclick = click;
    box.appendChild(text);
  }

  var flatten = function (arrayOfArrays) {
    return Array.prototype.concat.apply([], arrayOfArrays);
  };

  return getTree(db, docId).then(function (tree) {
    var minUniqLength = minUniq(flatten(tree.paths).map(function(rev) {
      return rev.split('-')[1];
    }));
    return draw(tree.paths, tree.deleted, tree.winner, minUniqLength);
  });
};

},{"./getTree":2,"./minUniq":3}],5:[function(require,module,exports){
"use strict";

var utils = require('./utils');
var merge = require('./merge');
var errors = require('./deps/errors');
var EventEmitter = require('events').EventEmitter;
var upsert = require('./deps/upsert');
var Changes = require('./changes');
var Promise = utils.Promise;

/*
 * A generic pouch adapter
 */

// returns first element of arr satisfying callback predicate
function arrayFirst(arr, callback) {
  for (var i = 0; i < arr.length; i++) {
    if (callback(arr[i], i) === true) {
      return arr[i];
    }
  }
  return false;
}

// Wrapper for functions that call the bulkdocs api with a single doc,
// if the first result is an error, return an error
function yankError(callback) {
  return function (err, results) {
    if (err || (results[0] && results[0].error)) {
      callback(err || results[0]);
    } else {
      callback(null, results.length ? results[0]  : results);
    }
  };
}

// for every node in a revision tree computes its distance from the closest
// leaf
function computeHeight(revs) {
  var height = {};
  var edges = [];
  merge.traverseRevTree(revs, function (isLeaf, pos, id, prnt) {
    var rev = pos + "-" + id;
    if (isLeaf) {
      height[rev] = 0;
    }
    if (prnt !== undefined) {
      edges.push({from: prnt, to: rev});
    }
    return rev;
  });

  edges.reverse();
  edges.forEach(function (edge) {
    if (height[edge.from] === undefined) {
      height[edge.from] = 1 + height[edge.to];
    } else {
      height[edge.from] = Math.min(height[edge.from], 1 + height[edge.to]);
    }
  });
  return height;
}

function allDocsKeysQuery(api, opts, callback) {
  var keys =  ('limit' in opts) ?
      opts.keys.slice(opts.skip, opts.limit + opts.skip) :
      (opts.skip > 0) ? opts.keys.slice(opts.skip) : opts.keys;
  if (opts.descending) {
    keys.reverse();
  }
  if (!keys.length) {
    return api._allDocs({limit: 0}, callback);
  }
  var finalResults = {
    offset: opts.skip
  };
  return Promise.all(keys.map(function (key) {
    var subOpts = utils.extend(true, {key: key, deleted: 'ok'}, opts);
    ['limit', 'skip', 'keys'].forEach(function (optKey) {
      delete subOpts[optKey];
    });
    return new Promise(function (resolve, reject) {
      api._allDocs(subOpts, function (err, res) {
        if (err) {
          return reject(err);
        }
        finalResults.total_rows = res.total_rows;
        resolve(res.rows[0] || {key: key, error: 'not_found'});
      });
    });
  })).then(function (results) {
    finalResults.rows = results;
    return finalResults;
  });
}

utils.inherits(AbstractPouchDB, EventEmitter);
module.exports = AbstractPouchDB;

function AbstractPouchDB() {
  var self = this;
  EventEmitter.call(this);

  var listeners = 0, changes;
  var eventNames = ['change', 'delete', 'create', 'update'];
  this.on('newListener', function (eventName) {
    if (~eventNames.indexOf(eventName)) {
      if (listeners) {
        listeners++;
        return;
      } else {
        listeners++;
      }
    } else {
      return;
    }
    var lastChange = 0;
    changes = this.changes({
      conflicts: true,
      include_docs: true,
      continuous: true,
      since: 'now',
      onChange: function (change) {
        if (change.seq <= lastChange) {
          return;
        }
        lastChange = change.seq;
        self.emit('change', change);
        if (change.doc._deleted) {
          self.emit('delete', change);
        } else if (change.doc._rev.split('-')[0] === '1') {
          self.emit('create', change);
        } else {
          self.emit('update', change);
        }
      }
    });
  });
  this.on('removeListener', function (eventName) {
    if (~eventNames.indexOf(eventName)) {
      listeners--;
      if (listeners) {
        return;
      }
    } else {
      return;
    }
    changes.cancel();
  });
}

AbstractPouchDB.prototype.post =
  utils.adapterFun('post', function (doc, opts, callback) {
  if (typeof opts === 'function') {
    callback = opts;
    opts = {};
  }
  if (typeof doc !== 'object' || Array.isArray(doc)) {
    return callback(errors.error(errors.NOT_AN_OBJECT));
  }
  this.bulkDocs({docs: [doc]}, opts, yankError(callback));
});

AbstractPouchDB.prototype.put =
  utils.adapterFun('put', utils.getArguments(function (args) {
  var temp, temptype, opts, callback;
  var doc = args.shift();
  var id = '_id' in doc;
  if (typeof doc !== 'object' || Array.isArray(doc)) {
    callback = args.pop();
    return callback(errors.error(errors.NOT_AN_OBJECT));
  }
  doc = utils.clone(doc);
  while (true) {
    temp = args.shift();
    temptype = typeof temp;
    if (temptype === "string" && !id) {
      doc._id = temp;
      id = true;
    } else if (temptype === "string" && id && !('_rev' in doc)) {
      doc._rev = temp;
    } else if (temptype === "object") {
      opts = temp;
    } else if (temptype === "function") {
      callback = temp;
    }
    if (!args.length) {
      break;
    }
  }
  opts = opts || {};
  var error = utils.invalidIdError(doc._id);
  if (error) {
    return callback(error);
  }
  if (utils.isLocalId(doc._id) && typeof this._putLocal === 'function') {
    if (doc._deleted) {
      return this._removeLocal(doc, callback);
    } else {
      return this._putLocal(doc, callback);
    }
  }
  this.bulkDocs({docs: [doc]}, opts, yankError(callback));
}));

AbstractPouchDB.prototype.putAttachment =
  utils.adapterFun('putAttachment', function (docId, attachmentId, rev,
                                              blob, type, callback) {
  var api = this;
  if (typeof type === 'function') {
    callback = type;
    type = blob;
    blob = rev;
    rev = null;
  }
  if (typeof type === 'undefined') {
    type = blob;
    blob = rev;
    rev = null;
  }

  function createAttachment(doc) {
    doc._attachments = doc._attachments || {};
    doc._attachments[attachmentId] = {
      content_type: type,
      data: blob
    };
    return api.put(doc);
  }

  return api.get(docId).then(function (doc) {
    if (doc._rev !== rev) {
      throw errors.error(errors.REV_CONFLICT);
    }

    return createAttachment(doc);
  }, function (err) {
     // create new doc
    if (err.reason === errors.MISSING_DOC.message) {
      return createAttachment({_id: docId});
    } else {
      throw err;
    }
  });
});

AbstractPouchDB.prototype.removeAttachment =
  utils.adapterFun('removeAttachment', function (docId, attachmentId, rev,
                                                 callback) {
  var self = this;
  self.get(docId, function (err, obj) {
    if (err) {
      callback(err);
      return;
    }
    if (obj._rev !== rev) {
      callback(errors.error(errors.REV_CONFLICT));
      return;
    }
    if (!obj._attachments) {
      return callback();
    }
    delete obj._attachments[attachmentId];
    if (Object.keys(obj._attachments).length === 0) {
      delete obj._attachments;
    }
    self.put(obj, callback);
  });
});

AbstractPouchDB.prototype.remove =
  utils.adapterFun('remove', function (docOrId, optsOrRev, opts, callback) {
  var doc;
  if (typeof optsOrRev === 'string') {
    // id, rev, opts, callback style
    doc = {
      _id: docOrId,
      _rev: optsOrRev
    };
    if (typeof opts === 'function') {
      callback = opts;
      opts = {};
    }
  } else {
    // doc, opts, callback style
    doc = docOrId;
    if (typeof optsOrRev === 'function') {
      callback = optsOrRev;
      opts = {};
    } else {
      callback = opts;
      opts = optsOrRev;
    }
  }
  opts = utils.clone(opts || {});
  opts.was_delete = true;
  var newDoc = {_id: doc._id, _rev: (doc._rev || opts.rev)};
  newDoc._deleted = true;
  if (utils.isLocalId(newDoc._id) && typeof this._removeLocal === 'function') {
    return this._removeLocal(doc, callback);
  }
  this.bulkDocs({docs: [newDoc]}, opts, yankError(callback));
});

AbstractPouchDB.prototype.revsDiff =
  utils.adapterFun('revsDiff', function (req, opts, callback) {
  if (typeof opts === 'function') {
    callback = opts;
    opts = {};
  }
  opts = utils.clone(opts);
  var ids = Object.keys(req);

  if (!ids.length) {
    return callback(null, {});
  }

  var count = 0;
  var missing = new utils.Map();

  function addToMissing(id, revId) {
    if (!missing.has(id)) {
      missing.set(id, {missing: []});
    }
    missing.get(id).missing.push(revId);
  }

  function processDoc(id, rev_tree) {
    // Is this fast enough? Maybe we should switch to a set simulated by a map
    var missingForId = req[id].slice(0);
    merge.traverseRevTree(rev_tree, function (isLeaf, pos, revHash, ctx,
      opts) {
        var rev = pos + '-' + revHash;
        var idx = missingForId.indexOf(rev);
        if (idx === -1) {
          return;
        }

        missingForId.splice(idx, 1);
        if (opts.status !== 'available') {
          addToMissing(id, rev);
        }
      });

    // Traversing the tree is synchronous, so now `missingForId` contains
    // revisions that were not found in the tree
    missingForId.forEach(function (rev) {
      addToMissing(id, rev);
    });
  }

  ids.map(function (id) {
    this._getRevisionTree(id, function (err, rev_tree) {
      if (err && err.status === 404 && err.message === 'missing') {
        missing.set(id, {missing: req[id]});
      } else if (err) {
        return callback(err);
      } else {
        processDoc(id, rev_tree);
      }

      if (++count === ids.length) {
        // convert LazyMap to object
        var missingObj = {};
        missing.forEach(function (value, key) {
          missingObj[key] = value;
        });
        return callback(null, missingObj);
      }
    });
  }, this);
});

// compact one document and fire callback
// by compacting we mean removing all revisions which
// are further from the leaf in revision tree than max_height
AbstractPouchDB.prototype.compactDocument =
  utils.adapterFun('compactDocument', function (docId, maxHeight, callback) {
  var self = this;
  this._getRevisionTree(docId, function (err, revTree) {
    if (err) {
      return callback(err);
    }
    var height = computeHeight(revTree);
    var candidates = [];
    var revs = [];
    Object.keys(height).forEach(function (rev) {
      if (height[rev] > maxHeight) {
        candidates.push(rev);
      }
    });

    merge.traverseRevTree(revTree, function (isLeaf, pos, revHash, ctx, opts) {
      var rev = pos + '-' + revHash;
      if (opts.status === 'available' && candidates.indexOf(rev) !== -1) {
        revs.push(rev);
      }
    });
    self._doCompaction(docId, revs, callback);
  });
});

// compact the whole database using single document
// compaction
AbstractPouchDB.prototype.compact =
  utils.adapterFun('compact', function (opts, callback) {
  if (typeof opts === 'function') {
    callback = opts;
    opts = {};
  }
  var self = this;

  opts = utils.clone(opts || {});

  self.get('_local/compaction')["catch"](function () {
    return false;
  }).then(function (doc) {
    if (typeof self._compact === 'function') {
      if (doc && doc.last_seq) {
        opts.last_seq = doc.last_seq;
      }
      return self._compact(opts, callback);
    }

  });
});
AbstractPouchDB.prototype._compact = function (opts, callback) {
  var self = this;
  var changesOpts = {
    returnDocs: false,
    last_seq: opts.last_seq || 0
  };
  var promises = [];

  function onChange(row) {
    promises.push(self.compactDocument(row.id, 0));
  }
  function onComplete(resp) {
    var lastSeq = resp.last_seq;
    Promise.all(promises).then(function () {
      return upsert(self, '_local/compaction', function deltaFunc(doc) {
        if (!doc.last_seq || doc.last_seq < lastSeq) {
          doc.last_seq = lastSeq;
          return doc;
        }
        return false; // somebody else got here first, don't update
      });
    }).then(function () {
      callback(null, {ok: true});
    })["catch"](callback);
  }
  self.changes(changesOpts)
    .on('change', onChange)
    .on('complete', onComplete)
    .on('error', callback);
};
/* Begin api wrappers. Specific functionality to storage belongs in the 
   _[method] */
AbstractPouchDB.prototype.get =
  utils.adapterFun('get', function (id, opts, callback) {
  if (typeof opts === 'function') {
    callback = opts;
    opts = {};
  }
  if (typeof id !== 'string') {
    return callback(errors.error(errors.INVALID_ID));
  }
  if (utils.isLocalId(id) && typeof this._getLocal === 'function') {
    return this._getLocal(id, callback);
  }
  var leaves = [], self = this;

  function finishOpenRevs() {
    var result = [];
    var count = leaves.length;
    if (!count) {
      return callback(null, result);
    }
    // order with open_revs is unspecified
    leaves.forEach(function (leaf) {
      self.get(id, {
        rev: leaf,
        revs: opts.revs,
        attachments: opts.attachments
      }, function (err, doc) {
        if (!err) {
          result.push({ok: doc});
        } else {
          result.push({missing: leaf});
        }
        count--;
        if (!count) {
          callback(null, result);
        }
      });
    });
  }

  if (opts.open_revs) {
    if (opts.open_revs === "all") {
      this._getRevisionTree(id, function (err, rev_tree) {
        if (err) {
          return callback(err);
        }
        leaves = merge.collectLeaves(rev_tree).map(function (leaf) {
          return leaf.rev;
        });
        finishOpenRevs();
      });
    } else {
      if (Array.isArray(opts.open_revs)) {
        leaves = opts.open_revs;
        for (var i = 0; i < leaves.length; i++) {
          var l = leaves[i];
          // looks like it's the only thing couchdb checks
          if (!(typeof(l) === "string" && /^\d+-/.test(l))) {
            return callback(errors.error(errors.INVALID_REV));
          }
        }
        finishOpenRevs();
      } else {
        return callback(errors.error(errors.UNKNOWN_ERROR,
          'function_clause'));
      }
    }
    return; // open_revs does not like other options
  }

  return this._get(id, opts, function (err, result) {
    opts = utils.clone(opts);
    if (err) {
      return callback(err);
    }

    var doc = result.doc;
    var metadata = result.metadata;
    var ctx = result.ctx;

    if (opts.conflicts) {
      var conflicts = merge.collectConflicts(metadata);
      if (conflicts.length) {
        doc._conflicts = conflicts;
      }
    }

    if (utils.isDeleted(metadata, doc._rev)) {
      doc._deleted = true;
    }

    if (opts.revs || opts.revs_info) {
      var paths = merge.rootToLeaf(metadata.rev_tree);
      var path = arrayFirst(paths, function (arr) {
        return arr.ids.map(function (x) { return x.id; })
          .indexOf(doc._rev.split('-')[1]) !== -1;
      });

      var indexOfRev = path.ids.map(function (x) {return x.id; })
        .indexOf(doc._rev.split('-')[1]) + 1;
      var howMany = path.ids.length - indexOfRev;
      path.ids.splice(indexOfRev, howMany);
      path.ids.reverse();

      if (opts.revs) {
        doc._revisions = {
          start: (path.pos + path.ids.length) - 1,
          ids: path.ids.map(function (rev) {
            return rev.id;
          })
        };
      }
      if (opts.revs_info) {
        var pos =  path.pos + path.ids.length;
        doc._revs_info = path.ids.map(function (rev) {
          pos--;
          return {
            rev: pos + '-' + rev.id,
            status: rev.opts.status
          };
        });
      }
    }

    if (opts.local_seq) {
      utils.info('The "local_seq" option is deprecated and will be removed');
      doc._local_seq = result.metadata.seq;
    }

    if (opts.attachments && doc._attachments) {
      var attachments = doc._attachments;
      var count = Object.keys(attachments).length;
      if (count === 0) {
        return callback(null, doc);
      }
      Object.keys(attachments).forEach(function (key) {
        this._getAttachment(attachments[key],
                            {encode: true, ctx: ctx}, function (err, data) {
          var att = doc._attachments[key];
          att.data = data;
          delete att.stub;
          delete att.length;
          if (!--count) {
            callback(null, doc);
          }
        });
      }, self);
    } else {
      if (doc._attachments) {
        for (var key in doc._attachments) {
          if (doc._attachments.hasOwnProperty(key)) {
            doc._attachments[key].stub = true;
          }
        }
      }
      callback(null, doc);
    }
  });
});

AbstractPouchDB.prototype.getAttachment =
  utils.adapterFun('getAttachment', function (docId, attachmentId, opts,
                                              callback) {
  var self = this;
  if (opts instanceof Function) {
    callback = opts;
    opts = {};
  }
  opts = utils.clone(opts);
  this._get(docId, opts, function (err, res) {
    if (err) {
      return callback(err);
    }
    if (res.doc._attachments && res.doc._attachments[attachmentId]) {
      opts.ctx = res.ctx;
      self._getAttachment(res.doc._attachments[attachmentId], opts, callback);
    } else {
      return callback(errors.error(errors.MISSING_DOC));
    }
  });
});

AbstractPouchDB.prototype.allDocs =
  utils.adapterFun('allDocs', function (opts, callback) {
  if (typeof opts === 'function') {
    callback = opts;
    opts = {};
  }
  opts = utils.clone(opts);
  opts.skip = typeof opts.skip !== 'undefined' ? opts.skip : 0;
  if ('keys' in opts) {
    if (!Array.isArray(opts.keys)) {
      return callback(new TypeError('options.keys must be an array'));
    }
    var incompatibleOpt =
      ['startkey', 'endkey', 'key'].filter(function (incompatibleOpt) {
      return incompatibleOpt in opts;
    })[0];
    if (incompatibleOpt) {
      callback(errors.error(errors.QUERY_PARSE_ERROR,
        'Query parameter `' + incompatibleOpt +
        '` is not compatible with multi-get'
      ));
      return;
    }
    if (this.type() !== 'http') {
      return allDocsKeysQuery(this, opts, callback);
    }
  }

  return this._allDocs(opts, callback);
});

AbstractPouchDB.prototype.changes = function (opts, callback) {
  if (typeof opts === 'function') {
    callback = opts;
    opts = {};
  }
  return new Changes(this, opts, callback);
};

AbstractPouchDB.prototype.close =
  utils.adapterFun('close', function (callback) {
  this._closed = true;
  return this._close(callback);
});

AbstractPouchDB.prototype.info = utils.adapterFun('info', function (callback) {
  var self = this;
  this._info(function (err, info) {
    if (err) {
      return callback(err);
    }
    // assume we know better than the adapter, unless it informs us
    info.db_name = info.db_name || self._db_name;
    info.auto_compaction = !!(self.auto_compaction && self.type() !== 'http');
    callback(null, info);
  });
});

AbstractPouchDB.prototype.id = utils.adapterFun('id', function (callback) {
  return this._id(callback);
});

AbstractPouchDB.prototype.type = function () {
  return (typeof this._type === 'function') ? this._type() : this.adapter;
};

AbstractPouchDB.prototype.bulkDocs =
  utils.adapterFun('bulkDocs', function (req, opts, callback) {
  if (typeof opts === 'function') {
    callback = opts;
    opts = {};
  }

  opts = utils.clone(opts);

  if (Array.isArray(req)) {
    req = {
      docs: req
    };
  }

  if (!req || !req.docs || !Array.isArray(req.docs)) {
    return callback(errors.error(errors.MISSING_BULK_DOCS));
  }

  for (var i = 0; i < req.docs.length; ++i) {
    if (typeof req.docs[i] !== 'object' || Array.isArray(req.docs[i])) {
      return callback(errors.error(errors.NOT_AN_OBJECT));
    }
  }

  req = utils.clone(req);
  if (!('new_edits' in opts)) {
    if ('new_edits' in req) {
      opts.new_edits = req.new_edits;
    } else {
      opts.new_edits = true;
    }
  }

  if (!opts.new_edits && this.type() !== 'http') {
    // ensure revisions of the same doc are sorted, so that
    // the local adapter processes them correctly (#2935)
    req.docs.sort(function (a, b) {
      var idCompare = utils.compare(a._id, b._id);
      if (idCompare !== 0) {
        return idCompare;
      }
      var aStart = a._revisions ? a._revisions.start : 0;
      var bStart = b._revisions ? b._revisions.start : 0;
      return utils.compare(aStart, bStart);
    });
  }

  req.docs.forEach(function (doc) {
    if (doc._deleted) {
      delete doc._attachments; // ignore atts for deleted docs
    }
  });

  return this._bulkDocs(req, opts, function (err, res) {
    if (err) {
      return callback(err);
    }
    if (!opts.new_edits) {
      // this is what couch does when new_edits is false
      res = res.filter(function (x) {
        return x.error;
      });
    }
    callback(null, res);
  });
});

AbstractPouchDB.prototype.registerDependentDatabase =
  utils.adapterFun('registerDependentDatabase', function (dependentDb,
                                                          callback) {
  var depDB = new this.constructor(dependentDb, this.__opts || {});

  function diffFun(doc) {
    doc.dependentDbs = doc.dependentDbs || {};
    if (doc.dependentDbs[dependentDb]) {
      return false; // no update required
    }
    doc.dependentDbs[dependentDb] = true;
    return doc;
  }
  upsert(this, '_local/_pouch_dependentDbs', diffFun, function (err) {
    if (err) {
      return callback(err);
    }
    return callback(null, {db: depDB});
  });
});

},{"./changes":18,"./deps/errors":24,"./deps/upsert":30,"./merge":35,"./utils":40,"events":79}],6:[function(require,module,exports){
(function (process){
"use strict";

var CHANGES_BATCH_SIZE = 25;

// according to http://stackoverflow.com/a/417184/680742,
// the de factor URL length limit is 2000 characters.
// but since most of our measurements don't take the full
// URL into account, we fudge it a bit.
// TODO: we could measure the full URL to enforce exactly 2000 chars
var MAX_URL_LENGTH = 1800;

var utils = require('../../utils');
var errors = require('../../deps/errors');
var log = require('debug')('pouchdb:http');
var isBrowser = typeof process === 'undefined' || process.browser;
var buffer = require('../../deps/buffer');

function encodeDocId(id) {
  if (/^_design/.test(id)) {
    return '_design/' + encodeURIComponent(id.slice(8));
  }
  if (/^_local/.test(id)) {
    return '_local/' + encodeURIComponent(id.slice(7));
  }
  return encodeURIComponent(id);
}

function preprocessAttachments(doc) {
  if (!doc._attachments || !Object.keys(doc._attachments)) {
    return utils.Promise.resolve();
  }

  return utils.Promise.all(Object.keys(doc._attachments).map(function (key) {
    var attachment = doc._attachments[key];
    if (attachment.data && typeof attachment.data !== 'string') {
      if (isBrowser) {
        return new utils.Promise(function (resolve) {
          utils.readAsBinaryString(attachment.data, function (binary) {
            attachment.data = utils.btoa(binary);
            resolve();
          });
        });
      } else {
        attachment.data = attachment.data.toString('base64');
      }
    }
  }));
}

// Get all the information you possibly can about the URI given by name and
// return it as a suitable object.
function getHost(name, opts) {
  // If the given name contains "http:"
  if (/http(s?):/.test(name)) {
    // Prase the URI into all its little bits
    var uri = utils.parseUri(name);

    // Store the fact that it is a remote URI
    uri.remote = true;

    // Store the user and password as a separate auth object
    if (uri.user || uri.password) {
      uri.auth = {username: uri.user, password: uri.password};
    }

    // Split the path part of the URI into parts using '/' as the delimiter
    // after removing any leading '/' and any trailing '/'
    var parts = uri.path.replace(/(^\/|\/$)/g, '').split('/');

    // Store the first part as the database name and remove it from the parts
    // array
    uri.db = parts.pop();

    // Restore the path by joining all the remaining parts (all the parts
    // except for the database name) with '/'s
    uri.path = parts.join('/');
    opts = opts || {};
    opts = utils.clone(opts);
    uri.headers = opts.headers || (opts.ajax && opts.ajax.headers) || {};

    if (opts.auth || uri.auth) {
      var nAuth = opts.auth || uri.auth;
      var token = utils.btoa(nAuth.username + ':' + nAuth.password);
      uri.headers.Authorization = 'Basic ' + token;
    }

    if (opts.headers) {
      uri.headers = opts.headers;
    }

    return uri;
  }

  // If the given name does not contain 'http:' then return a very basic object
  // with no host, the current path, the given name as the database name and no
  // username/password
  return {host: '', path: '/', db: name, auth: false};
}

// Generate a URL with the host data given by opts and the given path
function genDBUrl(opts, path) {
  return genUrl(opts, opts.db + '/' + path);
}

// Generate a URL with the host data given by opts and the given path
function genUrl(opts, path) {
  if (opts.remote) {
    // If the host already has a path, then we need to have a path delimiter
    // Otherwise, the path delimiter is the empty string
    var pathDel = !opts.path ? '' : '/';

    // If the host already has a path, then we need to have a path delimiter
    // Otherwise, the path delimiter is the empty string
    return opts.protocol + '://' + opts.host + ':' + opts.port + '/' +
           opts.path + pathDel + path;
  }

  return '/' + path;
}

// Implements the PouchDB API for dealing with CouchDB instances over HTTP
function HttpPouch(opts, callback) {
  // The functions that will be publicly available for HttpPouch
  var api = this;
  api.getHost = opts.getHost ? opts.getHost : getHost;

  // Parse the URI given by opts.name into an easy-to-use object
  var host = api.getHost(opts.name, opts);

  // Generate the database URL based on the host
  var dbUrl = genDBUrl(host, '');

  api.getUrl = function () {return dbUrl; };
  api.getHeaders = function () {return utils.clone(host.headers); };

  var ajaxOpts = opts.ajax || {};
  opts = utils.clone(opts);
  function ajax(options, callback) {
    var reqOpts = utils.extend(true, utils.clone(ajaxOpts), options);
    log(reqOpts.method + ' ' + reqOpts.url);
    return utils.ajax(reqOpts, callback);
  }

  // Create a new CouchDB database based on the given opts
  var createDB = function () {
    ajax({headers: host.headers, method: 'PUT', url: dbUrl}, function (err) {
      // If we get an "Unauthorized" error
      if (err && err.status === 401) {
        // Test if the database already exists
        ajax({headers: host.headers, method: 'HEAD', url: dbUrl},
             function (err) {
          // If there is still an error
          if (err) {
            // Give the error to the callback to deal with
            callback(err);
          } else {
            // Continue as if there had been no errors
            callback(null, api);
          }
        });
        // If there were no errros or if the only error is "Precondition Failed"
        // (note: "Precondition Failed" occurs when we try to create a database
        // that already exists)
      } else if (!err || err.status === 412) {
        // Continue as if there had been no errors
        callback(null, api);
      } else {
        callback(err);
      }
    });
  };

  if (!opts.skipSetup) {
    ajax({headers: host.headers, method: 'GET', url: dbUrl}, function (err) {
      //check if the db exists
      if (err) {
        if (err.status === 404) {
          utils.explain404(
            'PouchDB is just detecting if the remote DB exists.');
          //if it doesn't, create it
          createDB();
        } else {
          callback(err);
        }
      } else {
        //go do stuff with the db
        callback(null, api);
      }
    });
  }

  api.type = function () {
    return 'http';
  };

  api.id = utils.adapterFun('id', function (callback) {
    ajax({
      headers: host.headers,
      method: 'GET',
      url: genUrl(host, '')
    }, function (err, result) {
      var uuid = (result && result.uuid) ?
        result.uuid + host.db : genDBUrl(host, '');
      callback(null, uuid);
    });
  });

  api.request = utils.adapterFun('request', function (options, callback) {
    options.headers = host.headers;
    options.url = genDBUrl(host, options.url);
    ajax(options, callback);
  });

  // Sends a POST request to the host calling the couchdb _compact function
  //    version: The version of CouchDB it is running
  api.compact = utils.adapterFun('compact', function (opts, callback) {
    if (typeof opts === 'function') {
      callback = opts;
      opts = {};
    }
    opts = utils.clone(opts);
    ajax({
      headers: host.headers,
      url: genDBUrl(host, '_compact'),
      method: 'POST'
    }, function () {
      function ping() {
        api.info(function (err, res) {
          if (!res.compact_running) {
            callback(null, {ok: true});
          } else {
            setTimeout(ping, opts.interval || 200);
          }
        });
      }
      // Ping the http if it's finished compaction
      if (typeof callback === "function") {
        ping();
      }
    });
  });

  // Calls GET on the host, which gets back a JSON string containing
  //    couchdb: A welcome string
  //    version: The version of CouchDB it is running
  api._info = function (callback) {
    ajax({
      headers: host.headers,
      method: 'GET',
      url: genDBUrl(host, '')
    }, function (err, res) {
      if (err) {
        callback(err);
      } else {
        res.host = genDBUrl(host, '');
        callback(null, res);
      }
    });
  };

  // Get the document with the given id from the database given by host.
  // The id could be solely the _id in the database, or it may be a
  // _design/ID or _local/ID path
  api.get = utils.adapterFun('get', function (id, opts, callback) {
    // If no options were given, set the callback to the second parameter
    if (typeof opts === 'function') {
      callback = opts;
      opts = {};
    }
    opts = utils.clone(opts);
    if (opts.auto_encode === undefined) {
      opts.auto_encode = true;
    }

    // List of parameters to add to the GET request
    var params = [];

    // If it exists, add the opts.revs value to the list of parameters.
    // If revs=true then the resulting JSON will include a field
    // _revisions containing an array of the revision IDs.
    if (opts.revs) {
      params.push('revs=true');
    }

    // If it exists, add the opts.revs_info value to the list of parameters.
    // If revs_info=true then the resulting JSON will include the field
    // _revs_info containing an array of objects in which each object
    // representing an available revision.
    if (opts.revs_info) {
      params.push('revs_info=true');
    }

    if (opts.local_seq) {
      params.push('local_seq=true');
    }
    // If it exists, add the opts.open_revs value to the list of parameters.
    // If open_revs=all then the resulting JSON will include all the leaf
    // revisions. If open_revs=["rev1", "rev2",...] then the resulting JSON
    // will contain an array of objects containing data of all revisions
    if (opts.open_revs) {
      if (opts.open_revs !== "all") {
        opts.open_revs = JSON.stringify(opts.open_revs);
      }
      params.push('open_revs=' + opts.open_revs);
    }

    // If it exists, add the opts.attachments value to the list of parameters.
    // If attachments=true the resulting JSON will include the base64-encoded
    // contents in the "data" property of each attachment.
    if (opts.attachments) {
      params.push('attachments=true');
    }

    // If it exists, add the opts.rev value to the list of parameters.
    // If rev is given a revision number then get the specified revision.
    if (opts.rev) {
      params.push('rev=' + opts.rev);
    }

    // If it exists, add the opts.conflicts value to the list of parameters.
    // If conflicts=true then the resulting JSON will include the field
    // _conflicts containing all the conflicting revisions.
    if (opts.conflicts) {
      params.push('conflicts=' + opts.conflicts);
    }

    // Format the list of parameters into a valid URI query string
    params = params.join('&');
    params = params === '' ? '' : '?' + params;

    if (opts.auto_encode) {
      id = encodeDocId(id);
    }

    // Set the options for the ajax call
    var options = {
      headers: host.headers,
      method: 'GET',
      url: genDBUrl(host, id + params)
    };
    var getRequestAjaxOpts = opts.ajax || {};
    utils.extend(true, options, getRequestAjaxOpts);

    // If the given id contains at least one '/' and the part before the '/'
    // is NOT "_design" and is NOT "_local"
    // OR
    // If the given id contains at least two '/' and the part before the first
    // '/' is "_design".
    // TODO This second condition seems strange since if parts[0] === '_design'
    // then we already know that parts[0] !== '_local'.
    var parts = id.split('/');
    if ((parts.length > 1 && parts[0] !== '_design' && parts[0] !== '_local') ||
        (parts.length > 2 && parts[0] === '_design' && parts[0] !== '_local')) {
      // Binary is expected back from the server
      options.binary = true;
    }

    // Get the document
    ajax(options, function (err, doc, xhr) {
      // If the document does not exist, send an error to the callback
      if (err) {
        return callback(err);
      }

      // Send the document to the callback
      callback(null, doc, xhr);
    });
  });

  // Delete the document given by doc from the database given by host.
  api.remove = utils.adapterFun('remove',
      function (docOrId, optsOrRev, opts, callback) {
    var doc;
    if (typeof optsOrRev === 'string') {
      // id, rev, opts, callback style
      doc = {
        _id: docOrId,
        _rev: optsOrRev
      };
      if (typeof opts === 'function') {
        callback = opts;
        opts = {};
      }
    } else {
      // doc, opts, callback style
      doc = docOrId;
      if (typeof optsOrRev === 'function') {
        callback = optsOrRev;
        opts = {};
      } else {
        callback = opts;
        opts = optsOrRev;
      }
    }

    var rev = (doc._rev || opts.rev);

    // Delete the document
    ajax({
      headers: host.headers,
      method: 'DELETE',
      url: genDBUrl(host, encodeDocId(doc._id)) + '?rev=' + rev
    }, callback);
  });

  function encodeAttachmentId(attachmentId) {
    return attachmentId.split("/").map(encodeURIComponent).join("/");
  }

  // Get the attachment
  api.getAttachment =
    utils.adapterFun('getAttachment', function (docId, attachmentId, opts,
                                                callback) {
    if (typeof opts === 'function') {
      callback = opts;
      opts = {};
    }
    opts = utils.clone(opts);
    if (opts.auto_encode === undefined) {
      opts.auto_encode = true;
    }
    if (opts.auto_encode) {
      docId = encodeDocId(docId);
    }
    opts.auto_encode = false;
    api.get(docId + '/' + encodeAttachmentId(attachmentId), opts, callback);
  });

  // Remove the attachment given by the id and rev
  api.removeAttachment =
    utils.adapterFun('removeAttachment', function (docId, attachmentId, rev,
                                                   callback) {

    var url = genDBUrl(host, encodeDocId(docId) + '/' +
      encodeAttachmentId(attachmentId)) + '?rev=' + rev;

    ajax({
      headers: host.headers,
      method: 'DELETE',
      url: url
    }, callback);
  });

  // Add the attachment given by blob and its contentType property
  // to the document with the given id, the revision given by rev, and
  // add it to the database given by host.
  api.putAttachment =
    utils.adapterFun('putAttachment', function (docId, attachmentId, rev, blob,
                                                type, callback) {
    if (typeof type === 'function') {
      callback = type;
      type = blob;
      blob = rev;
      rev = null;
    }
    if (typeof type === 'undefined') {
      type = blob;
      blob = rev;
      rev = null;
    }
    var id = encodeDocId(docId) + '/' + encodeAttachmentId(attachmentId);
    var url = genDBUrl(host, id);
    if (rev) {
      url += '?rev=' + rev;
    }

    if (typeof blob === 'string') {
      var binary;
      try {
        binary = utils.atob(blob);
      } catch (err) {
        // it's not base64-encoded, so throw error
        return callback(errors.error(errors.BAD_ARG,
                        'Attachments need to be base64 encoded'));
      }
      if (isBrowser) {
        blob = utils.createBlob([utils.fixBinary(binary)], {type: type});
      } else {
        blob = binary ? new buffer(binary, 'binary') : '';
      }
    }

    var opts = {
      headers: utils.clone(host.headers),
      method: 'PUT',
      url: url,
      processData: false,
      body: blob,
      timeout: 60000
    };
    opts.headers['Content-Type'] = type;
    // Add the attachment
    ajax(opts, callback);
  });

  // Add the document given by doc (in JSON string format) to the database
  // given by host. This fails if the doc has no _id field.
  api.put = utils.adapterFun('put', utils.getArguments(function (args) {
    var temp, temptype, opts;
    var doc = args.shift();
    var id = '_id' in doc;
    var callback = args.pop();
    if (typeof doc !== 'object' || Array.isArray(doc)) {
      return callback(errors.error(errors.NOT_AN_OBJECT));
    }

    doc = utils.clone(doc);

    preprocessAttachments(doc).then(function () {
      while (true) {
        temp = args.shift();
        temptype = typeof temp;
        if (temptype === "string" && !id) {
          doc._id = temp;
          id = true;
        } else if (temptype === "string" && id && !('_rev' in doc)) {
          doc._rev = temp;
        } else if (temptype === "object") {
          opts = utils.clone(temp);
        }
        if (!args.length) {
          break;
        }
      }
      opts = opts || {};
      var error = utils.invalidIdError(doc._id);
      if (error) {
        throw error;
      }

      // List of parameter to add to the PUT request
      var params = [];

      // If it exists, add the opts.new_edits value to the list of parameters.
      // If new_edits = false then the database will NOT assign this document a
      // new revision number
      if (opts && typeof opts.new_edits !== 'undefined') {
        params.push('new_edits=' + opts.new_edits);
      }

      // Format the list of parameters into a valid URI query string
      params = params.join('&');
      if (params !== '') {
        params = '?' + params;
      }

      // Add the document
      ajax({
        headers: host.headers,
        method: 'PUT',
        url: genDBUrl(host, encodeDocId(doc._id)) + params,
        body: doc
      }, function (err, res) {
        if (err) {
          return callback(err);
        }
        res.ok = true;
        callback(null, res);
      });
    })["catch"](callback);

  }));

  // Add the document given by doc (in JSON string format) to the database
  // given by host. This does not assume that doc is a new document 
  // (i.e. does not have a _id or a _rev field.)
  api.post = utils.adapterFun('post', function (doc, opts, callback) {
    // If no options were given, set the callback to be the second parameter
    if (typeof opts === 'function') {
      callback = opts;
      opts = {};
    }
    opts = utils.clone(opts);
    if (typeof doc !== 'object') {
      return callback(errors.error(errors.NOT_AN_OBJECT));
    }
    if (! ("_id" in doc)) {
      doc._id = utils.uuid();
    }
    api.put(doc, opts, function (err, res) {
      if (err) {
        return callback(err);
      }
      res.ok = true;
      callback(null, res);
    });
  });

  // Update/create multiple documents given by req in the database
  // given by host.
  api._bulkDocs = function (req, opts, callback) {
    // If opts.new_edits exists add it to the document data to be
    // send to the database.
    // If new_edits=false then it prevents the database from creating
    // new revision numbers for the documents. Instead it just uses
    // the old ones. This is used in database replication.
    if (typeof opts.new_edits !== 'undefined') {
      req.new_edits = opts.new_edits;
    }

    utils.Promise.all(req.docs.map(preprocessAttachments)).then(function () {
      // Update/create the documents
      ajax({
        headers: host.headers,
        method: 'POST',
        url: genDBUrl(host, '_bulk_docs'),
        body: req
      }, function (err, results) {
        if (err) {
          return callback(err);
        }
        results.forEach(function (result) {
          result.ok = true; // smooths out cloudant not adding this
        });
        callback(null, results);
      });
    })["catch"](callback);
  };

  // Get a listing of the documents in the database given
  // by host and ordered by increasing id.
  api.allDocs = utils.adapterFun('allDocs', function (opts, callback) {
    if (typeof opts === 'function') {
      callback = opts;
      opts = {};
    }
    opts = utils.clone(opts);
    // List of parameters to add to the GET request
    var params = [];
    var body;
    var method = 'GET';

    if (opts.conflicts) {
      params.push('conflicts=true');
    }

    // If opts.descending is truthy add it to params
    if (opts.descending) {
      params.push('descending=true');
    }

    // If opts.include_docs exists, add the include_docs value to the
    // list of parameters.
    // If include_docs=true then include the associated document with each
    // result.
    if (opts.include_docs) {
      params.push('include_docs=true');
    }

    if (opts.attachments) {
      // added in CouchDB 1.6.0
      params.push('attachments=true');
    }

    if (opts.key) {
      params.push('key=' + encodeURIComponent(JSON.stringify(opts.key)));
    }

    // If opts.startkey exists, add the startkey value to the list of
    // parameters.
    // If startkey is given then the returned list of documents will
    // start with the document whose id is startkey.
    if (opts.startkey) {
      params.push('startkey=' +
        encodeURIComponent(JSON.stringify(opts.startkey)));
    }

    // If opts.endkey exists, add the endkey value to the list of parameters.
    // If endkey is given then the returned list of docuemnts will
    // end with the document whose id is endkey.
    if (opts.endkey) {
      params.push('endkey=' + encodeURIComponent(JSON.stringify(opts.endkey)));
    }

    if (typeof opts.inclusive_end !== 'undefined') {
      params.push('inclusive_end=' + !!opts.inclusive_end);
    }

    // If opts.limit exists, add the limit value to the parameter list.
    if (typeof opts.limit !== 'undefined') {
      params.push('limit=' + opts.limit);
    }

    if (typeof opts.skip !== 'undefined') {
      params.push('skip=' + opts.skip);
    }

    // Format the list of parameters into a valid URI query string
    params = params.join('&');
    if (params !== '') {
      params = '?' + params;
    }

    if (typeof opts.keys !== 'undefined') {


      var keysAsString =
        'keys=' + encodeURIComponent(JSON.stringify(opts.keys));
      if (keysAsString.length + params.length + 1 <= MAX_URL_LENGTH) {
        // If the keys are short enough, do a GET. we do this to work around
        // Safari not understanding 304s on POSTs (see issue #1239)
        params += (params.indexOf('?') !== -1 ? '&' : '?') + keysAsString;
      } else {
        // If keys are too long, issue a POST request to circumvent GET
        // query string limits
        // see http://wiki.apache.org/couchdb/HTTP_view_API#Querying_Options
        method = 'POST';
        body = JSON.stringify({keys: opts.keys});
      }
    }

    // Get the document listing
    ajax({
      headers: host.headers,
      method: method,
      url: genDBUrl(host, '_all_docs' + params),
      body: body
    }, callback);
  });

  // Get a list of changes made to documents in the database given by host.
  // TODO According to the README, there should be two other methods here,
  // api.changes.addListener and api.changes.removeListener.
  api._changes = function (opts) {
    // We internally page the results of a changes request, this means
    // if there is a large set of changes to be returned we can start
    // processing them quicker instead of waiting on the entire
    // set of changes to return and attempting to process them at once
    var batchSize = 'batch_size' in opts ? opts.batch_size : CHANGES_BATCH_SIZE;

    opts = utils.clone(opts);
    opts.timeout = opts.timeout || 30 * 1000;

    // We give a 5 second buffer for CouchDB changes to respond with
    // an ok timeout
    var params = { timeout: opts.timeout - (5 * 1000) };
    var limit = (typeof opts.limit !== 'undefined') ? opts.limit : false;
    if (limit === 0) {
      limit = 1;
    }
    var returnDocs;
    if ('returnDocs' in opts) {
      returnDocs = opts.returnDocs;
    } else {
      returnDocs = true;
    }
    //
    var leftToFetch = limit;

    if (opts.style) {
      params.style = opts.style;
    }

    if (opts.include_docs || opts.filter && typeof opts.filter === 'function') {
      params.include_docs = true;
    }

    if (opts.attachments) {
      params.attachments = true;
    }

    if (opts.continuous) {
      params.feed = 'longpoll';
    }

    if (opts.conflicts) {
      params.conflicts = true;
    }

    if (opts.descending) {
      params.descending = true;
    }

    if (opts.filter && typeof opts.filter === 'string') {
      params.filter = opts.filter;
      if (opts.filter === '_view' &&
          opts.view &&
          typeof opts.view === 'string') {
        params.view = opts.view;
      }
    }

    // If opts.query_params exists, pass it through to the changes request.
    // These parameters may be used by the filter on the source database.
    if (opts.query_params && typeof opts.query_params === 'object') {
      for (var param_name in opts.query_params) {
        if (opts.query_params.hasOwnProperty(param_name)) {
          params[param_name] = opts.query_params[param_name];
        }
      }
    }

    var method = 'GET';
    var body;

    if (opts.doc_ids) {
      // set this automagically for the user; it's annoying that couchdb
      // requires both a "filter" and a "doc_ids" param.
      params.filter = '_doc_ids';

      var docIdsJson = JSON.stringify(opts.doc_ids);

      if (docIdsJson.length < MAX_URL_LENGTH) {
        params.doc_ids = docIdsJson;
      } else {
        // anything greater than ~2000 is unsafe for gets, so
        // use POST instead
        method = 'POST';
        body = {doc_ids: opts.doc_ids };
      }
    }

    if (opts.continuous && api._useSSE) {
      return  api.sse(opts, params, returnDocs);
    }
    var xhr;
    var lastFetchedSeq;

    // Get all the changes starting wtih the one immediately after the
    // sequence number given by since.
    var fetch = function (since, callback) {
      if (opts.aborted) {
        return;
      }
      params.since = since;
      if (typeof params.since === "object") {
        params.since = JSON.stringify(params.since);
      }

      if (opts.descending) {
        if (limit) {
          params.limit = leftToFetch;
        }
      } else {
        params.limit = (!limit || leftToFetch > batchSize) ?
          batchSize : leftToFetch;
      }

      var paramStr = '?' + Object.keys(params).map(function (k) {
        return k + '=' + params[k];
      }).join('&');

      // Set the options for the ajax call
      var xhrOpts = {
        headers: host.headers,
        method: method,
        url: genDBUrl(host, '_changes' + paramStr),
        // _changes can take a long time to generate, especially when filtered
        timeout: opts.timeout,
        body: body
      };
      lastFetchedSeq = since;

      if (opts.aborted) {
        return;
      }

      // Get the changes
      xhr = ajax(xhrOpts, callback);
    };

    // If opts.since exists, get all the changes from the sequence
    // number given by opts.since. Otherwise, get all the changes
    // from the sequence number 0.
    var fetchTimeout = 10;
    var fetchRetryCount = 0;

    var results = {results: []};

    var fetched = function (err, res) {
      if (opts.aborted) {
        return;
      }
      var raw_results_length = 0;
      // If the result of the ajax call (res) contains changes (res.results)
      if (res && res.results) {
        raw_results_length = res.results.length;
        results.last_seq = res.last_seq;
        // For each change
        var req = {};
        req.query = opts.query_params;
        res.results = res.results.filter(function (c) {
          leftToFetch--;
          var ret = utils.filterChange(opts)(c);
          if (ret) {
            if (returnDocs) {
              results.results.push(c);
            }
            utils.call(opts.onChange, c);
          }
          return ret;
        });
      } else if (err) {
        // In case of an error, stop listening for changes and call
        // opts.complete
        opts.aborted = true;
        utils.call(opts.complete, err);
        return;
      }

      // The changes feed may have timed out with no results
      // if so reuse last update sequence
      if (res && res.last_seq) {
        lastFetchedSeq = res.last_seq;
      }

      var finished = (limit && leftToFetch <= 0) ||
        (res && raw_results_length < batchSize) ||
        (opts.descending);

      if ((opts.continuous && !(limit && leftToFetch <= 0)) || !finished) {
        // Increase retry delay exponentially as long as errors persist
        if (err) {
          fetchRetryCount += 1;
        } else {
          fetchRetryCount = 0;
        }
        var timeoutMultiplier = 1 << fetchRetryCount;
        var retryWait = fetchTimeout * timeoutMultiplier;
        var maximumWait = opts.maximumWait || 30000;

        if (retryWait > maximumWait) {
          utils.call(opts.complete, err || errors.error(errors.UNKNOWN_ERROR));
          return;
        }

        // Queue a call to fetch again with the newest sequence number
        setTimeout(function () { fetch(lastFetchedSeq, fetched); }, retryWait);
      } else {
        // We're done, call the callback
        utils.call(opts.complete, null, results);
      }
    };

    fetch(opts.since || 0, fetched);

    // Return a method to cancel this method from processing any more
    return {
      cancel: function () {
        opts.aborted = true;
        if (xhr) {
          xhr.abort();
        }
      }
    };
  };

  api.sse = function (opts, params, returnDocs) {
    params.feed = 'eventsource';
    params.since = opts.since || 0;
    params.limit = opts.limit;
    delete params.timeout;
    var paramStr = '?' + Object.keys(params).map(function (k) {
      return k + '=' + params[k];
    }).join('&');
    var url = genDBUrl(host, '_changes' + paramStr);
    var source = new EventSource(url);
    var results = {
      results: [],
      last_seq: false
    };
    var dispatched = false;
    var open = false;
    source.addEventListener('message', msgHandler, false);
    source.onopen = function () {
      open = true;
    };
    source.onerror = errHandler;
    return {
      cancel: function () {
        if (dispatched) {
          return dispatched.cancel();
        }
        source.removeEventListener('message', msgHandler, false);
        source.close();
      }
    };
    function msgHandler(e) {
      var data = JSON.parse(e.data);
      if (returnDocs) {
        results.results.push(data);
      }
      results.last_seq = data.seq;
      utils.call(opts.onChange, data);
    }
    function errHandler(err) {
      source.removeEventListener('message', msgHandler, false);
      if (open === false) {
        // errored before it opened
        // likely doesn't support EventSource
        api._useSSE = false;
        dispatched = api._changes(opts);
        return;
      }
      source.close();
      utils.call(opts.complete, err);
    }
    
  };

  api._useSSE = false;
  // Currently disabled due to failing chrome tests in saucelabs
  // api._useSSE = typeof global.EventSource === 'function';

  // Given a set of document/revision IDs (given by req), tets the subset of
  // those that do NOT correspond to revisions stored in the database.
  // See http://wiki.apache.org/couchdb/HttpPostRevsDiff
  api.revsDiff = utils.adapterFun('revsDiff', function (req, opts, callback) {
    // If no options were given, set the callback to be the second parameter
    if (typeof opts === 'function') {
      callback = opts;
      opts = {};
    }

    // Get the missing document/revision IDs
    ajax({
      headers: host.headers,
      method: 'POST',
      url: genDBUrl(host, '_revs_diff'),
      body: JSON.stringify(req)
    }, callback);
  });

  api._close = function (callback) {
    callback();
  };

  api.destroy = utils.adapterFun('destroy', function (callback) {
    ajax({
      url: genDBUrl(host, ''),
      method: 'DELETE',
      headers: host.headers
    }, function (err, resp) {
      if (err) {
        api.emit('error', err);
        callback(err);
      } else {
        api.emit('destroyed');
        callback(null, resp);
      }
    });
  });
}

// Delete the HttpPouch specified by the given name.
HttpPouch.destroy = utils.toPromise(function (name, opts, callback) {
  var host = getHost(name, opts);
  opts = opts || {};
  if (typeof opts === 'function') {
    callback = opts;
    opts = {};
  }
  opts = utils.clone(opts);
  opts.headers = host.headers;
  opts.method = 'DELETE';
  opts.url = genDBUrl(host, '');
  var ajaxOpts = opts.ajax || {};
  opts = utils.extend({}, opts, ajaxOpts);
  utils.ajax(opts, callback);
});

// HttpPouch is a valid adapter.
HttpPouch.valid = function () {
  return true;
};

module.exports = HttpPouch;

}).call(this,require('_process'))

},{"../../deps/buffer":23,"../../deps/errors":24,"../../utils":40,"_process":80,"debug":43}],7:[function(require,module,exports){
'use strict';

var merge = require('../../merge');
var errors = require('../../deps/errors');
var idbUtils = require('./idb-utils');
var idbConstants = require('./idb-constants');

var ATTACH_STORE = idbConstants.ATTACH_STORE;
var BY_SEQ_STORE = idbConstants.BY_SEQ_STORE;
var DOC_STORE = idbConstants.DOC_STORE;

var decodeDoc = idbUtils.decodeDoc;
var decodeMetadata = idbUtils.decodeMetadata;
var fetchAttachmentsIfNecessary = idbUtils.fetchAttachmentsIfNecessary;
var postProcessAttachments = idbUtils.postProcessAttachments;
var openTransactionSafely = idbUtils.openTransactionSafely;

function createKeyRange(start, end, inclusiveEnd, key, descending) {
  try {
    if (start && end) {
      if (descending) {
        return IDBKeyRange.bound(end, start, !inclusiveEnd, false);
      } else {
        return IDBKeyRange.bound(start, end, false, !inclusiveEnd);
      }
    } else if (start) {
      if (descending) {
        return IDBKeyRange.upperBound(start);
      } else {
        return IDBKeyRange.lowerBound(start);
      }
    } else if (end) {
      if (descending) {
        return IDBKeyRange.lowerBound(end, !inclusiveEnd);
      } else {
        return IDBKeyRange.upperBound(end, !inclusiveEnd);
      }
    } else if (key) {
      return IDBKeyRange.only(key);
    }
  } catch (e) {
    return {error: e};
  }
  return null;
}

function handleKeyRangeError(api, opts, err, callback) {
  if (err.name === "DataError" && err.code === 0) {
    // data error, start is less than end
    return callback(null, {
      total_rows: api._meta.docCount,
      offset: opts.skip,
      rows: []
    });
  }
  callback(errors.error(errors.IDB_ERROR, err.name, err.message));
}

function idbAllDocs(opts, api, idb, callback) {

  function allDocsQuery(opts, callback) {
    var start = 'startkey' in opts ? opts.startkey : false;
    var end = 'endkey' in opts ? opts.endkey : false;
    var key = 'key' in opts ? opts.key : false;
    var skip = opts.skip || 0;
    var limit = typeof opts.limit === 'number' ? opts.limit : -1;
    var inclusiveEnd = opts.inclusive_end !== false;
    var descending = 'descending' in opts && opts.descending ? 'prev' : null;

    var keyRange = createKeyRange(start, end, inclusiveEnd, key, descending);
    if (keyRange && keyRange.error) {
      return handleKeyRangeError(api, opts, keyRange.error, callback);
    }

    var stores = [DOC_STORE, BY_SEQ_STORE];

    if (opts.attachments) {
      stores.push(ATTACH_STORE);
    }
    var txnResult = openTransactionSafely(idb, stores, 'readonly');
    if (txnResult.error) {
      return callback(txnResult.error);
    }
    var txn = txnResult.txn;
    var docStore = txn.objectStore(DOC_STORE);
    var seqStore = txn.objectStore(BY_SEQ_STORE);
    var cursor = descending ?
      docStore.openCursor(keyRange, descending) :
      docStore.openCursor(keyRange);
    var docIdRevIndex = seqStore.index('_doc_id_rev');
    var results = [];
    var docCount = 0;

    // if the user specifies include_docs=true, then we don't
    // want to block the main cursor while we're fetching the doc
    function fetchDocAsynchronously(metadata, row, winningRev) {
      var key = metadata.id + "::" + winningRev;
      docIdRevIndex.get(key).onsuccess =  function onGetDoc(e) {
        row.doc = decodeDoc(e.target.result);
        if (opts.conflicts) {
          row.doc._conflicts = merge.collectConflicts(metadata);
        }
        fetchAttachmentsIfNecessary(row.doc, opts, txn);
      };
    }

    function allDocsInner(cursor, winningRev, metadata) {
      var row = {
        id: metadata.id,
        key: metadata.id,
        value: {
          rev: winningRev
        }
      };
      var deleted = metadata.deleted;
      if (opts.deleted === 'ok') {
        results.push(row);
        // deleted docs are okay with "keys" requests
        if (deleted) {
          row.value.deleted = true;
          row.doc = null;
        } else if (opts.include_docs) {
          fetchDocAsynchronously(metadata, row, winningRev);
        }
      } else if (!deleted && skip-- <= 0) {
        results.push(row);
        if (opts.include_docs) {
          fetchDocAsynchronously(metadata, row, winningRev);
        }
        if (--limit === 0) {
          return;
        }
      }
      cursor["continue"]();
    }

    function onGetCursor(e) {
      docCount = api._meta.docCount; // do this within the txn for consistency
      var cursor = e.target.result;
      if (!cursor) {
        return;
      }
      var metadata = decodeMetadata(cursor.value);
      var winningRev = metadata.winningRev;

      allDocsInner(cursor, winningRev, metadata);
    }

    function onResultsReady() {
      callback(null, {
        total_rows: docCount,
        offset: opts.skip,
        rows: results
      });
    }

    function onTxnComplete() {
      if (opts.attachments) {
        postProcessAttachments(results).then(onResultsReady);
      } else {
        onResultsReady();
      }
    }

    txn.oncomplete = onTxnComplete;
    cursor.onsuccess = onGetCursor;
  }

  function allDocs(opts, callback) {

    if (opts.limit === 0) {
      return callback(null, {
        total_rows: api._meta.docCount,
        offset: opts.skip,
        rows: []
      });
    }
    allDocsQuery(opts, callback);
  }

  allDocs(opts, callback);
}

module.exports = idbAllDocs;
},{"../../deps/errors":24,"../../merge":35,"./idb-constants":10,"./idb-utils":11}],8:[function(require,module,exports){
'use strict';

var utils = require('../../utils');
var idbConstants = require('./idb-constants');
var DETECT_BLOB_SUPPORT_STORE = idbConstants.DETECT_BLOB_SUPPORT_STORE;

//
// Detect blob support. Chrome didn't support it until version 38.
// In version 37 they had a broken version where PNGs (and possibly
// other binary types) aren't stored correctly, because when you fetch
// them, the content type is always null.
//
// Furthermore, they have some outstanding bugs where blobs occasionally
// are read by FileReader as null, or by ajax as 404s.
//
// Sadly we use the 404 bug to detect the FileReader bug, so if they
// get fixed independently and released in different versions of Chrome,
// then the bug could come back. So it's worthwhile to watch these issues:
// 404 bug: https://code.google.com/p/chromium/issues/detail?id=447916
// FileReader bug: https://code.google.com/p/chromium/issues/detail?id=447836
//
function checkBlobSupport(txn, idb) {
  return new utils.Promise(function (resolve, reject) {
    var blob = utils.createBlob([''], {type: 'image/png'});
    txn.objectStore(DETECT_BLOB_SUPPORT_STORE).put(blob, 'key');
    txn.oncomplete = function () {
      // have to do it in a separate transaction, else the correct
      // content type is always returned
      var blobTxn = idb.transaction([DETECT_BLOB_SUPPORT_STORE],
        'readwrite');
      var getBlobReq = blobTxn.objectStore(
        DETECT_BLOB_SUPPORT_STORE).get('key');
      getBlobReq.onerror = reject;
      getBlobReq.onsuccess = function (e) {

        var storedBlob = e.target.result;
        var url = URL.createObjectURL(storedBlob);

        utils.ajax({
          url: url,
          cache: true,
          binary: true
        }, function (err, res) {
          if (err && err.status === 405) {
            // firefox won't let us do that. but firefox doesn't
            // have the blob type bug that Chrome does, so that's ok
            resolve(true);
          } else {
            resolve(!!(res && res.type === 'image/png'));
            if (err && err.status === 404) {
              utils.explain404('PouchDB is just detecting blob URL support.');
            }
          }
          URL.revokeObjectURL(url);
        });
      };
    };
  })["catch"](function () {
    return false; // error, so assume unsupported
  });
}

module.exports = checkBlobSupport;
},{"../../utils":40,"./idb-constants":10}],9:[function(require,module,exports){
'use strict';

var utils = require('../../utils');
var errors = require('../../deps/errors');
var idbUtils = require('./idb-utils');
var idbConstants = require('./idb-constants');

var ATTACH_AND_SEQ_STORE = idbConstants.ATTACH_AND_SEQ_STORE;
var ATTACH_STORE = idbConstants.ATTACH_STORE;
var BY_SEQ_STORE = idbConstants.BY_SEQ_STORE;
var DOC_STORE = idbConstants.DOC_STORE;
var LOCAL_STORE = idbConstants.LOCAL_STORE;
var META_STORE = idbConstants.META_STORE;

var compactRevs = idbUtils.compactRevs;
var decodeMetadata = idbUtils.decodeMetadata;
var encodeMetadata = idbUtils.encodeMetadata;
var idbError = idbUtils.idbError;
var openTransactionSafely = idbUtils.openTransactionSafely;

function idbBulkDocs(req, opts, api, idb, Changes, callback) {
  var docInfos = req.docs;
  var txn;
  var docStore;
  var bySeqStore;
  var attachStore;
  var attachAndSeqStore;
  var docInfoError;
  var docCountDelta = 0;

  for (var i = 0, len = docInfos.length; i < len; i++) {
    var doc = docInfos[i];
    if (doc._id && utils.isLocalId(doc._id)) {
      continue;
    }
    doc = docInfos[i] = utils.parseDoc(doc, opts.new_edits);
    if (doc.error && !docInfoError) {
      docInfoError = doc;
    }
  }

  if (docInfoError) {
    return callback(docInfoError);
  }

  var results = new Array(docInfos.length);
  var fetchedDocs = new utils.Map();
  var preconditionErrored = false;
  var blobType = api._meta.blobSupport ? 'blob' : 'base64';

  utils.preprocessAttachments(docInfos, blobType, function (err) {
    if (err) {
      return callback(err);
    }
    startTransaction();
  });

  function startTransaction() {

    var stores = [
      DOC_STORE, BY_SEQ_STORE,
      ATTACH_STORE, META_STORE,
      LOCAL_STORE, ATTACH_AND_SEQ_STORE
    ];
    var txnResult = openTransactionSafely(idb, stores, 'readwrite');
    if (txnResult.error) {
      return callback(txnResult.error);
    }
    txn = txnResult.txn;
    txn.onerror = idbError(callback);
    txn.ontimeout = idbError(callback);
    txn.oncomplete = complete;
    docStore = txn.objectStore(DOC_STORE);
    bySeqStore = txn.objectStore(BY_SEQ_STORE);
    attachStore = txn.objectStore(ATTACH_STORE);
    attachAndSeqStore = txn.objectStore(ATTACH_AND_SEQ_STORE);

    verifyAttachments(function (err) {
      if (err) {
        preconditionErrored = true;
        return callback(err);
      }
      fetchExistingDocs();
    });
  }

  function processDocs() {

    utils.processDocs(docInfos, api, fetchedDocs, txn, results,
      writeDoc, opts);
  }

  function fetchExistingDocs() {

    if (!docInfos.length) {
      return;
    }

    var numFetched = 0;

    function checkDone() {
      if (++numFetched === docInfos.length) {
        processDocs();
      }
    }

    function readMetadata(event) {
      var metadata = decodeMetadata(event.target.result);

      if (metadata) {
        fetchedDocs.set(metadata.id, metadata);
      }
      checkDone();
    }

    for (var i = 0, len = docInfos.length; i < len; i++) {
      var docInfo = docInfos[i];
      if (docInfo._id && utils.isLocalId(docInfo._id)) {
        checkDone(); // skip local docs
        continue;
      }
      var req = docStore.get(docInfo.metadata.id);
      req.onsuccess = readMetadata;
    }
  }

  function complete() {
    if (preconditionErrored) {
      return;
    }

    Changes.notify(api._meta.name);
    api._meta.docCount += docCountDelta;
    callback(null, results);
  }

  function verifyAttachment(digest, callback) {

    var req = attachStore.get(digest);
    req.onsuccess = function (e) {
      if (!e.target.result) {
        var err = errors.error(errors.MISSING_STUB,
          'unknown stub attachment with digest ' +
          digest);
        err.status = 412;
        callback(err);
      } else {
        callback();
      }
    };
  }

  function verifyAttachments(finish) {


    var digests = [];
    docInfos.forEach(function (docInfo) {
      if (docInfo.data && docInfo.data._attachments) {
        Object.keys(docInfo.data._attachments).forEach(function (filename) {
          var att = docInfo.data._attachments[filename];
          if (att.stub) {
            digests.push(att.digest);
          }
        });
      }
    });
    if (!digests.length) {
      return finish();
    }
    var numDone = 0;
    var err;

    function checkDone() {
      if (++numDone === digests.length) {
        finish(err);
      }
    }
    digests.forEach(function (digest) {
      verifyAttachment(digest, function (attErr) {
        if (attErr && !err) {
          err = attErr;
        }
        checkDone();
      });
    });
  }

  function writeDoc(docInfo, winningRev, winningRevIsDeleted, newRevIsDeleted,
                    isUpdate, delta, resultsIdx, callback) {

    docCountDelta += delta;

    var doc = docInfo.data;
    doc._id = docInfo.metadata.id;
    doc._rev = docInfo.metadata.rev;

    if (newRevIsDeleted) {
      doc._deleted = true;
    }

    var hasAttachments = doc._attachments &&
      Object.keys(doc._attachments).length;
    if (hasAttachments) {
      return writeAttachments(docInfo, winningRev, winningRevIsDeleted,
        isUpdate, resultsIdx, callback);
    }

    finishDoc(docInfo, winningRev, winningRevIsDeleted,
      isUpdate, resultsIdx, callback);
  }

  function autoCompact(docInfo) {

    var revsToDelete = utils.compactTree(docInfo.metadata);
    compactRevs(revsToDelete, docInfo.metadata.id, txn);
  }

  function finishDoc(docInfo, winningRev, winningRevIsDeleted,
                     isUpdate, resultsIdx, callback) {

    var doc = docInfo.data;
    var metadata = docInfo.metadata;

    doc._doc_id_rev = metadata.id + '::' + metadata.rev;
    delete doc._id;
    delete doc._rev;

    function afterPutDoc(e) {
      if (isUpdate && api.auto_compaction) {
        autoCompact(docInfo);
      }
      metadata.seq = e.target.result;
      // Current _rev is calculated from _rev_tree on read
      delete metadata.rev;
      var metadataToStore = encodeMetadata(metadata, winningRev,
        winningRevIsDeleted);
      var metaDataReq = docStore.put(metadataToStore);
      metaDataReq.onsuccess = afterPutMetadata;
    }

    function afterPutDocError(e) {
      // ConstraintError, need to update, not put (see #1638 for details)
      e.preventDefault(); // avoid transaction abort
      e.stopPropagation(); // avoid transaction onerror
      var index = bySeqStore.index('_doc_id_rev');
      var getKeyReq = index.getKey(doc._doc_id_rev);
      getKeyReq.onsuccess = function (e) {
        var putReq = bySeqStore.put(doc, e.target.result);
        putReq.onsuccess = afterPutDoc;
      };
    }

    function afterPutMetadata() {
      results[resultsIdx] = {
        ok: true,
        id: metadata.id,
        rev: winningRev
      };
      fetchedDocs.set(docInfo.metadata.id, docInfo.metadata);
      insertAttachmentMappings(docInfo, metadata.seq, callback);
    }

    var putReq = bySeqStore.put(doc);

    putReq.onsuccess = afterPutDoc;
    putReq.onerror = afterPutDocError;
  }

  function writeAttachments(docInfo, winningRev, winningRevIsDeleted,
                            isUpdate, resultsIdx, callback) {


    var doc = docInfo.data;

    var numDone = 0;
    var attachments = Object.keys(doc._attachments);

    function collectResults() {
      if (numDone === attachments.length) {
        finishDoc(docInfo, winningRev, winningRevIsDeleted,
          isUpdate, resultsIdx, callback);
      }
    }

    function attachmentSaved() {
      numDone++;
      collectResults();
    }

    attachments.forEach(function (key) {
      var att = docInfo.data._attachments[key];
      if (!att.stub) {
        var data = att.data;
        delete att.data;
        var digest = att.digest;
        saveAttachment(digest, data, attachmentSaved);
      } else {
        numDone++;
        collectResults();
      }
    });
  }

  // map seqs to attachment digests, which
  // we will need later during compaction
  function insertAttachmentMappings(docInfo, seq, callback) {

    var attsAdded = 0;
    var attsToAdd = Object.keys(docInfo.data._attachments || {});

    if (!attsToAdd.length) {
      return callback();
    }

    function checkDone() {
      if (++attsAdded === attsToAdd.length) {
        callback();
      }
    }

    function add(att) {
      var digest = docInfo.data._attachments[att].digest;
      var req = attachAndSeqStore.put({
        seq: seq,
        digestSeq: digest + '::' + seq
      });

      req.onsuccess = checkDone;
      req.onerror = function (e) {
        // this callback is for a constaint error, which we ignore
        // because this docid/rev has already been associated with
        // the digest (e.g. when new_edits == false)
        e.preventDefault(); // avoid transaction abort
        e.stopPropagation(); // avoid transaction onerror
        checkDone();
      };
    }
    for (var i = 0; i < attsToAdd.length; i++) {
      add(attsToAdd[i]); // do in parallel
    }
  }

  function saveAttachment(digest, data, callback) {


    var getKeyReq = attachStore.count(digest);
    getKeyReq.onsuccess = function(e) {
      var count = e.target.result;
      if (count) {
        return callback(); // already exists
      }
      var newAtt = {
        digest: digest,
        body: data
      };
      var putReq = attachStore.put(newAtt);
      putReq.onsuccess = callback;
    };
  }
}

module.exports = idbBulkDocs;
},{"../../deps/errors":24,"../../utils":40,"./idb-constants":10,"./idb-utils":11}],10:[function(require,module,exports){
'use strict';

// IndexedDB requires a versioned database structure, so we use the
// version here to manage migrations.
exports.ADAPTER_VERSION = 5;

// The object stores created for each database
// DOC_STORE stores the document meta data, its revision history and state
// Keyed by document id
exports. DOC_STORE = 'document-store';
// BY_SEQ_STORE stores a particular version of a document, keyed by its
// sequence id
exports.BY_SEQ_STORE = 'by-sequence';
// Where we store attachments
exports.ATTACH_STORE = 'attach-store';
// Where we store many-to-many relations
// between attachment digests and seqs
exports.ATTACH_AND_SEQ_STORE = 'attach-seq-store';

// Where we store database-wide meta data in a single record
// keyed by id: META_STORE
exports.META_STORE = 'meta-store';
// Where we store local documents
exports.LOCAL_STORE = 'local-store';
// Where we detect blob support
exports.DETECT_BLOB_SUPPORT_STORE = 'detect-blob-support';
},{}],11:[function(require,module,exports){
(function (process){
'use strict';

var errors = require('../../deps/errors');
var utils = require('../../utils');
var constants = require('./idb-constants');

function tryCode(fun, that, args) {
  try {
    fun.apply(that, args);
  } catch (err) { // shouldn't happen
    if (typeof PouchDB !== 'undefined') {
      PouchDB.emit('error', err);
    }
  }
}

exports.taskQueue = {
  running: false,
  queue: []
};

exports.applyNext = function () {
  if (exports.taskQueue.running || !exports.taskQueue.queue.length) {
    return;
  }
  exports.taskQueue.running = true;
  var item = exports.taskQueue.queue.shift();
  item.action(function (err, res) {
    tryCode(item.callback, this, [err, res]);
    exports.taskQueue.running = false;
    process.nextTick(exports.applyNext);
  });
};

exports.idbError = function (callback) {
  return function (event) {
    var message = (event.target && event.target.error &&
      event.target.error.name) || event.target;
    callback(errors.error(errors.IDB_ERROR, message, event.type));
  };
};

// Unfortunately, the metadata has to be stringified
// when it is put into the database, because otherwise
// IndexedDB can throw errors for deeply-nested objects.
// Originally we just used JSON.parse/JSON.stringify; now
// we use this custom vuvuzela library that avoids recursion.
// If we could do it all over again, we'd probably use a
// format for the revision trees other than JSON.
exports.encodeMetadata = function (metadata, winningRev, deleted) {
  return {
    data: utils.safeJsonStringify(metadata),
    winningRev: winningRev,
    deletedOrLocal: deleted ? '1' : '0',
    seq: metadata.seq, // highest seq for this doc
    id: metadata.id
  };
};

exports.decodeMetadata = function (storedObject) {
  if (!storedObject) {
    return null;
  }
  var metadata = utils.safeJsonParse(storedObject.data);
  metadata.winningRev = storedObject.winningRev;
  metadata.deleted = storedObject.deletedOrLocal === '1';
  metadata.seq = storedObject.seq;
  return metadata;
};

// read the doc back out from the database. we don't store the
// _id or _rev because we already have _doc_id_rev.
exports.decodeDoc = function (doc) {
  if (!doc) {
    return doc;
  }
  var idx = utils.lastIndexOf(doc._doc_id_rev, ':');
  doc._id = doc._doc_id_rev.substring(0, idx - 1);
  doc._rev = doc._doc_id_rev.substring(idx + 1);
  delete doc._doc_id_rev;
  return doc;
};

// Read a blob from the database, encoding as necessary
// and translating from base64 if the IDB doesn't support
// native Blobs
exports.readBlobData = function (body, type, encode, callback) {
  if (encode) {
    if (!body) {
      callback('');
    } else if (typeof body !== 'string') { // we have blob support
      utils.readAsBinaryString(body, function (binary) {
        callback(utils.btoa(binary));
      });
    } else { // no blob support
      callback(body);
    }
  } else {
    if (!body) {
      callback(utils.createBlob([''], {type: type}));
    } else if (typeof body !== 'string') { // we have blob support
      callback(body);
    } else { // no blob support
      body = utils.fixBinary(atob(body));
      callback(utils.createBlob([body], {type: type}));
    }
  }
};

exports.fetchAttachmentsIfNecessary = function (doc, opts, txn, cb) {
  var attachments = Object.keys(doc._attachments || {});
  if (!attachments.length) {
    return cb && cb();
  }
  var numDone = 0;

  function checkDone() {
    if (++numDone === attachments.length && cb) {
      cb();
    }
  }

  function fetchAttachment(doc, att) {
    var attObj = doc._attachments[att];
    var digest = attObj.digest;
    var req = txn.objectStore(constants.ATTACH_STORE).get(digest);
    req.onsuccess = function (e) {
      attObj.body = e.target.result.body;
      checkDone();
    };
  }

  attachments.forEach(function (att) {
    if (opts.attachments && opts.include_docs) {
      fetchAttachment(doc, att);
    } else {
      doc._attachments[att].stub = true;
      checkDone();
    }
  });
};

// IDB-specific postprocessing necessary because
// we don't know whether we stored a true Blob or
// a base64-encoded string, and if it's a Blob it
// needs to be read outside of the transaction context
exports.postProcessAttachments = function (results) {
  return utils.Promise.all(results.map(function (row) {
    if (row.doc && row.doc._attachments) {
      var attNames = Object.keys(row.doc._attachments);
      return utils.Promise.all(attNames.map(function (att) {
        var attObj = row.doc._attachments[att];
        if (!('body' in attObj)) { // already processed
          return;
        }
        var body = attObj.body;
        var type = attObj.content_type;
        return new utils.Promise(function (resolve) {
          exports.readBlobData(body, type, true, function (base64) {
            row.doc._attachments[att] = utils.extend(
              utils.pick(attObj, ['digest', 'content_type']),
              {data: base64}
            );
            resolve();
          });
        });
      }));
    }
  }));
};

exports.compactRevs = function (revs, docId, txn) {

  var possiblyOrphanedDigests = [];
  var seqStore = txn.objectStore(constants.BY_SEQ_STORE);
  var attStore = txn.objectStore(constants.ATTACH_STORE);
  var attAndSeqStore = txn.objectStore(constants.ATTACH_AND_SEQ_STORE);
  var count = revs.length;

  function checkDone() {
    count--;
    if (!count) { // done processing all revs
      deleteOrphanedAttachments();
    }
  }

  function deleteOrphanedAttachments() {
    if (!possiblyOrphanedDigests.length) {
      return;
    }
    possiblyOrphanedDigests.forEach(function (digest) {
      var countReq = attAndSeqStore.index('digestSeq').count(
        IDBKeyRange.bound(
          digest + '::', digest + '::\uffff', false, false));
      countReq.onsuccess = function (e) {
        var count = e.target.result;
        if (!count) {
          // orphaned
          attStore["delete"](digest);
        }
      };
    });
  }

  revs.forEach(function (rev) {
    var index = seqStore.index('_doc_id_rev');
    var key = docId + "::" + rev;
    index.getKey(key).onsuccess = function (e) {
      var seq = e.target.result;
      if (typeof seq !== 'number') {
        return checkDone();
      }
      seqStore["delete"](seq);

      var cursor = attAndSeqStore.index('seq')
        .openCursor(IDBKeyRange.only(seq));

      cursor.onsuccess = function (event) {
        var cursor = event.target.result;
        if (cursor) {
          var digest = cursor.value.digestSeq.split('::')[0];
          possiblyOrphanedDigests.push(digest);
          attAndSeqStore["delete"](cursor.primaryKey);
          cursor["continue"]();
        } else { // done
          checkDone();
        }
      };
    };
  });
};

exports.openTransactionSafely = function (idb, stores, mode) {
  try {
    return {
      txn: idb.transaction(stores, mode)
    };
  } catch (err) {
    return {
      error: err
    };
  }
};
}).call(this,require('_process'))

},{"../../deps/errors":24,"../../utils":40,"./idb-constants":10,"_process":80}],12:[function(require,module,exports){
(function (process){
'use strict';

var utils = require('../../utils');
var merge = require('../../merge');
var errors = require('../../deps/errors');
var idbUtils = require('./idb-utils');
var idbConstants = require('./idb-constants');
var idbBulkDocs = require('./idb-bulk-docs');
var idbAllDocs = require('./idb-all-docs');
var checkBlobSupport = require('./idb-blob-support');

var ADAPTER_VERSION = idbConstants.ADAPTER_VERSION;
var ATTACH_AND_SEQ_STORE = idbConstants.ATTACH_AND_SEQ_STORE;
var ATTACH_STORE = idbConstants.ATTACH_STORE;
var BY_SEQ_STORE = idbConstants.BY_SEQ_STORE;
var DETECT_BLOB_SUPPORT_STORE = idbConstants.DETECT_BLOB_SUPPORT_STORE;
var DOC_STORE = idbConstants.DOC_STORE;
var LOCAL_STORE = idbConstants.LOCAL_STORE;
var META_STORE = idbConstants.META_STORE;

var applyNext = idbUtils.applyNext;
var compactRevs = idbUtils.compactRevs;
var decodeDoc = idbUtils.decodeDoc;
var decodeMetadata = idbUtils.decodeMetadata;
var encodeMetadata = idbUtils.encodeMetadata;
var fetchAttachmentsIfNecessary = idbUtils.fetchAttachmentsIfNecessary;
var idbError = idbUtils.idbError;
var postProcessAttachments = idbUtils.postProcessAttachments;
var readBlobData = idbUtils.readBlobData;
var taskQueue = idbUtils.taskQueue;
var openTransactionSafely = idbUtils.openTransactionSafely;

var cachedDBs = {};
var blobSupportPromise;

function IdbPouch(opts, callback) {
  var api = this;

  taskQueue.queue.push({
    action: function (thisCallback) {
      init(api, opts, thisCallback);
    },
    callback: callback
  });
  applyNext();
}

function init(api, opts, callback) {

  var dbName = opts.name;

  var idb = null;
  api._meta = null;

  // called when creating a fresh new database
  function createSchema(db) {
    var docStore = db.createObjectStore(DOC_STORE, {keyPath : 'id'});
    db.createObjectStore(BY_SEQ_STORE, {autoIncrement: true})
      .createIndex('_doc_id_rev', '_doc_id_rev', {unique: true});
    db.createObjectStore(ATTACH_STORE, {keyPath: 'digest'});
    db.createObjectStore(META_STORE, {keyPath: 'id', autoIncrement: false});
    db.createObjectStore(DETECT_BLOB_SUPPORT_STORE);

    // added in v2
    docStore.createIndex('deletedOrLocal', 'deletedOrLocal', {unique : false});

    // added in v3
    db.createObjectStore(LOCAL_STORE, {keyPath: '_id'});

    // added in v4
    var attAndSeqStore = db.createObjectStore(ATTACH_AND_SEQ_STORE,
      {autoIncrement: true});
    attAndSeqStore.createIndex('seq', 'seq');
    attAndSeqStore.createIndex('digestSeq', 'digestSeq', {unique: true});
  }

  // migration to version 2
  // unfortunately "deletedOrLocal" is a misnomer now that we no longer
  // store local docs in the main doc-store, but whaddyagonnado
  function addDeletedOrLocalIndex(txn, callback) {
    var docStore = txn.objectStore(DOC_STORE);
    docStore.createIndex('deletedOrLocal', 'deletedOrLocal', {unique : false});

    docStore.openCursor().onsuccess = function (event) {
      var cursor = event.target.result;
      if (cursor) {
        var metadata = cursor.value;
        var deleted = utils.isDeleted(metadata);
        metadata.deletedOrLocal = deleted ? "1" : "0";
        docStore.put(metadata);
        cursor["continue"]();
      } else {
        callback();
      }
    };
  }

  // migration to version 3 (part 1)
  function createLocalStoreSchema(db) {
    db.createObjectStore(LOCAL_STORE, {keyPath: '_id'})
      .createIndex('_doc_id_rev', '_doc_id_rev', {unique: true});
  }

  // migration to version 3 (part 2)
  function migrateLocalStore(txn, cb) {
    var localStore = txn.objectStore(LOCAL_STORE);
    var docStore = txn.objectStore(DOC_STORE);
    var seqStore = txn.objectStore(BY_SEQ_STORE);

    var cursor = docStore.openCursor();
    cursor.onsuccess = function (event) {
      var cursor = event.target.result;
      if (cursor) {
        var metadata = cursor.value;
        var docId = metadata.id;
        var local = utils.isLocalId(docId);
        var rev = merge.winningRev(metadata);
        if (local) {
          var docIdRev = docId + "::" + rev;
          // remove all seq entries
          // associated with this docId
          var start = docId + "::";
          var end = docId + "::~";
          var index = seqStore.index('_doc_id_rev');
          var range = IDBKeyRange.bound(start, end, false, false);
          var seqCursor = index.openCursor(range);
          seqCursor.onsuccess = function (e) {
            seqCursor = e.target.result;
            if (!seqCursor) {
              // done
              docStore["delete"](cursor.primaryKey);
              cursor["continue"]();
            } else {
              var data = seqCursor.value;
              if (data._doc_id_rev === docIdRev) {
                localStore.put(data);
              }
              seqStore["delete"](seqCursor.primaryKey);
              seqCursor["continue"]();
            }
          };
        } else {
          cursor["continue"]();
        }
      } else if (cb) {
        cb();
      }
    };
  }

  // migration to version 4 (part 1)
  function addAttachAndSeqStore(db) {
    var attAndSeqStore = db.createObjectStore(ATTACH_AND_SEQ_STORE,
      {autoIncrement: true});
    attAndSeqStore.createIndex('seq', 'seq');
    attAndSeqStore.createIndex('digestSeq', 'digestSeq', {unique: true});
  }

  // migration to version 4 (part 2)
  function migrateAttsAndSeqs(txn, callback) {
    var seqStore = txn.objectStore(BY_SEQ_STORE);
    var attStore = txn.objectStore(ATTACH_STORE);
    var attAndSeqStore = txn.objectStore(ATTACH_AND_SEQ_STORE);

    // need to actually populate the table. this is the expensive part,
    // so as an optimization, check first that this database even
    // contains attachments
    var req = attStore.count();
    req.onsuccess = function (e) {
      var count = e.target.result;
      if (!count) {
        return callback(); // done
      }

      seqStore.openCursor().onsuccess = function (e) {
        var cursor = e.target.result;
        if (!cursor) {
          return callback(); // done
        }
        var doc = cursor.value;
        var seq = cursor.primaryKey;
        var atts = Object.keys(doc._attachments || {});
        var digestMap = {};
        for (var j = 0; j < atts.length; j++) {
          var att = doc._attachments[atts[j]];
          digestMap[att.digest] = true; // uniq digests, just in case
        }
        var digests = Object.keys(digestMap);
        for (j = 0; j < digests.length; j++) {
          var digest = digests[j];
          attAndSeqStore.put({
            seq: seq,
            digestSeq: digest + '::' + seq
          });
        }
        cursor["continue"]();
      };
    };
  }

  // migration to version 5
  // Instead of relying on on-the-fly migration of metadata,
  // this brings the doc-store to its modern form:
  // - metadata.winningrev
  // - metadata.seq
  // - stringify the metadata when storing it
  function migrateMetadata(txn) {

    function decodeMetadataCompat(storedObject) {
      if (!storedObject.data) {
        // old format, when we didn't store it stringified
        storedObject.deleted = storedObject.deletedOrLocal === '1';
        return storedObject;
      }
      return decodeMetadata(storedObject);
    }

    // ensure that every metadata has a winningRev and seq,
    // which was previously created on-the-fly but better to migrate
    var bySeqStore = txn.objectStore(BY_SEQ_STORE);
    var docStore = txn.objectStore(DOC_STORE);
    var cursor = docStore.openCursor();
    cursor.onsuccess = function (e) {
      var cursor = e.target.result;
      if (!cursor) {
        return; // done
      }
      var metadata = decodeMetadataCompat(cursor.value);

      metadata.winningRev = metadata.winningRev || merge.winningRev(metadata);

      function fetchMetadataSeq() {
        // metadata.seq was added post-3.2.0, so if it's missing,
        // we need to fetch it manually
        var start = metadata.id + '::';
        var end = metadata.id + '::\uffff';
        var req = bySeqStore.index('_doc_id_rev').openCursor(
          IDBKeyRange.bound(start, end));

        var metadataSeq = 0;
        req.onsuccess = function (e) {
          var cursor = e.target.result;
          if (!cursor) {
            metadata.seq = metadataSeq;
            return onGetMetadataSeq();
          }
          var seq = cursor.primaryKey;
          if (seq > metadataSeq) {
            metadataSeq = seq;
          }
          cursor["continue"]();
        };
      }

      function onGetMetadataSeq() {
        var metadataToStore = encodeMetadata(metadata,
          metadata.winningRev, metadata.deleted);

        var req = docStore.put(metadataToStore);
        req.onsuccess = function () {
          cursor["continue"]();
        };
      }

      if (metadata.seq) {
        return onGetMetadataSeq();
      }

      fetchMetadataSeq();
    };

  }

  api.type = function () {
    return 'idb';
  };

  api._id = utils.toPromise(function (callback) {
    callback(null, api._meta.instanceId);
  });

  api._bulkDocs = function idb_bulkDocs(req, opts, callback) {
    idbBulkDocs(req, opts, api, idb, IdbPouch.Changes, callback);
  };

  // First we look up the metadata in the ids database, then we fetch the
  // current revision(s) from the by sequence store
  api._get = function idb_get(id, opts, callback) {
    var doc;
    var metadata;
    var err;
    var txn;
    opts = utils.clone(opts);
    if (opts.ctx) {
      txn = opts.ctx;
    } else {
      var txnResult = openTransactionSafely(idb,
        [DOC_STORE, BY_SEQ_STORE, ATTACH_STORE], 'readonly');
      if (txnResult.error) {
        return callback(txnResult.error);
      }
      txn = txnResult.txn;
    }

    function finish() {
      callback(err, {doc: doc, metadata: metadata, ctx: txn});
    }

    txn.objectStore(DOC_STORE).get(id).onsuccess = function (e) {
      metadata = decodeMetadata(e.target.result);
      // we can determine the result here if:
      // 1. there is no such document
      // 2. the document is deleted and we don't ask about specific rev
      // When we ask with opts.rev we expect the answer to be either
      // doc (possibly with _deleted=true) or missing error
      if (!metadata) {
        err = errors.error(errors.MISSING_DOC, 'missing');
        return finish();
      }
      if (utils.isDeleted(metadata) && !opts.rev) {
        err = errors.error(errors.MISSING_DOC, "deleted");
        return finish();
      }
      var objectStore = txn.objectStore(BY_SEQ_STORE);

      var rev = opts.rev || metadata.winningRev;
      var key = metadata.id + '::' + rev;

      objectStore.index('_doc_id_rev').get(key).onsuccess = function (e) {
        doc = e.target.result;
        if (doc) {
          doc = decodeDoc(doc);
        }
        if (!doc) {
          err = errors.error(errors.MISSING_DOC, 'missing');
          return finish();
        }
        finish();
      };
    };
  };

  api._getAttachment = function (attachment, opts, callback) {
    var txn;
    opts = utils.clone(opts);
    if (opts.ctx) {
      txn = opts.ctx;
    } else {
      var txnResult = openTransactionSafely(idb,
        [DOC_STORE, BY_SEQ_STORE, ATTACH_STORE], 'readonly');
      if (txnResult.error) {
        return callback(txnResult.error);
      }
      txn = txnResult.txn;
    }
    var digest = attachment.digest;
    var type = attachment.content_type;

    txn.objectStore(ATTACH_STORE).get(digest).onsuccess = function (e) {
      var body = e.target.result.body;
      readBlobData(body, type, opts.encode, function (blobData) {
        callback(null, blobData);
      });
    };
  };

  api._info = function idb_info(callback) {

    if (idb === null || !cachedDBs[dbName]) {
      var error = new Error('db isn\'t open');
      error.id = 'idbNull';
      return callback(error);
    }
    var updateSeq;
    var docCount;

    var txnResult = openTransactionSafely(idb, [BY_SEQ_STORE], 'readonly');
    if (txnResult.error) {
      return callback(txnResult.error);
    }
    var txn = txnResult.txn;
    var cursor = txn.objectStore(BY_SEQ_STORE).openCursor(null, 'prev');
    cursor.onsuccess = function (event) {
      var cursor = event.target.result;
      updateSeq = cursor ? cursor.key : 0;
      // count within the same txn for consistency
      docCount = api._meta.docCount;
    };

    txn.oncomplete = function () {
      callback(null, {
        doc_count: docCount,
        update_seq: updateSeq,
        // for debugging
        idb_attachment_format: (api._meta.blobSupport ? 'binary' : 'base64')
      });
    };
  };

  api._allDocs = function idb_allDocs(opts, callback) {
    idbAllDocs(opts, api, idb, callback);
  };

  api._changes = function (opts) {
    opts = utils.clone(opts);

    if (opts.continuous) {
      var id = dbName + ':' + utils.uuid();
      IdbPouch.Changes.addListener(dbName, id, api, opts);
      IdbPouch.Changes.notify(dbName);
      return {
        cancel: function () {
          IdbPouch.Changes.removeListener(dbName, id);
        }
      };
    }

    var docIds = opts.doc_ids && new utils.Set(opts.doc_ids);
    var descending = opts.descending ? 'prev' : null;

    opts.since = opts.since || 0;
    var lastSeq = opts.since;

    var limit = 'limit' in opts ? opts.limit : -1;
    if (limit === 0) {
      limit = 1; // per CouchDB _changes spec
    }
    var returnDocs;
    if ('returnDocs' in opts) {
      returnDocs = opts.returnDocs;
    } else {
      returnDocs = true;
    }

    var results = [];
    var numResults = 0;
    var filter = utils.filterChange(opts);
    var docIdsToMetadata = new utils.Map();

    var txn;
    var bySeqStore;
    var docStore;

    function onGetCursor(cursor) {

      var doc = decodeDoc(cursor.value);
      var seq = cursor.key;

      if (docIds && !docIds.has(doc._id)) {
        return cursor["continue"]();
      }

      var metadata;

      function onGetMetadata() {
        if (metadata.seq !== seq) {
          // some other seq is later
          return cursor["continue"]();
        }

        lastSeq = seq;

        if (metadata.winningRev === doc._rev) {
          return onGetWinningDoc(doc);
        }

        fetchWinningDoc();
      }

      function fetchWinningDoc() {
        var docIdRev = doc._id + '::' + metadata.winningRev;
        var req = bySeqStore.index('_doc_id_rev').openCursor(
          IDBKeyRange.bound(docIdRev, docIdRev + '\uffff'));
        req.onsuccess = function (e) {
          onGetWinningDoc(decodeDoc(e.target.result.value));
        };
      }

      function onGetWinningDoc(winningDoc) {

        var change = opts.processChange(winningDoc, metadata, opts);
        change.seq = metadata.seq;
        if (filter(change)) {
          numResults++;
          if (returnDocs) {
            results.push(change);
          }
          // process the attachment immediately
          // for the benefit of live listeners
          if (opts.attachments && opts.include_docs) {
            fetchAttachmentsIfNecessary(winningDoc, opts, txn, function () {
              postProcessAttachments([change]).then(function () {
                opts.onChange(change);
              });
            });
          } else {
            opts.onChange(change);
          }
        }
        if (numResults !== limit) {
          cursor["continue"]();
        }
      }

      metadata = docIdsToMetadata.get(doc._id);
      if (metadata) { // cached
        return onGetMetadata();
      }
      // metadata not cached, have to go fetch it
      docStore.get(doc._id).onsuccess = function (event) {
        metadata = decodeMetadata(event.target.result);
        docIdsToMetadata.set(doc._id, metadata);
        onGetMetadata();
      };
    }

    function onsuccess(event) {
      var cursor = event.target.result;

      if (!cursor) {
        return;
      }
      onGetCursor(cursor);
    }

    function fetchChanges() {
      var objectStores = [DOC_STORE, BY_SEQ_STORE];
      if (opts.attachments) {
        objectStores.push(ATTACH_STORE);
      }
      var txnResult = openTransactionSafely(idb, objectStores, 'readonly');
      if (txnResult.error) {
        return opts.complete(txnResult.error);
      }
      txn = txnResult.txn;
      txn.onerror = idbError(opts.complete);
      txn.oncomplete = onTxnComplete;

      bySeqStore = txn.objectStore(BY_SEQ_STORE);
      docStore = txn.objectStore(DOC_STORE);

      var req;

      if (descending) {
        req = bySeqStore.openCursor(

          null, descending);
      } else {
        req = bySeqStore.openCursor(
          IDBKeyRange.lowerBound(opts.since, true));
      }

      req.onsuccess = onsuccess;
    }

    fetchChanges();

    function onTxnComplete() {

      function finish() {
        opts.complete(null, {
          results: results,
          last_seq: lastSeq
        });
      }

      if (!opts.continuous && opts.attachments) {
        // cannot guarantee that postProcessing was already done,
        // so do it again
        postProcessAttachments(results).then(finish);
      } else {
        finish();
      }
    }
  };

  api._close = function (callback) {
    if (idb === null) {
      return callback(errors.error(errors.NOT_OPEN));
    }

    // https://developer.mozilla.org/en-US/docs/IndexedDB/IDBDatabase#close
    // "Returns immediately and closes the connection in a separate thread..."
    idb.close();
    delete cachedDBs[dbName];
    idb = null;
    callback();
  };

  api._getRevisionTree = function (docId, callback) {
    var txnResult = openTransactionSafely(idb, [DOC_STORE], 'readonly');
    if (txnResult.error) {
      return callback(txnResult.error);
    }
    var txn = txnResult.txn;
    var req = txn.objectStore(DOC_STORE).get(docId);
    req.onsuccess = function (event) {
      var doc = decodeMetadata(event.target.result);
      if (!doc) {
        callback(errors.error(errors.MISSING_DOC));
      } else {
        callback(null, doc.rev_tree);
      }
    };
  };

  // This function removes revisions of document docId
  // which are listed in revs and sets this document
  // revision to to rev_tree
  api._doCompaction = function (docId, revs, callback) {
    var stores = [
      DOC_STORE,
      BY_SEQ_STORE,
      ATTACH_STORE,
      ATTACH_AND_SEQ_STORE
    ];
    var txnResult = openTransactionSafely(idb, stores, 'readwrite');
    if (txnResult.error) {
      return callback(txnResult.error);
    }
    var txn = txnResult.txn;

    var docStore = txn.objectStore(DOC_STORE);

    docStore.get(docId).onsuccess = function (event) {
      var metadata = decodeMetadata(event.target.result);
      merge.traverseRevTree(metadata.rev_tree, function (isLeaf, pos,
                                                         revHash, ctx, opts) {
        var rev = pos + '-' + revHash;
        if (revs.indexOf(rev) !== -1) {
          opts.status = 'missing';
        }
      });
      compactRevs(revs, docId, txn);
      var winningRev = metadata.winningRev;
      var deleted = metadata.deleted;
      txn.objectStore(DOC_STORE).put(
        encodeMetadata(metadata, winningRev, deleted));
    };
    txn.onerror = idbError(callback);
    txn.oncomplete = function () {
      utils.call(callback);
    };
  };


  api._getLocal = function (id, callback) {
    var txnResult = openTransactionSafely(idb, [LOCAL_STORE], 'readonly');
    if (txnResult.error) {
      return callback(txnResult.error);
    }
    var tx = txnResult.txn;
    var req = tx.objectStore(LOCAL_STORE).get(id);

    req.onerror = idbError(callback);
    req.onsuccess = function (e) {
      var doc = e.target.result;
      if (!doc) {
        callback(errors.error(errors.MISSING_DOC));
      } else {
        delete doc['_doc_id_rev']; // for backwards compat
        callback(null, doc);
      }
    };
  };

  api._putLocal = function (doc, opts, callback) {
    if (typeof opts === 'function') {
      callback = opts;
      opts = {};
    }
    delete doc._revisions; // ignore this, trust the rev
    var oldRev = doc._rev;
    var id = doc._id;
    if (!oldRev) {
      doc._rev = '0-1';
    } else {
      doc._rev = '0-' + (parseInt(oldRev.split('-')[1], 10) + 1);
    }

    var tx = opts.ctx;
    var ret;
    if (!tx) {
      var txnResult = openTransactionSafely(idb, [LOCAL_STORE], 'readwrite');
      if (txnResult.error) {
        return callback(txnResult.error);
      }
      tx = txnResult.txn;
      tx.onerror = idbError(callback);
      tx.oncomplete = function () {
        if (ret) {
          callback(null, ret);
        }
      };
    }

    var oStore = tx.objectStore(LOCAL_STORE);
    var req;
    if (oldRev) {
      req = oStore.get(id);
      req.onsuccess = function (e) {
        var oldDoc = e.target.result;
        if (!oldDoc || oldDoc._rev !== oldRev) {
          callback(errors.error(errors.REV_CONFLICT));
        } else { // update
          var req = oStore.put(doc);
          req.onsuccess = function () {
            ret = {ok: true, id: doc._id, rev: doc._rev};
            if (opts.ctx) { // return immediately
              callback(null, ret);
            }
          };
        }
      };
    } else { // new doc
      req = oStore.add(doc);
      req.onerror = function (e) {
        // constraint error, already exists
        callback(errors.error(errors.REV_CONFLICT));
        e.preventDefault(); // avoid transaction abort
        e.stopPropagation(); // avoid transaction onerror
      };
      req.onsuccess = function () {
        ret = {ok: true, id: doc._id, rev: doc._rev};
        if (opts.ctx) { // return immediately
          callback(null, ret);
        }
      };
    }
  };

  api._removeLocal = function (doc, callback) {
    var txnResult = openTransactionSafely(idb, [LOCAL_STORE], 'readwrite');
    if (txnResult.error) {
      return callback(txnResult.error);
    }
    var tx = txnResult.txn;
    var ret;
    tx.oncomplete = function () {
      if (ret) {
        callback(null, ret);
      }
    };
    var id = doc._id;
    var oStore = tx.objectStore(LOCAL_STORE);
    var req = oStore.get(id);

    req.onerror = idbError(callback);
    req.onsuccess = function (e) {
      var oldDoc = e.target.result;
      if (!oldDoc || oldDoc._rev !== doc._rev) {
        callback(errors.error(errors.MISSING_DOC));
      } else {
        oStore["delete"](id);
        ret = {ok: true, id: id, rev: '0-0'};
      }
    };
  };

  var cached = cachedDBs[dbName];

  if (cached) {
    idb = cached.idb;
    api._meta = cached.global;
    process.nextTick(function () {
      callback(null, api);
    });
    return;
  }

  var req = indexedDB.open(dbName, ADAPTER_VERSION);

  if (!('openReqList' in IdbPouch)) {
    IdbPouch.openReqList = {};
  }
  IdbPouch.openReqList[dbName] = req;

  req.onupgradeneeded = function (e) {
    var db = e.target.result;
    if (e.oldVersion < 1) {
      return createSchema(db); // new db, initial schema
    }
    // do migrations

    var txn = e.currentTarget.transaction;
    // these migrations have to be done in this function, before
    // control is returned to the event loop, because IndexedDB

    if (e.oldVersion < 3) {
      createLocalStoreSchema(db); // v2 -> v3
    }
    if (e.oldVersion < 4) {
      addAttachAndSeqStore(db); // v3 -> v4
    }

    var migrations = [
      addDeletedOrLocalIndex, // v1 -> v2
      migrateLocalStore,      // v2 -> v3
      migrateAttsAndSeqs,     // v3 -> v4
      migrateMetadata         // v4 -> v5
    ];

    var i = e.oldVersion;

    function next() {
      var migration = migrations[i - 1];
      i++;
      if (migration) {
        migration(txn, next);
      }
    }

    next();
  };

  req.onsuccess = function (e) {

    idb = e.target.result;

    idb.onversionchange = function () {
      idb.close();
      delete cachedDBs[dbName];
    };
    idb.onabort = function () {
      idb.close();
      delete cachedDBs[dbName];
    };

    var txn = idb.transaction([
        META_STORE,
        DETECT_BLOB_SUPPORT_STORE,
        DOC_STORE
      ], 'readwrite');

    var req = txn.objectStore(META_STORE).get(META_STORE);

    var blobSupport = null;
    var docCount = null;
    var instanceId = null;

    req.onsuccess = function (e) {

      var checkSetupComplete = function () {
        if (blobSupport === null || docCount === null ||
            instanceId === null) {
          return;
        } else {
          api._meta = {
            name: dbName,
            instanceId: instanceId,
            blobSupport: blobSupport,
            docCount: docCount
          };

          cachedDBs[dbName] = {
            idb: idb,
            global: api._meta
          };
          callback(null, api);
        }
      };

      //
      // fetch/store the id
      //

      var meta = e.target.result || {id: META_STORE};
      if (dbName  + '_id' in meta) {
        instanceId = meta[dbName + '_id'];
        checkSetupComplete();
      } else {
        instanceId = utils.uuid();
        meta[dbName + '_id'] = instanceId;
        txn.objectStore(META_STORE).put(meta).onsuccess = function () {
          checkSetupComplete();
        };
      }

      //
      // check blob support
      //

      if (!blobSupportPromise) {
        // make sure blob support is only checked once
        blobSupportPromise = checkBlobSupport(txn, idb);
      }

      blobSupportPromise.then(function (val) {
        blobSupport = val;
        checkSetupComplete();
      });

      //
      // count docs
      //

      var index = txn.objectStore(DOC_STORE).index('deletedOrLocal');
      index.count(IDBKeyRange.only('0')).onsuccess = function (e) {
        docCount = e.target.result;
        checkSetupComplete();
      };

    };
  };

  req.onerror = idbError(callback);

}

IdbPouch.valid = function () {
  // Issue #2533, we finally gave up on doing bug
  // detection instead of browser sniffing. Safari brought us
  // to our knees.
  var isSafari = typeof openDatabase !== 'undefined' &&
    /(Safari|iPhone|iPad|iPod)/.test(navigator.userAgent) &&
    !/Chrome/.test(navigator.userAgent);

  // some outdated implementations of IDB that appear on Samsung
  // and HTC Android devices <4.4 are missing IDBKeyRange
  return !isSafari && typeof indexedDB !== 'undefined' &&
    typeof IDBKeyRange !== 'undefined';
};

function destroy(name, opts, callback) {
  if (!('openReqList' in IdbPouch)) {
    IdbPouch.openReqList = {};
  }
  IdbPouch.Changes.removeAllListeners(name);

  //Close open request for "name" database to fix ie delay.
  if (IdbPouch.openReqList[name] && IdbPouch.openReqList[name].result) {
    IdbPouch.openReqList[name].result.close();
    delete cachedDBs[name];
  }
  var req = indexedDB.deleteDatabase(name);

  req.onsuccess = function () {
    //Remove open request from the list.
    if (IdbPouch.openReqList[name]) {
      IdbPouch.openReqList[name] = null;
    }
    if (utils.hasLocalStorage() && (name in localStorage)) {
      delete localStorage[name];
    }
    callback(null, { 'ok': true });
  };

  req.onerror = idbError(callback);
}

IdbPouch.destroy = utils.toPromise(function (name, opts, callback) {
  taskQueue.queue.push({
    action: function (thisCallback) {
      destroy(name, opts, thisCallback);
    },
    callback: callback
  });
  applyNext();
});

IdbPouch.Changes = new utils.Changes();

module.exports = IdbPouch;

}).call(this,require('_process'))

},{"../../deps/errors":24,"../../merge":35,"../../utils":40,"./idb-all-docs":7,"./idb-blob-support":8,"./idb-bulk-docs":9,"./idb-constants":10,"./idb-utils":11,"_process":80}],13:[function(require,module,exports){
module.exports = ['idb', 'websql'];
},{}],14:[function(require,module,exports){
'use strict';

var utils = require('../../utils');
var errors = require('../../deps/errors');

var websqlUtils = require('./websql-utils');
var websqlConstants = require('./websql-constants');

var DOC_STORE = websqlConstants.DOC_STORE;
var BY_SEQ_STORE = websqlConstants.BY_SEQ_STORE;
var ATTACH_STORE = websqlConstants.ATTACH_STORE;
var ATTACH_AND_SEQ_STORE = websqlConstants.ATTACH_AND_SEQ_STORE;

var select = websqlUtils.select;
var stringifyDoc = websqlUtils.stringifyDoc;
var compactRevs = websqlUtils.compactRevs;
var unknownError = websqlUtils.unknownError;

function websqlBulkDocs(req, opts, api, db, Changes, callback) {
  var newEdits = opts.new_edits;
  var userDocs = req.docs;

  // Parse the docs, give them a sequence number for the result
  var docInfos = userDocs.map(function (doc) {
    if (doc._id && utils.isLocalId(doc._id)) {
      return doc;
    }
    var newDoc = utils.parseDoc(doc, newEdits);
    return newDoc;
  });

  var docInfoErrors = docInfos.filter(function (docInfo) {
    return docInfo.error;
  });
  if (docInfoErrors.length) {
    return callback(docInfoErrors[0]);
  }

  var tx;
  var results = new Array(docInfos.length);
  var fetchedDocs = new utils.Map();

  var preconditionErrored;
  function complete() {
    if (preconditionErrored) {
      return callback(preconditionErrored);
    }
    Changes.notify(api._name);
    api._docCount = -1; // invalidate
    callback(null, results);
  }

  function verifyAttachment(digest, callback) {
    var sql = 'SELECT count(*) as cnt FROM ' + ATTACH_STORE +
      ' WHERE digest=?';
    tx.executeSql(sql, [digest], function (tx, result) {
      if (result.rows.item(0).cnt === 0) {
        var err = errors.error(errors.MISSING_STUB,
          'unknown stub attachment with digest ' +
          digest);
        callback(err);
      } else {
        callback();
      }
    });
  }

  function verifyAttachments(finish) {
    var digests = [];
    docInfos.forEach(function (docInfo) {
      if (docInfo.data && docInfo.data._attachments) {
        Object.keys(docInfo.data._attachments).forEach(function (filename) {
          var att = docInfo.data._attachments[filename];
          if (att.stub) {
            digests.push(att.digest);
          }
        });
      }
    });
    if (!digests.length) {
      return finish();
    }
    var numDone = 0;
    var err;

    function checkDone() {
      if (++numDone === digests.length) {
        finish(err);
      }
    }
    digests.forEach(function (digest) {
      verifyAttachment(digest, function (attErr) {
        if (attErr && !err) {
          err = attErr;
        }
        checkDone();
      });
    });
  }

  function writeDoc(docInfo, winningRev, winningRevIsDeleted, newRevIsDeleted,
                    isUpdate, delta, resultsIdx, callback) {

    function finish() {
      var data = docInfo.data;
      var deletedInt = newRevIsDeleted ? 1 : 0;

      var id = data._id;
      var rev = data._rev;
      var json = stringifyDoc(data);
      var sql = 'INSERT INTO ' + BY_SEQ_STORE +
        ' (doc_id, rev, json, deleted) VALUES (?, ?, ?, ?);';
      var sqlArgs = [id, rev, json, deletedInt];

      // map seqs to attachment digests, which
      // we will need later during compaction
      function insertAttachmentMappings(seq, callback) {
        var attsAdded = 0;
        var attsToAdd = Object.keys(data._attachments || {});

        if (!attsToAdd.length) {
          return callback();
        }
        function checkDone() {
          if (++attsAdded === attsToAdd.length) {
            callback();
          }
          return false; // ack handling a constraint error
        }
        function add(att) {
          var sql = 'INSERT INTO ' + ATTACH_AND_SEQ_STORE +
            ' (digest, seq) VALUES (?,?)';
          var sqlArgs = [data._attachments[att].digest, seq];
          tx.executeSql(sql, sqlArgs, checkDone, checkDone);
          // second callback is for a constaint error, which we ignore
          // because this docid/rev has already been associated with
          // the digest (e.g. when new_edits == false)
        }
        for (var i = 0; i < attsToAdd.length; i++) {
          add(attsToAdd[i]); // do in parallel
        }
      }

      tx.executeSql(sql, sqlArgs, function (tx, result) {
        var seq = result.insertId;
        insertAttachmentMappings(seq, function () {
          dataWritten(tx, seq);
        });
      }, function () {
        // constraint error, recover by updating instead (see #1638)
        var fetchSql = select('seq', BY_SEQ_STORE, null,
          'doc_id=? AND rev=?');
        tx.executeSql(fetchSql, [id, rev], function (tx, res) {
          var seq = res.rows.item(0).seq;
          var sql = 'UPDATE ' + BY_SEQ_STORE +
            ' SET json=?, deleted=? WHERE doc_id=? AND rev=?;';
          var sqlArgs = [json, deletedInt, id, rev];
          tx.executeSql(sql, sqlArgs, function (tx) {
            insertAttachmentMappings(seq, function () {
              dataWritten(tx, seq);
            });
          });
        });
        return false; // ack that we've handled the error
      });
    }

    function collectResults(attachmentErr) {
      if (!err) {
        if (attachmentErr) {
          err = attachmentErr;
          callback(err);
        } else if (recv === attachments.length) {
          finish();
        }
      }
    }

    var err = null;
    var recv = 0;

    docInfo.data._id = docInfo.metadata.id;
    docInfo.data._rev = docInfo.metadata.rev;
    var attachments = Object.keys(docInfo.data._attachments || {});


    if (newRevIsDeleted) {
      docInfo.data._deleted = true;
    }

    function attachmentSaved(err) {
      recv++;
      collectResults(err);
    }

    attachments.forEach(function (key) {
      var att = docInfo.data._attachments[key];
      if (!att.stub) {
        var data = att.data;
        delete att.data;
        var digest = att.digest;
        saveAttachment(digest, data, attachmentSaved);
      } else {
        recv++;
        collectResults();
      }
    });

    if (!attachments.length) {
      finish();
    }

    function autoCompact() {
      if (!isUpdate || !api.auto_compaction) {
        return; // nothing to do
      }
      var id = docInfo.metadata.id;
      var revsToDelete = utils.compactTree(docInfo.metadata);
      compactRevs(revsToDelete, id, tx);
    }

    function dataWritten(tx, seq) {
      autoCompact();
      docInfo.metadata.seq = seq;
      delete docInfo.metadata.rev;

      var sql = isUpdate ?
      'UPDATE ' + DOC_STORE +
      ' SET json=?, max_seq=?, winningseq=' +
      '(SELECT seq FROM ' + BY_SEQ_STORE +
      ' WHERE doc_id=' + DOC_STORE + '.id AND rev=?) WHERE id=?'
        : 'INSERT INTO ' + DOC_STORE +
      ' (id, winningseq, max_seq, json) VALUES (?,?,?,?);';
      var metadataStr = utils.safeJsonStringify(docInfo.metadata);
      var id = docInfo.metadata.id;
      var params = isUpdate ?
        [metadataStr, seq, winningRev, id] :
        [id, seq, seq, metadataStr];
      tx.executeSql(sql, params, function () {
        results[resultsIdx] = {
          ok: true,
          id: docInfo.metadata.id,
          rev: winningRev
        };
        fetchedDocs.set(id, docInfo.metadata);
        callback();
      });
    }
  }

  function processDocs() {
    utils.processDocs(docInfos, api, fetchedDocs,
      tx, results, writeDoc, opts);
  }

  function fetchExistingDocs(callback) {
    if (!docInfos.length) {
      return callback();
    }

    var numFetched = 0;

    function checkDone() {
      if (++numFetched === docInfos.length) {
        callback();
      }
    }

    docInfos.forEach(function (docInfo) {
      if (docInfo._id && utils.isLocalId(docInfo._id)) {
        return checkDone(); // skip local docs
      }
      var id = docInfo.metadata.id;
      tx.executeSql('SELECT json FROM ' + DOC_STORE +
      ' WHERE id = ?', [id], function (tx, result) {
        if (result.rows.length) {
          var metadata = utils.safeJsonParse(result.rows.item(0).json);
          fetchedDocs.set(id, metadata);
        }
        checkDone();
      });
    });
  }

  function saveAttachment(digest, data, callback) {
    var sql = 'SELECT digest FROM ' + ATTACH_STORE + ' WHERE digest=?';
    tx.executeSql(sql, [digest], function (tx, result) {
      if (result.rows.length) { // attachment already exists
        return callback();
      }
      // we could just insert before selecting and catch the error,
      // but my hunch is that it's cheaper not to serialize the blob
      // from JS to C if we don't have to (TODO: confirm this)
      sql = 'INSERT INTO ' + ATTACH_STORE +
      ' (digest, body, escaped) VALUES (?,?,1)';
      tx.executeSql(sql, [digest, websqlUtils.escapeBlob(data)], function () {
        callback();
      }, function () {
        // ignore constaint errors, means it already exists
        callback();
        return false; // ack we handled the error
      });
    });
  }

  utils.preprocessAttachments(docInfos, 'binary', function (err) {
    if (err) {
      return callback(err);
    }
    db.transaction(function (txn) {
      tx = txn;
      verifyAttachments(function (err) {
        if (err) {
          preconditionErrored = err;
        } else {
          fetchExistingDocs(processDocs);
        }
      });
    }, unknownError(callback), complete);
  });
}

module.exports = websqlBulkDocs;

},{"../../deps/errors":24,"../../utils":40,"./websql-constants":15,"./websql-utils":16}],15:[function(require,module,exports){
'use strict';

function quote(str) {
  return "'" + str + "'";
}

exports.ADAPTER_VERSION = 7; // used to manage migrations

// The object stores created for each database
// DOC_STORE stores the document meta data, its revision history and state
exports.DOC_STORE = quote('document-store');
// BY_SEQ_STORE stores a particular version of a document, keyed by its
// sequence id
exports.BY_SEQ_STORE = quote('by-sequence');
// Where we store attachments
exports.ATTACH_STORE = quote('attach-store');
exports.LOCAL_STORE = quote('local-store');
exports.META_STORE = quote('metadata-store');
// where we store many-to-many relations between attachment
// digests and seqs
exports.ATTACH_AND_SEQ_STORE = quote('attach-seq-store');


},{}],16:[function(require,module,exports){
'use strict';

var utils = require('../../utils');
var errors = require('../../deps/errors');

var websqlConstants = require('./websql-constants');

var BY_SEQ_STORE = websqlConstants.BY_SEQ_STORE;
var ATTACH_STORE = websqlConstants.ATTACH_STORE;
var ATTACH_AND_SEQ_STORE = websqlConstants.ATTACH_AND_SEQ_STORE;

// escapeBlob and unescapeBlob are workarounds for a websql bug:
// https://code.google.com/p/chromium/issues/detail?id=422690
// https://bugs.webkit.org/show_bug.cgi?id=137637
// The goal is to never actually insert the \u0000 character
// in the database.
function escapeBlob(str) {
  return str
    .replace(/\u0002/g, '\u0002\u0002')
    .replace(/\u0001/g, '\u0001\u0002')
    .replace(/\u0000/g, '\u0001\u0001');
}

function unescapeBlob(str) {
  return str
    .replace(/\u0001\u0001/g, '\u0000')
    .replace(/\u0001\u0002/g, '\u0001')
    .replace(/\u0002\u0002/g, '\u0002');
}

function stringifyDoc(doc) {
  // don't bother storing the id/rev. it uses lots of space,
  // in persistent map/reduce especially
  delete doc._id;
  delete doc._rev;
  return JSON.stringify(doc);
}

function unstringifyDoc(doc, id, rev) {
  doc = JSON.parse(doc);
  doc._id = id;
  doc._rev = rev;
  return doc;
}

// question mark groups IN queries, e.g. 3 -> '(?,?,?)'
function qMarks(num) {
  var s = '(';
  while (num--) {
    s += '?';
    if (num) {
      s += ',';
    }
  }
  return s + ')';
}

function select(selector, table, joiner, where, orderBy) {
  return 'SELECT ' + selector + ' FROM ' +
    (typeof table === 'string' ? table : table.join(' JOIN ')) +
    (joiner ? (' ON ' + joiner) : '') +
    (where ? (' WHERE ' +
    (typeof where === 'string' ? where : where.join(' AND '))) : '') +
    (orderBy ? (' ORDER BY ' + orderBy) : '');
}

function compactRevs(revs, docId, tx) {

  if (!revs.length) {
    return;
  }

  var numDone = 0;
  var seqs = [];

  function checkDone() {
    if (++numDone === revs.length) { // done
      deleteOrphans();
    }
  }

  function deleteOrphans() {
    // find orphaned attachment digests

    if (!seqs.length) {
      return;
    }

    var sql = 'SELECT DISTINCT digest AS digest FROM ' +
      ATTACH_AND_SEQ_STORE + ' WHERE seq IN ' + qMarks(seqs.length);

    tx.executeSql(sql, seqs, function (tx, res) {

      var digestsToCheck = [];
      for (var i = 0; i < res.rows.length; i++) {
        digestsToCheck.push(res.rows.item(i).digest);
      }
      if (!digestsToCheck.length) {
        return;
      }

      var sql = 'DELETE FROM ' + ATTACH_AND_SEQ_STORE +
        ' WHERE seq IN (' +
        seqs.map(function () { return '?'; }).join(',') +
        ')';
      tx.executeSql(sql, seqs, function (tx) {

        var sql = 'SELECT digest FROM ' + ATTACH_AND_SEQ_STORE +
          ' WHERE digest IN (' +
          digestsToCheck.map(function () { return '?'; }).join(',') +
          ')';
        tx.executeSql(sql, digestsToCheck, function (tx, res) {
          var nonOrphanedDigests = new utils.Set();
          for (var i = 0; i < res.rows.length; i++) {
            nonOrphanedDigests.add(res.rows.item(i).digest);
          }
          digestsToCheck.forEach(function (digest) {
            if (nonOrphanedDigests.has(digest)) {
              return;
            }
            tx.executeSql(
              'DELETE FROM ' + ATTACH_AND_SEQ_STORE + ' WHERE digest=?',
              [digest]);
            tx.executeSql(
              'DELETE FROM ' + ATTACH_STORE + ' WHERE digest=?', [digest]);
          });
        });
      });
    });
  }

  // update by-seq and attach stores in parallel
  revs.forEach(function (rev) {
    var sql = 'SELECT seq FROM ' + BY_SEQ_STORE +
      ' WHERE doc_id=? AND rev=?';

    tx.executeSql(sql, [docId, rev], function (tx, res) {
      if (!res.rows.length) { // already deleted
        return checkDone();
      }
      var seq = res.rows.item(0).seq;
      seqs.push(seq);

      tx.executeSql(
        'DELETE FROM ' + BY_SEQ_STORE + ' WHERE seq=?', [seq], checkDone);
    });
  });
}

function unknownError(callback) {
  return function (event) {
    // event may actually be a SQLError object, so report is as such
    var errorNameMatch = event && event.constructor.toString()
        .match(/function ([^\(]+)/);
    var errorName = (errorNameMatch && errorNameMatch[1]) || event.type;
    var errorReason = event.target || event.message;
    callback(errors.error(errors.WSQ_ERROR, errorReason, errorName));
  };
}

function getSize(opts) {
  if ('size' in opts) {
    // triggers immediate popup in iOS, fixes #2347
    // e.g. 5000001 asks for 5 MB, 10000001 asks for 10 MB,
    return opts.size * 1000000;
  }
  // In iOS, doesn't matter as long as it's <= 5000000.
  // Except that if you request too much, our tests fail
  // because of the native "do you accept?" popup.
  // In Android <=4.3, this value is actually used as an
  // honest-to-god ceiling for data, so we need to
  // set it to a decently high number.
  var isAndroid = /Android/.test(window.navigator.userAgent);
  return isAndroid ? 5000000 : 1; // in PhantomJS, if you use 0 it will crash
}

function createOpenDBFunction() {
  if (typeof sqlitePlugin !== 'undefined') {
    // The SQLite Plugin started deviating pretty heavily from the
    // standard openDatabase() function, as they started adding more features.
    // It's better to just use their "new" format and pass in a big ol'
    // options object.
    return sqlitePlugin.openDatabase.bind(sqlitePlugin);
  }

  if (typeof openDatabase !== 'undefined') {
    return function openDB(opts) {
      // Traditional WebSQL API
      return openDatabase(opts.name, opts.version, opts.description, opts.size);
    };
  }
}

var cachedDatabases = {};

function openDB(opts) {

  var openDBFunction = createOpenDBFunction();

  var db = cachedDatabases[opts.name];
  if (!db) {
    db = cachedDatabases[opts.name] = openDBFunction(opts);
    db._sqlitePlugin = typeof sqlitePlugin !== 'undefined';
  }
  return db;
}

function valid() {
  // SQLitePlugin leaks this global object, which we can use
  // to detect if it's installed or not. The benefit is that it's
  // declared immediately, before the 'deviceready' event has fired.
  return typeof openDatabase !== 'undefined' ||
    typeof SQLitePlugin !== 'undefined';
}

module.exports = {
  escapeBlob: escapeBlob,
  unescapeBlob: unescapeBlob,
  stringifyDoc: stringifyDoc,
  unstringifyDoc: unstringifyDoc,
  qMarks: qMarks,
  select: select,
  compactRevs: compactRevs,
  unknownError: unknownError,
  getSize: getSize,
  openDB: openDB,
  valid: valid
};
},{"../../deps/errors":24,"../../utils":40,"./websql-constants":15}],17:[function(require,module,exports){
'use strict';

var utils = require('../../utils');
var merge = require('../../merge');
var errors = require('../../deps/errors');
var parseHexString = require('../../deps/parse-hex');

var websqlConstants = require('./websql-constants');
var websqlUtils = require('./websql-utils');
var websqlBulkDocs = require('./websql-bulk-docs');

var ADAPTER_VERSION = websqlConstants.ADAPTER_VERSION;
var DOC_STORE = websqlConstants.DOC_STORE;
var BY_SEQ_STORE = websqlConstants.BY_SEQ_STORE;
var ATTACH_STORE = websqlConstants.ATTACH_STORE;
var LOCAL_STORE = websqlConstants.LOCAL_STORE;
var META_STORE = websqlConstants.META_STORE;
var ATTACH_AND_SEQ_STORE = websqlConstants.ATTACH_AND_SEQ_STORE;

var qMarks = websqlUtils.qMarks;
var stringifyDoc = websqlUtils.stringifyDoc;
var unstringifyDoc = websqlUtils.unstringifyDoc;
var select = websqlUtils.select;
var compactRevs = websqlUtils.compactRevs;
var unknownError = websqlUtils.unknownError;
var getSize = websqlUtils.getSize;
var openDB = websqlUtils.openDB;

function fetchAttachmentsIfNecessary(doc, opts, api, txn, cb) {
  var attachments = Object.keys(doc._attachments || {});
  if (!attachments.length) {
    return cb && cb();
  }
  var numDone = 0;

  function checkDone() {
    if (++numDone === attachments.length && cb) {
      cb();
    }
  }

  function fetchAttachment(doc, att) {
    var attObj = doc._attachments[att];
    var attOpts = {encode: true, ctx: txn};
    api._getAttachment(attObj, attOpts, function (_, base64) {
      doc._attachments[att] = utils.extend(
        utils.pick(attObj, ['digest', 'content_type']),
        { data: base64 }
      );
      checkDone();
    });
  }

  attachments.forEach(function (att) {
    if (opts.attachments && opts.include_docs) {
      fetchAttachment(doc, att);
    } else {
      doc._attachments[att].stub = true;
      checkDone();
    }
  });
}

var POUCH_VERSION = 1;

// these indexes cover the ground for most allDocs queries
var BY_SEQ_STORE_DELETED_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS \'by-seq-deleted-idx\' ON ' +
  BY_SEQ_STORE + ' (seq, deleted)';
var BY_SEQ_STORE_DOC_ID_REV_INDEX_SQL =
  'CREATE UNIQUE INDEX IF NOT EXISTS \'by-seq-doc-id-rev\' ON ' +
    BY_SEQ_STORE + ' (doc_id, rev)';
var DOC_STORE_WINNINGSEQ_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS \'doc-winningseq-idx\' ON ' +
  DOC_STORE + ' (winningseq)';
var ATTACH_AND_SEQ_STORE_SEQ_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS \'attach-seq-seq-idx\' ON ' +
    ATTACH_AND_SEQ_STORE + ' (seq)';
var ATTACH_AND_SEQ_STORE_ATTACH_INDEX_SQL =
  'CREATE UNIQUE INDEX IF NOT EXISTS \'attach-seq-digest-idx\' ON ' +
    ATTACH_AND_SEQ_STORE + ' (digest, seq)';

var DOC_STORE_AND_BY_SEQ_JOINER = BY_SEQ_STORE +
  '.seq = ' + DOC_STORE + '.winningseq';

var SELECT_DOCS = BY_SEQ_STORE + '.seq AS seq, ' +
  BY_SEQ_STORE + '.deleted AS deleted, ' +
  BY_SEQ_STORE + '.json AS data, ' +
  BY_SEQ_STORE + '.rev AS rev, ' +
  DOC_STORE + '.json AS metadata';

function WebSqlPouch(opts, callback) {
  var api = this;
  var instanceId = null;
  var size = getSize(opts);
  var idRequests = [];
  var encoding;

  api._docCount = -1; // cache sqlite count(*) for performance
  api._name = opts.name;

  var db = openDB({
    name: api._name,
    version: POUCH_VERSION,
    description: api._name,
    size: size,
    location: opts.location,
    createFromLocation: opts.createFromLocation
  });
  if (!db) {
    return callback(errors.error(errors.UNKNOWN_ERROR));
  } else if (typeof db.readTransaction !== 'function') {
    // doesn't exist in sqlite plugin
    db.readTransaction = db.transaction;
  }

  function dbCreated() {
    // note the db name in case the browser upgrades to idb
    if (utils.hasLocalStorage()) {
      window.localStorage['_pouch__websqldb_' + api._name] = true;
    }
    callback(null, api);
  }

  // In this migration, we added the 'deleted' and 'local' columns to the
  // by-seq and doc store tables.
  // To preserve existing user data, we re-process all the existing JSON
  // and add these values.
  // Called migration2 because it corresponds to adapter version (db_version) #2
  function runMigration2(tx, callback) {
    // index used for the join in the allDocs query
    tx.executeSql(DOC_STORE_WINNINGSEQ_INDEX_SQL);

    tx.executeSql('ALTER TABLE ' + BY_SEQ_STORE +
      ' ADD COLUMN deleted TINYINT(1) DEFAULT 0', [], function () {
      tx.executeSql(BY_SEQ_STORE_DELETED_INDEX_SQL);
      tx.executeSql('ALTER TABLE ' + DOC_STORE +
        ' ADD COLUMN local TINYINT(1) DEFAULT 0', [], function () {
        tx.executeSql('CREATE INDEX IF NOT EXISTS \'doc-store-local-idx\' ON ' +
          DOC_STORE + ' (local, id)');

        var sql = 'SELECT ' + DOC_STORE + '.winningseq AS seq, ' + DOC_STORE +
          '.json AS metadata FROM ' + BY_SEQ_STORE + ' JOIN ' + DOC_STORE +
          ' ON ' + BY_SEQ_STORE + '.seq = ' + DOC_STORE + '.winningseq';

        tx.executeSql(sql, [], function (tx, result) {

          var deleted = [];
          var local = [];

          for (var i = 0; i < result.rows.length; i++) {
            var item = result.rows.item(i);
            var seq = item.seq;
            var metadata = JSON.parse(item.metadata);
            if (utils.isDeleted(metadata)) {
              deleted.push(seq);
            }
            if (utils.isLocalId(metadata.id)) {
              local.push(metadata.id);
            }
          }
          tx.executeSql('UPDATE ' + DOC_STORE + 'SET local = 1 WHERE id IN ' +
            qMarks(local.length), local, function () {
            tx.executeSql('UPDATE ' + BY_SEQ_STORE +
              ' SET deleted = 1 WHERE seq IN ' +
              qMarks(deleted.length), deleted, callback);
          });
        });
      });
    });
  }

  // in this migration, we make all the local docs unversioned
  function runMigration3(tx, callback) {
    var local = 'CREATE TABLE IF NOT EXISTS ' + LOCAL_STORE +
      ' (id UNIQUE, rev, json)';
    tx.executeSql(local, [], function () {
      var sql = 'SELECT ' + DOC_STORE + '.id AS id, ' +
        BY_SEQ_STORE + '.json AS data ' +
        'FROM ' + BY_SEQ_STORE + ' JOIN ' +
        DOC_STORE + ' ON ' + BY_SEQ_STORE + '.seq = ' +
        DOC_STORE + '.winningseq WHERE local = 1';
      tx.executeSql(sql, [], function (tx, res) {
        var rows = [];
        for (var i = 0; i < res.rows.length; i++) {
          rows.push(res.rows.item(i));
        }
        function doNext() {
          if (!rows.length) {
            return callback(tx);
          }
          var row = rows.shift();
          var rev = JSON.parse(row.data)._rev;
          tx.executeSql('INSERT INTO ' + LOCAL_STORE +
              ' (id, rev, json) VALUES (?,?,?)',
              [row.id, rev, row.data], function (tx) {
            tx.executeSql('DELETE FROM ' + DOC_STORE + ' WHERE id=?',
                [row.id], function (tx) {
              tx.executeSql('DELETE FROM ' + BY_SEQ_STORE + ' WHERE seq=?',
                  [row.seq], function () {
                doNext();
              });
            });
          });
        }
        doNext();
      });
    });
  }

  // in this migration, we remove doc_id_rev and just use rev
  function runMigration4(tx, callback) {

    function updateRows(rows) {
      function doNext() {
        if (!rows.length) {
          return callback(tx);
        }
        var row = rows.shift();
        var doc_id_rev = parseHexString(row.hex, encoding);
        var idx = doc_id_rev.lastIndexOf('::');
        var doc_id = doc_id_rev.substring(0, idx);
        var rev = doc_id_rev.substring(idx + 2);
        var sql = 'UPDATE ' + BY_SEQ_STORE +
          ' SET doc_id=?, rev=? WHERE doc_id_rev=?';
        tx.executeSql(sql, [doc_id, rev, doc_id_rev], function () {
          doNext();
        });
      }
      doNext();
    }

    var sql = 'ALTER TABLE ' + BY_SEQ_STORE + ' ADD COLUMN doc_id';
    tx.executeSql(sql, [], function (tx) {
      var sql = 'ALTER TABLE ' + BY_SEQ_STORE + ' ADD COLUMN rev';
      tx.executeSql(sql, [], function (tx) {
        tx.executeSql(BY_SEQ_STORE_DOC_ID_REV_INDEX_SQL, [], function (tx) {
          var sql = 'SELECT hex(doc_id_rev) as hex FROM ' + BY_SEQ_STORE;
          tx.executeSql(sql, [], function (tx, res) {
            var rows = [];
            for (var i = 0; i < res.rows.length; i++) {
              rows.push(res.rows.item(i));
            }
            updateRows(rows);
          });
        });
      });
    });
  }

  // in this migration, we add the attach_and_seq table
  // for issue #2818
  function runMigration5(tx, callback) {

    function migrateAttsAndSeqs(tx) {
      // need to actually populate the table. this is the expensive part,
      // so as an optimization, check first that this database even
      // contains attachments
      var sql = 'SELECT COUNT(*) AS cnt FROM ' + ATTACH_STORE;
      tx.executeSql(sql, [], function (tx, res) {
        var count = res.rows.item(0).cnt;
        if (!count) {
          return callback(tx);
        }

        var offset = 0;
        var pageSize = 10;
        function nextPage() {
          var sql = select(
            SELECT_DOCS + ', ' + DOC_STORE + '.id AS id',
            [DOC_STORE, BY_SEQ_STORE],
            DOC_STORE_AND_BY_SEQ_JOINER,
            null,
            DOC_STORE + '.id '
          );
          sql += ' LIMIT ' + pageSize + ' OFFSET ' + offset;
          offset += pageSize;
          tx.executeSql(sql, [], function (tx, res) {
            if (!res.rows.length) {
              return callback(tx);
            }
            var digestSeqs = {};
            function addDigestSeq(digest, seq) {
              // uniq digest/seq pairs, just in case there are dups
              var seqs = digestSeqs[digest] = (digestSeqs[digest] || []);
              if (seqs.indexOf(seq) === -1) {
                seqs.push(seq);
              }
            }
            for (var i = 0; i < res.rows.length; i++) {
              var row = res.rows.item(i);
              var doc = unstringifyDoc(row.data, row.id, row.rev);
              var atts = Object.keys(doc._attachments || {});
              for (var j = 0; j < atts.length; j++) {
                var att = doc._attachments[atts[j]];
                addDigestSeq(att.digest, row.seq);
              }
            }
            var digestSeqPairs = [];
            Object.keys(digestSeqs).forEach(function (digest) {
              var seqs = digestSeqs[digest];
              seqs.forEach(function (seq) {
                digestSeqPairs.push([digest, seq]);
              });
            });
            if (!digestSeqPairs.length) {
              return nextPage();
            }
            var numDone = 0;
            digestSeqPairs.forEach(function (pair) {
              var sql = 'INSERT INTO ' + ATTACH_AND_SEQ_STORE +
                ' (digest, seq) VALUES (?,?)';
              tx.executeSql(sql, pair, function () {
                if (++numDone === digestSeqPairs.length) {
                  nextPage();
                }
              });
            });
          });
        }
        nextPage();
      });
    }

    var attachAndRev = 'CREATE TABLE IF NOT EXISTS ' +
      ATTACH_AND_SEQ_STORE + ' (digest, seq INTEGER)';
    tx.executeSql(attachAndRev, [], function (tx) {
      tx.executeSql(
        ATTACH_AND_SEQ_STORE_ATTACH_INDEX_SQL, [], function (tx) {
          tx.executeSql(
            ATTACH_AND_SEQ_STORE_SEQ_INDEX_SQL, [],
            migrateAttsAndSeqs);
        });
    });
  }

  // in this migration, we use escapeBlob() and unescapeBlob()
  // instead of reading out the binary as HEX, which is slow
  function runMigration6(tx, callback) {
    var sql = 'ALTER TABLE ' + ATTACH_STORE +
      ' ADD COLUMN escaped TINYINT(1) DEFAULT 0';
    tx.executeSql(sql, [], callback);
  }

  // issue #3136, in this migration we need a "latest seq" as well
  // as the "winning seq" in the doc store
  function runMigration7(tx, callback) {
    var sql = 'ALTER TABLE ' + DOC_STORE +
      ' ADD COLUMN max_seq INTEGER';
    tx.executeSql(sql, [], function (tx) {
      var sql = 'UPDATE ' + DOC_STORE + ' SET max_seq=(SELECT MAX(seq) FROM ' +
        BY_SEQ_STORE + ' WHERE doc_id=id)';
      tx.executeSql(sql, [], function (tx) {
        // add unique index after filling, else we'll get a constraint
        // error when we do the ALTER TABLE
        var sql =
          'CREATE UNIQUE INDEX IF NOT EXISTS \'doc-max-seq-idx\' ON ' +
          DOC_STORE + ' (max_seq)';
        tx.executeSql(sql, [], callback);
      });
    });
  }

  function checkEncoding(tx, cb) {
    // UTF-8 on chrome/android, UTF-16 on safari < 7.1
    tx.executeSql('SELECT HEX("a") AS hex', [], function (tx, res) {
        var hex = res.rows.item(0).hex;
        encoding = hex.length === 2 ? 'UTF-8' : 'UTF-16';
        cb();
      }
    );
  }

  function onGetInstanceId() {
    while (idRequests.length > 0) {
      var idCallback = idRequests.pop();
      idCallback(null, instanceId);
    }
  }

  function onGetVersion(tx, dbVersion) {
    if (dbVersion === 0) {
      // initial schema

      var meta = 'CREATE TABLE IF NOT EXISTS ' + META_STORE +
        ' (dbid, db_version INTEGER)';
      var attach = 'CREATE TABLE IF NOT EXISTS ' + ATTACH_STORE +
        ' (digest UNIQUE, escaped TINYINT(1), body BLOB)';
      var attachAndRev = 'CREATE TABLE IF NOT EXISTS ' +
        ATTACH_AND_SEQ_STORE + ' (digest, seq INTEGER)';
      // TODO: migrate winningseq to INTEGER
      var doc = 'CREATE TABLE IF NOT EXISTS ' + DOC_STORE +
        ' (id unique, json, winningseq, max_seq INTEGER UNIQUE)';
      var seq = 'CREATE TABLE IF NOT EXISTS ' + BY_SEQ_STORE +
        ' (seq INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, ' +
        'json, deleted TINYINT(1), doc_id, rev)';
      var local = 'CREATE TABLE IF NOT EXISTS ' + LOCAL_STORE +
        ' (id UNIQUE, rev, json)';

      // creates
      tx.executeSql(attach);
      tx.executeSql(local);
      tx.executeSql(attachAndRev, [], function () {
        tx.executeSql(ATTACH_AND_SEQ_STORE_SEQ_INDEX_SQL);
        tx.executeSql(ATTACH_AND_SEQ_STORE_ATTACH_INDEX_SQL);
      });
      tx.executeSql(doc, [], function () {
        tx.executeSql(DOC_STORE_WINNINGSEQ_INDEX_SQL);
        tx.executeSql(seq, [], function () {
          tx.executeSql(BY_SEQ_STORE_DELETED_INDEX_SQL);
          tx.executeSql(BY_SEQ_STORE_DOC_ID_REV_INDEX_SQL);
          tx.executeSql(meta, [], function () {
            // mark the db version, and new dbid
            var initSeq = 'INSERT INTO ' + META_STORE +
              ' (db_version, dbid) VALUES (?,?)';
            instanceId = utils.uuid();
            var initSeqArgs = [ADAPTER_VERSION, instanceId];
            tx.executeSql(initSeq, initSeqArgs, function () {
              onGetInstanceId();
            });
          });
        });
      });
    } else { // version > 0

      var setupDone = function () {
        var migrated = dbVersion < ADAPTER_VERSION;
        if (migrated) {
          // update the db version within this transaction
          tx.executeSql('UPDATE ' + META_STORE + ' SET db_version = ' +
            ADAPTER_VERSION);
        }
        // notify db.id() callers
        var sql = 'SELECT dbid FROM ' + META_STORE;
        tx.executeSql(sql, [], function (tx, result) {
          instanceId = result.rows.item(0).dbid;
          onGetInstanceId();
        });
      };

      // would love to use promises here, but then websql
      // ends the transaction early
      var tasks = [
        runMigration2,
        runMigration3,
        runMigration4,
        runMigration5,
        runMigration6,
        runMigration7,
        setupDone
      ];

      // run each migration sequentially
      var i = dbVersion;
      var nextMigration = function (tx) {
        tasks[i - 1](tx, nextMigration);
        i++;
      };
      nextMigration(tx);
    }
  }

  function setup() {
    db.transaction(function (tx) {
      // first check the encoding
      checkEncoding(tx, function () {
        // then get the version
        fetchVersion(tx);
      });
    }, unknownError(callback), dbCreated);
  }

  function fetchVersion(tx) {
    var sql = 'SELECT sql FROM sqlite_master WHERE tbl_name = ' + META_STORE;
    tx.executeSql(sql, [], function (tx, result) {
      if (!result.rows.length) {
        // database hasn't even been created yet (version 0)
        onGetVersion(tx, 0);
      } else if (!/db_version/.test(result.rows.item(0).sql)) {
        // table was created, but without the new db_version column,
        // so add it.
        tx.executeSql('ALTER TABLE ' + META_STORE +
          ' ADD COLUMN db_version INTEGER', [], function () {
          // before version 2, this column didn't even exist
          onGetVersion(tx, 1);
        });
      } else { // column exists, we can safely get it
        tx.executeSql('SELECT db_version FROM ' + META_STORE,
          [], function (tx, result) {
          var dbVersion = result.rows.item(0).db_version;
          onGetVersion(tx, dbVersion);
        });
      }
    });
  }

  if (utils.isCordova()) {
    //to wait until custom api is made in pouch.adapters before doing setup
    window.addEventListener(api._name + '_pouch', function cordova_init() {
      window.removeEventListener(api._name + '_pouch', cordova_init, false);
      setup();
    }, false);
  } else {
    setup();
  }

  api.type = function () {
    return 'websql';
  };

  api._id = utils.toPromise(function (callback) {
    callback(null, instanceId);
  });

  api._info = function (callback) {
    db.readTransaction(function (tx) {
      countDocs(tx, function (docCount) {
        var sql = 'SELECT MAX(seq) AS seq FROM ' + BY_SEQ_STORE;
        tx.executeSql(sql, [], function (tx, res) {
          var updateSeq = res.rows.item(0).seq || 0;
          callback(null, {
            doc_count: docCount,
            update_seq: updateSeq,
            // for debugging
            sqlite_plugin: db._sqlitePlugin,
            websql_encoding: encoding
          });
        });
      });
    }, unknownError(callback));
  };

  api._bulkDocs = function (req, opts, callback) {
    websqlBulkDocs(req, opts, api, db, WebSqlPouch.Changes, callback);
  };

  api._get = function (id, opts, callback) {
    opts = utils.clone(opts);
    var doc;
    var metadata;
    var err;
    if (!opts.ctx) {
      db.readTransaction(function (txn) {
        opts.ctx = txn;
        api._get(id, opts, callback);
      });
      return;
    }
    var tx = opts.ctx;

    function finish() {
      callback(err, {doc: doc, metadata: metadata, ctx: tx});
    }

    var sql;
    var sqlArgs;
    if (opts.rev) {
      sql = select(
        SELECT_DOCS,
        [DOC_STORE, BY_SEQ_STORE],
        DOC_STORE + '.id=' + BY_SEQ_STORE + '.doc_id',
        [BY_SEQ_STORE + '.doc_id=?', BY_SEQ_STORE + '.rev=?']);
      sqlArgs = [id, opts.rev];
    } else {
      sql = select(
        SELECT_DOCS,
        [DOC_STORE, BY_SEQ_STORE],
        DOC_STORE_AND_BY_SEQ_JOINER,
        DOC_STORE + '.id=?');
      sqlArgs = [id];
    }
    tx.executeSql(sql, sqlArgs, function (a, results) {
      if (!results.rows.length) {
        err = errors.error(errors.MISSING_DOC, 'missing');
        return finish();
      }
      var item = results.rows.item(0);
      metadata = utils.safeJsonParse(item.metadata);
      if (item.deleted && !opts.rev) {
        err = errors.error(errors.MISSING_DOC, 'deleted');
        return finish();
      }
      doc = unstringifyDoc(item.data, metadata.id, item.rev);
      finish();
    });
  };

  function countDocs(tx, callback) {

    if (api._docCount !== -1) {
      return callback(api._docCount);
    }

    // count the total rows
    var sql = select(
      'COUNT(' + DOC_STORE + '.id) AS \'num\'',
      [DOC_STORE, BY_SEQ_STORE],
      DOC_STORE_AND_BY_SEQ_JOINER,
      BY_SEQ_STORE + '.deleted=0');

    tx.executeSql(sql, [], function (tx, result) {
      api._docCount = result.rows.item(0).num;
      callback(api._docCount);
    });
  }

  api._allDocs = function (opts, callback) {
    var results = [];
    var totalRows;

    var start = 'startkey' in opts ? opts.startkey : false;
    var end = 'endkey' in opts ? opts.endkey : false;
    var key = 'key' in opts ? opts.key : false;
    var descending = 'descending' in opts ? opts.descending : false;
    var limit = 'limit' in opts ? opts.limit : -1;
    var offset = 'skip' in opts ? opts.skip : 0;
    var inclusiveEnd = opts.inclusive_end !== false;

    var sqlArgs = [];
    var criteria = [];

    if (key !== false) {
      criteria.push(DOC_STORE + '.id = ?');
      sqlArgs.push(key);
    } else if (start !== false || end !== false) {
      if (start !== false) {
        criteria.push(DOC_STORE + '.id ' + (descending ? '<=' : '>=') + ' ?');
        sqlArgs.push(start);
      }
      if (end !== false) {
        var comparator = descending ? '>' : '<';
        if (inclusiveEnd) {
          comparator += '=';
        }
        criteria.push(DOC_STORE + '.id ' + comparator + ' ?');
        sqlArgs.push(end);
      }
      if (key !== false) {
        criteria.push(DOC_STORE + '.id = ?');
        sqlArgs.push(key);
      }
    }

    if (opts.deleted !== 'ok') {
      // report deleted if keys are specified
      criteria.push(BY_SEQ_STORE + '.deleted = 0');
    }

    db.readTransaction(function (tx) {

      // first count up the total rows
      countDocs(tx, function (count) {
        totalRows = count;

        if (limit === 0) {
          return;
        }

        // then actually fetch the documents
        var sql = select(
          SELECT_DOCS,
          [DOC_STORE, BY_SEQ_STORE],
          DOC_STORE_AND_BY_SEQ_JOINER,
          criteria,
          DOC_STORE + '.id ' + (descending ? 'DESC' : 'ASC')
          );
        sql += ' LIMIT ' + limit + ' OFFSET ' + offset;

        tx.executeSql(sql, sqlArgs, function (tx, result) {
          for (var i = 0, l = result.rows.length; i < l; i++) {
            var item = result.rows.item(i);
            var metadata = utils.safeJsonParse(item.metadata);
            var id = metadata.id;
            var data = unstringifyDoc(item.data, id, item.rev);
            var winningRev = data._rev;
            var doc = {
              id: id,
              key: id,
              value: {rev: winningRev}
            };
            if (opts.include_docs) {
              doc.doc = data;
              doc.doc._rev = winningRev;
              if (opts.conflicts) {
                doc.doc._conflicts = merge.collectConflicts(metadata);
              }
              fetchAttachmentsIfNecessary(doc.doc, opts, api, tx);
            }
            if (item.deleted) {
              if (opts.deleted === 'ok') {
                doc.value.deleted = true;
                doc.doc = null;
              } else {
                continue;
              }
            }
            results.push(doc);
          }
        });
      });
    }, unknownError(callback), function () {
      callback(null, {
        total_rows: totalRows,
        offset: opts.skip,
        rows: results
      });
    });
  };

  api._changes = function (opts) {
    opts = utils.clone(opts);

    if (opts.continuous) {
      var id = api._name + ':' + utils.uuid();
      WebSqlPouch.Changes.addListener(api._name, id, api, opts);
      WebSqlPouch.Changes.notify(api._name);
      return {
        cancel: function () {
          WebSqlPouch.Changes.removeListener(api._name, id);
        }
      };
    }

    var descending = opts.descending;

    // Ignore the `since` parameter when `descending` is true
    opts.since = opts.since && !descending ? opts.since : 0;

    var limit = 'limit' in opts ? opts.limit : -1;
    if (limit === 0) {
      limit = 1; // per CouchDB _changes spec
    }

    var returnDocs;
    if ('returnDocs' in opts) {
      returnDocs = opts.returnDocs;
    } else {
      returnDocs = true;
    }
    var results = [];
    var numResults = 0;

    function fetchChanges() {

      var selectStmt =
        DOC_STORE + '.json AS metadata, ' +
        DOC_STORE + '.max_seq AS maxSeq, ' +
        BY_SEQ_STORE + '.json AS winningDoc, ' +
        BY_SEQ_STORE + '.rev AS winningRev ';

      var from = DOC_STORE + ' JOIN ' + BY_SEQ_STORE;

      var joiner = DOC_STORE + '.id=' + BY_SEQ_STORE + '.doc_id' +
        ' AND ' + DOC_STORE + '.winningseq=' + BY_SEQ_STORE + '.seq';

      var criteria = ['maxSeq > ?'];
      var sqlArgs = [opts.since];

      if (opts.doc_ids) {
        criteria.push(DOC_STORE + '.id IN ' + qMarks(opts.doc_ids.length));
        sqlArgs = sqlArgs.concat(opts.doc_ids);
      }

      var orderBy = 'maxSeq ' + (descending ? 'DESC' : 'ASC');

      var sql = select(selectStmt, from, joiner, criteria, orderBy);

      var filter = utils.filterChange(opts);
      if (!opts.view && !opts.filter) {
        // we can just limit in the query
        sql += ' LIMIT ' + limit;
      }

      var lastSeq = opts.since || 0;
      db.readTransaction(function (tx) {
        tx.executeSql(sql, sqlArgs, function (tx, result) {
          function reportChange(change) {
            return function () {
              opts.onChange(change);
            };
          }
          for (var i = 0, l = result.rows.length; i < l; i++) {
            var item = result.rows.item(i);
            var metadata = utils.safeJsonParse(item.metadata);
            lastSeq = item.maxSeq;

            var doc = unstringifyDoc(item.winningDoc, metadata.id,
              item.winningRev);
            var change = opts.processChange(doc, metadata, opts);
            change.seq = item.maxSeq;
            if (filter(change)) {
              numResults++;
              if (returnDocs) {
                results.push(change);
              }
              // process the attachment immediately
              // for the benefit of live listeners
              if (opts.attachments && opts.include_docs) {
                fetchAttachmentsIfNecessary(doc, opts, api, tx,
                  reportChange(change));
              } else {
                reportChange(change)();
              }
            }
            if (numResults === limit) {
              break;
            }
          }
        });
      }, unknownError(opts.complete), function () {
        if (!opts.continuous) {
          opts.complete(null, {
            results: results,
            last_seq: lastSeq
          });
        }
      });
    }

    fetchChanges();
  };

  api._close = function (callback) {
    //WebSQL databases do not need to be closed
    callback();
  };

  api._getAttachment = function (attachment, opts, callback) {
    var res;
    var tx = opts.ctx;
    var digest = attachment.digest;
    var type = attachment.content_type;
    var sql = 'SELECT escaped, ' +
      'CASE WHEN escaped = 1 THEN body ELSE HEX(body) END AS body FROM ' +
      ATTACH_STORE + ' WHERE digest=?';
    tx.executeSql(sql, [digest], function (tx, result) {
      // websql has a bug where \u0000 causes early truncation in strings
      // and blobs. to work around this, we used to use the hex() function,
      // but that's not performant. after migration 6, we remove \u0000
      // and add it back in afterwards
      var item = result.rows.item(0);
      var data = item.escaped ? websqlUtils.unescapeBlob(item.body) :
        parseHexString(item.body, encoding);
      if (opts.encode) {
        res = btoa(data);
      } else {
        data = utils.fixBinary(data);
        res = utils.createBlob([data], {type: type});
      }
      callback(null, res);
    });
  };

  api._getRevisionTree = function (docId, callback) {
    db.readTransaction(function (tx) {
      var sql = 'SELECT json AS metadata FROM ' + DOC_STORE + ' WHERE id = ?';
      tx.executeSql(sql, [docId], function (tx, result) {
        if (!result.rows.length) {
          callback(errors.error(errors.MISSING_DOC));
        } else {
          var data = utils.safeJsonParse(result.rows.item(0).metadata);
          callback(null, data.rev_tree);
        }
      });
    });
  };

  api._doCompaction = function (docId, revs, callback) {
    if (!revs.length) {
      return callback();
    }
    db.transaction(function (tx) {

      // update doc store
      var sql = 'SELECT json AS metadata FROM ' + DOC_STORE + ' WHERE id = ?';
      tx.executeSql(sql, [docId], function (tx, result) {
        var metadata = utils.safeJsonParse(result.rows.item(0).metadata);
        merge.traverseRevTree(metadata.rev_tree, function (isLeaf, pos,
                                                           revHash, ctx, opts) {
          var rev = pos + '-' + revHash;
          if (revs.indexOf(rev) !== -1) {
            opts.status = 'missing';
          }
        });

        var sql = 'UPDATE ' + DOC_STORE + ' SET json = ? WHERE id = ?';
        tx.executeSql(sql, [utils.safeJsonStringify(metadata), docId]);
      });

      compactRevs(revs, docId, tx);
    }, unknownError(callback), function () {
      callback();
    });
  };

  api._getLocal = function (id, callback) {
    db.readTransaction(function (tx) {
      var sql = 'SELECT json, rev FROM ' + LOCAL_STORE + ' WHERE id=?';
      tx.executeSql(sql, [id], function (tx, res) {
        if (res.rows.length) {
          var item = res.rows.item(0);
          var doc = unstringifyDoc(item.json, id, item.rev);
          callback(null, doc);
        } else {
          callback(errors.error(errors.MISSING_DOC));
        }
      });
    });
  };

  api._putLocal = function (doc, opts, callback) {
    if (typeof opts === 'function') {
      callback = opts;
      opts = {};
    }
    delete doc._revisions; // ignore this, trust the rev
    var oldRev = doc._rev;
    var id = doc._id;
    var newRev;
    if (!oldRev) {
      newRev = doc._rev = '0-1';
    } else {
      newRev = doc._rev = '0-' + (parseInt(oldRev.split('-')[1], 10) + 1);
    }
    var json = stringifyDoc(doc);

    var ret;
    function putLocal(tx) {
      var sql;
      var values;
      if (oldRev) {
        sql = 'UPDATE ' + LOCAL_STORE + ' SET rev=?, json=? ' +
          'WHERE id=? AND rev=?';
        values = [newRev, json, id, oldRev];
      } else {
        sql = 'INSERT INTO ' + LOCAL_STORE + ' (id, rev, json) VALUES (?,?,?)';
        values = [id, newRev, json];
      }
      tx.executeSql(sql, values, function (tx, res) {
        if (res.rowsAffected) {
          ret = {ok: true, id: id, rev: newRev};
          if (opts.ctx) { // return immediately
            callback(null, ret);
          }
        } else {
          callback(errors.error(errors.REV_CONFLICT));
        }
      }, function () {
        callback(errors.error(errors.REV_CONFLICT));
        return false; // ack that we handled the error
      });
    }

    if (opts.ctx) {
      putLocal(opts.ctx);
    } else {
      db.transaction(function (tx) {
        putLocal(tx);
      }, unknownError(callback), function () {
        if (ret) {
          callback(null, ret);
        }
      });
    }
  };

  api._removeLocal = function (doc, callback) {
    var ret;
    db.transaction(function (tx) {
      var sql = 'DELETE FROM ' + LOCAL_STORE + ' WHERE id=? AND rev=?';
      var params = [doc._id, doc._rev];
      tx.executeSql(sql, params, function (tx, res) {
        if (!res.rowsAffected) {
          return callback(errors.error(errors.MISSING_DOC));
        }
        ret = {ok: true, id: doc._id, rev: '0-0'};
      });
    }, unknownError(callback), function () {
      if (ret) {
        callback(null, ret);
      }
    });
  };
}

WebSqlPouch.valid = websqlUtils.valid;

WebSqlPouch.destroy = utils.toPromise(function (name, opts, callback) {
  WebSqlPouch.Changes.removeAllListeners(name);
  var size = getSize(opts);
  var db = openDB({
    name: name,
    version: POUCH_VERSION,
    description: name,
    size: size,
    location: opts.location,
    createFromLocation: opts.createFromLocation
  });
  db.transaction(function (tx) {
    var stores = [DOC_STORE, BY_SEQ_STORE, ATTACH_STORE, META_STORE,
      LOCAL_STORE, ATTACH_AND_SEQ_STORE];
    stores.forEach(function (store) {
      tx.executeSql('DROP TABLE IF EXISTS ' + store, []);
    });
  }, unknownError(callback), function () {
    if (utils.hasLocalStorage()) {
      delete window.localStorage['_pouch__websqldb_' + name];
      delete window.localStorage[name];
    }
    callback(null, {'ok': true});
  });
});

WebSqlPouch.Changes = new utils.Changes();

module.exports = WebSqlPouch;

},{"../../deps/errors":24,"../../deps/parse-hex":27,"../../merge":35,"../../utils":40,"./websql-bulk-docs":14,"./websql-constants":15,"./websql-utils":16}],18:[function(require,module,exports){
'use strict';
var utils = require('./utils');
var merge = require('./merge');
var errors = require('./deps/errors');
var EE = require('events').EventEmitter;
var evalFilter = require('./evalFilter');
var evalView = require('./evalView');
module.exports = Changes;
utils.inherits(Changes, EE);

function Changes(db, opts, callback) {
  EE.call(this);
  var self = this;
  this.db = db;
  opts = opts ? utils.clone(opts) : {};
  var oldComplete = callback || opts.complete || function () {};
  var complete = opts.complete = utils.once(function (err, resp) {
    if (err) {
      self.emit('error', err);
    } else {
      self.emit('complete', resp);
    }
    self.removeAllListeners();
    db.removeListener('destroyed', onDestroy);
  });
  if (oldComplete) {
    self.on('complete', function (resp) {
      oldComplete(null, resp);
    });
    self.on('error', function (err) {
      oldComplete(err);
    });
  }
  var oldOnChange = opts.onChange;
  if (oldOnChange) {
    self.on('change', oldOnChange);
  }
  function onDestroy() {
    self.cancel();
  }
  db.once('destroyed', onDestroy);

  opts.onChange = function (change) {
    if (opts.isCancelled) {
      return;
    }
    self.emit('change', change);
    if (self.startSeq && self.startSeq <= change.seq) {
      self.emit('uptodate');
      self.startSeq = false;
    }
    if (change.deleted) {
      self.emit('delete', change);
    } else if (change.changes.length === 1 &&
      change.changes[0].rev.slice(0, 2) === '1-') {
      self.emit('create', change);
    } else {
      self.emit('update', change);
    }
  };

  var promise = new utils.Promise(function (fulfill, reject) {
    opts.complete = function (err, res) {
      if (err) {
        reject(err);
      } else {
        fulfill(res);
      }
    };
  });
  self.once('cancel', function () {
    if (oldOnChange) {
      self.removeListener('change', oldOnChange);
    }
    opts.complete(null, {status: 'cancelled'});
  });
  this.then = promise.then.bind(promise);
  this['catch'] = promise['catch'].bind(promise);
  this.then(function (result) {
    complete(null, result);
  }, complete);



  if (!db.taskqueue.isReady) {
    db.taskqueue.addTask(function () {
      if (self.isCancelled) {
        self.emit('cancel');
      } else {
        self.doChanges(opts);
      }
    });
  } else {
    self.doChanges(opts);
  }
}
Changes.prototype.cancel = function () {
  this.isCancelled = true;
  if (this.db.taskqueue.isReady) {
    this.emit('cancel');
  }
};
function processChange(doc, metadata, opts) {
  var changeList = [{rev: doc._rev}];
  if (opts.style === 'all_docs') {
    changeList = merge.collectLeaves(metadata.rev_tree)
    .map(function (x) { return {rev: x.rev}; });
  }
  var change = {
    id: metadata.id,
    changes: changeList,
    doc: doc
  };

  if (utils.isDeleted(metadata, doc._rev)) {
    change.deleted = true;
  }
  if (opts.conflicts) {
    change.doc._conflicts = merge.collectConflicts(metadata);
    if (!change.doc._conflicts.length) {
      delete change.doc._conflicts;
    }
  }
  return change;
}

Changes.prototype.doChanges = function (opts) {
  var self = this;
  var callback = opts.complete;

  opts = utils.clone(opts);
  if ('live' in opts && !('continuous' in opts)) {
    opts.continuous = opts.live;
  }
  opts.processChange = processChange;

  if (opts.since === 'latest') {
    opts.since = 'now';
  }
  if (!opts.since) {
    opts.since = 0;
  }
  if (opts.since === 'now') {
    this.db.info().then(function (info) {
      if (self.isCancelled) {
        callback(null, {status: 'cancelled'});
        return;
      }
      opts.since = info.update_seq;
      self.doChanges(opts);
    }, callback);
    return;
  }

  if (opts.continuous && opts.since !== 'now') {
    this.db.info().then(function (info) {
      self.startSeq = info.update_seq;
    }, function (err) {
      if (err.id === 'idbNull') {
        //db closed before this returned
        //thats ok
        return;
      }
      throw err;
    });
  }

  if (this.db.type() !== 'http' &&
      opts.filter && typeof opts.filter === 'string' &&
      !opts.doc_ids) {
    return this.filterChanges(opts);
  }

  if (!('descending' in opts)) {
    opts.descending = false;
  }

  // 0 and 1 should return 1 document
  opts.limit = opts.limit === 0 ? 1 : opts.limit;
  opts.complete = callback;
  var newPromise = this.db._changes(opts);
  if (newPromise && typeof newPromise.cancel === 'function') {
    var cancel = self.cancel;
    self.cancel = utils.getArguments(function (args) {
      newPromise.cancel();
      cancel.apply(this, args);
    });
  }
};

Changes.prototype.filterChanges = function (opts) {
  var self = this;
  var callback = opts.complete;
  if (opts.filter === '_view') {
    if (!opts.view || typeof opts.view !== 'string') {
      var err = errors.error(errors.BAD_REQUEST,
                             '`view` filter parameter is not provided.');
      callback(err);
      return;
    }
    // fetch a view from a design doc, make it behave like a filter
    var viewName = opts.view.split('/');
    this.db.get('_design/' + viewName[0], function (err, ddoc) {
      if (self.isCancelled) {
        callback(null, {status: 'cancelled'});
        return;
      }
      if (err) {
        callback(errors.generateErrorFromResponse(err));
        return;
      }
      if (ddoc && ddoc.views && ddoc.views[viewName[1]]) {
        
        var filter = evalView(ddoc.views[viewName[1]].map);
        opts.filter = filter;
        self.doChanges(opts);
        return;
      }
      var msg = ddoc.views ? 'missing json key: ' + viewName[1] :
        'missing json key: views';
      if (!err) {
        err = errors.error(errors.MISSING_DOC, msg);
      }
      callback(err);
      return;
    });
  } else {
    // fetch a filter from a design doc
    var filterName = opts.filter.split('/');
    this.db.get('_design/' + filterName[0], function (err, ddoc) {
      if (self.isCancelled) {
        callback(null, {status: 'cancelled'});
        return;
      }
      if (err) {
        callback(errors.generateErrorFromResponse(err));
        return;
      }
      if (ddoc && ddoc.filters && ddoc.filters[filterName[1]]) {
        var filter = evalFilter(ddoc.filters[filterName[1]]);
        opts.filter = filter;
        self.doChanges(opts);
        return;
      } else {
        var msg = (ddoc && ddoc.filters) ? 'missing json key: ' + filterName[1]
          : 'missing json key: filters';
        if (!err) {
          err = errors.error(errors.MISSING_DOC, msg);
        }
        callback(err);
        return;
      }
    });
  }
};
},{"./deps/errors":24,"./evalFilter":32,"./evalView":33,"./merge":35,"./utils":40,"events":79}],19:[function(require,module,exports){
'use strict';

var utils = require('./utils');
var pouchCollate = require('pouchdb-collate');
var collate = pouchCollate.collate;

function updateCheckpoint(db, id, checkpoint, returnValue) {
  return db.get(id)["catch"](function (err) {
    if (err.status === 404) {
      if (db.type() === 'http') {
        utils.explain404(
          'PouchDB is just checking if a remote checkpoint exists.');
      }
      return {_id: id};
    }
    throw err;
  }).then(function (doc) {
    if (returnValue.cancelled) {
      return;
    }
    doc.last_seq = checkpoint;
    return db.put(doc)["catch"](function (err) {
      if (err.status === 409) {
        // retry; someone is trying to write a checkpoint simultaneously
        return updateCheckpoint(db, id, checkpoint, returnValue);
      }
      throw err;
    });
  });
}

function Checkpointer(src, target, id, returnValue) {
  this.src = src;
  this.target = target;
  this.id = id;
  this.returnValue = returnValue;
}

Checkpointer.prototype.writeCheckpoint = function (checkpoint) {
  var self = this;
  return this.updateTarget(checkpoint).then(function () {
    return self.updateSource(checkpoint);
  });
};

Checkpointer.prototype.updateTarget = function (checkpoint) {
  return updateCheckpoint(this.target, this.id, checkpoint, this.returnValue);
};

Checkpointer.prototype.updateSource = function (checkpoint) {
  var self = this;
  if (this.readOnlySource) {
    return utils.Promise.resolve(true);
  }
  return updateCheckpoint(this.src, this.id, checkpoint, this.returnValue)[
    "catch"](function (err) {
      var isForbidden = typeof err.status === 'number' &&
        Math.floor(err.status / 100) === 4;
      if (isForbidden) {
        self.readOnlySource = true;
        return true;
      }
      throw err;
    });
};

Checkpointer.prototype.getCheckpoint = function () {
  var self = this;
  return self.target.get(self.id).then(function (targetDoc) {
    return self.src.get(self.id).then(function (sourceDoc) {
      if (collate(targetDoc.last_seq, sourceDoc.last_seq) === 0) {
        return sourceDoc.last_seq;
      }
      return 0;
    }, function (err) {
      if (err.status === 404 && targetDoc.last_seq) {
        return self.src.put({
          _id: self.id,
          last_seq: 0
        }).then(function () {
          return 0;
        }, function (err) {
          if (err.status === 401) {
            self.readOnlySource = true;
            return targetDoc.last_seq;
          }
          return 0;
        });
      }
      throw err;
    });
  })["catch"](function (err) {
    if (err.status !== 404) {
      throw err;
    }
    return 0;
  });
};

module.exports = Checkpointer;

},{"./utils":40,"pouchdb-collate":65}],20:[function(require,module,exports){
(function (process,global){
/*globals cordova */
"use strict";

var Adapter = require('./adapter');
var utils = require('./utils');
var TaskQueue = require('./taskqueue');
var Promise = utils.Promise;

function defaultCallback(err) {
  if (err && global.debug) {
    console.error(err);
  }
}

utils.inherits(PouchDB, Adapter);
function PouchDB(name, opts, callback) {

  if (!(this instanceof PouchDB)) {
    return new PouchDB(name, opts, callback);
  }
  var self = this;
  if (typeof opts === 'function' || typeof opts === 'undefined') {
    callback = opts;
    opts = {};
  }

  if (name && typeof name === 'object') {
    opts = name;
    name = undefined;
  }
  if (typeof callback === 'undefined') {
    callback = defaultCallback;
  }
  opts = opts || {};
  this.__opts = opts;
  var oldCB = callback;
  self.auto_compaction = opts.auto_compaction;
  self.prefix = PouchDB.prefix;
  Adapter.call(self);
  self.taskqueue = new TaskQueue();
  var promise = new Promise(function (fulfill, reject) {
    callback = function (err, resp) {
      if (err) {
        return reject(err);
      }
      delete resp.then;
      fulfill(resp);
    };
  
    opts = utils.clone(opts);
    var originalName = opts.name || name;
    var backend, error;
    (function () {
      try {

        if (typeof originalName !== 'string') {
          error = new Error('Missing/invalid DB name');
          error.code = 400;
          throw error;
        }

        backend = PouchDB.parseAdapter(originalName, opts);
        
        opts.originalName = originalName;
        opts.name = backend.name;
        if (opts.prefix && backend.adapter !== 'http' &&
            backend.adapter !== 'https') {
          opts.name = opts.prefix + opts.name;
        }
        opts.adapter = opts.adapter || backend.adapter;
        self._adapter = opts.adapter;
        self._db_name = originalName;
        if (!PouchDB.adapters[opts.adapter]) {
          error = new Error('Adapter is missing');
          error.code = 404;
          throw error;
        }

        if (!PouchDB.adapters[opts.adapter].valid()) {
          error = new Error('Invalid Adapter');
          error.code = 404;
          throw error;
        }
      } catch (err) {
        self.taskqueue.fail(err);
        self.changes = utils.toPromise(function (opts) {
          if (opts.complete) {
            opts.complete(err);
          }
        });
      }
    }());
    if (error) {
      return reject(error); // constructor error, see above
    }
    self.adapter = opts.adapter;

    // needs access to PouchDB;
    self.replicate = {};

    self.replicate.from = function (url, opts, callback) {
      return self.constructor.replicate(url, self, opts, callback);
    };

    self.replicate.to = function (url, opts, callback) {
      return self.constructor.replicate(self, url, opts, callback);
    };

    self.sync = function (dbName, opts, callback) {
      return self.constructor.sync(self, dbName, opts, callback);
    };

    self.replicate.sync = self.sync;

    self.destroy = utils.adapterFun('destroy', function (callback) {
      var self = this;
      var opts = this.__opts || {};
      self.info(function (err, info) {
        if (err) {
          return callback(err);
        }
        opts.internal = true;
        self.constructor.destroy(info.db_name, opts, callback);
      });
    });

    PouchDB.adapters[opts.adapter].call(self, opts, function (err) {
      if (err) {
        if (callback) {
          self.taskqueue.fail(err);
          callback(err);
        }
        return;
      }
      function destructionListener(event) {
        if (event === 'destroyed') {
          self.emit('destroyed');
          PouchDB.removeListener(originalName, destructionListener);
        }
      }
      PouchDB.on(originalName, destructionListener);
      self.emit('created', self);
      PouchDB.emit('created', opts.originalName);
      self.taskqueue.ready(self);
      callback(null, self);
    });

    if (opts.skipSetup) {
      self.taskqueue.ready(self);
      process.nextTick(function () {
        callback(null, self);
      });
    }

    if (utils.isCordova()) {
      //to inform websql adapter that we can use api
      cordova.fireWindowEvent(opts.name + "_pouch", {});
    }
  });
  promise.then(function (resp) {
    oldCB(null, resp);
  }, oldCB);
  self.then = promise.then.bind(promise);
  self["catch"] = promise["catch"].bind(promise);
}

PouchDB.debug = require('debug');

module.exports = PouchDB;

}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"./adapter":5,"./taskqueue":39,"./utils":40,"_process":80,"debug":43}],21:[function(require,module,exports){
(function (process){
"use strict";

var request = require('request');

var buffer = require('./buffer');
var errors = require('./errors');
var utils = require('../utils');

function ajax(options, adapterCallback) {

  var requestCompleted = false;
  var callback = utils.getArguments(function (args) {
    if (requestCompleted) {
      return;
    }
    adapterCallback.apply(this, args);
    requestCompleted = true;
  });

  if (typeof options === "function") {
    callback = options;
    options = {};
  }

  options = utils.clone(options);

  var defaultOptions = {
    method : "GET",
    headers: {},
    json: true,
    processData: true,
    timeout: 10000,
    cache: false
  };

  options = utils.extend(true, defaultOptions, options);


  function onSuccess(obj, resp, cb) {
    if (!options.binary && !options.json && options.processData &&
      typeof obj !== 'string') {
      obj = JSON.stringify(obj);
    } else if (!options.binary && options.json && typeof obj === 'string') {
      try {
        obj = JSON.parse(obj);
      } catch (e) {
        // Probably a malformed JSON from server
        return cb(e);
      }
    }
    if (Array.isArray(obj)) {
      obj = obj.map(function (v) {
        if (v.error || v.missing) {
          return errors.generateErrorFromResponse(v);
        } else {
          return v;
        }
      });
    }
    cb(null, obj, resp);
  }

  function onError(err, cb) {
    var errParsed, errObj;
    if (err.code && err.status) {
      var err2 = new Error(err.message || err.code);
      err2.status = err.status;
      return cb(err2);
    }
    try {
      errParsed = JSON.parse(err.responseText);
      //would prefer not to have a try/catch clause
      errObj = errors.generateErrorFromResponse(errParsed);
    } catch (e) {
      errObj = errors.generateErrorFromResponse(err);
    }
    cb(errObj);
  }


  if (options.json) {
    if (!options.binary) {
      options.headers.Accept = 'application/json';
    }
    options.headers['Content-Type'] = options.headers['Content-Type'] ||
      'application/json';
  }

  if (options.binary) {
    options.encoding = null;
    options.json = false;
  }

  if (!options.processData) {
    options.json = false;
  }

  function defaultBody(data) {
    if (process.browser) {
      return '';
    }
    return new buffer('', 'binary');
  }

  return request(options, function (err, response, body) {
    if (err) {
      err.status = response ? response.statusCode : 400;
      return onError(err, callback);
    }

    var error;
    var content_type = response.headers && response.headers['content-type'];
    var data = body || defaultBody();

    // CouchDB doesn't always return the right content-type for JSON data, so
    // we check for ^{ and }$ (ignoring leading/trailing whitespace)
    if (!options.binary && (options.json || !options.processData) &&
        typeof data !== 'object' &&
        (/json/.test(content_type) ||
         (/^[\s]*\{/.test(data) && /\}[\s]*$/.test(data)))) {
      data = JSON.parse(data);
    }

    if (response.statusCode >= 200 && response.statusCode < 300) {
      onSuccess(data, response, callback);
    } else {
      if (options.binary) {
        data = JSON.parse(data.toString());
      }
      error = errors.generateErrorFromResponse(data);
      error.status = response.statusCode;
      callback(error);
    }
  });
}

module.exports = ajax;

}).call(this,require('_process'))

},{"../utils":40,"./buffer":23,"./errors":24,"_process":80,"request":29}],22:[function(require,module,exports){
(function (global){
"use strict";

//Abstracts constructing a Blob object, so it also works in older
//browsers that don't support the native Blob constructor. (i.e.
//old QtWebKit versions, at least).
function createBlob(parts, properties) {
  parts = parts || [];
  properties = properties || {};
  try {
    return new Blob(parts, properties);
  } catch (e) {
    if (e.name !== "TypeError") {
      throw e;
    }
    var BlobBuilder = global.BlobBuilder ||
                      global.MSBlobBuilder ||
                      global.MozBlobBuilder ||
                      global.WebKitBlobBuilder;
    var builder = new BlobBuilder();
    for (var i = 0; i < parts.length; i += 1) {
      builder.append(parts[i]);
    }
    return builder.getBlob(properties.type);
  }
}

module.exports = createBlob;


}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}],23:[function(require,module,exports){
// hey guess what, we don't need this in the browser
module.exports = {};
},{}],24:[function(require,module,exports){
"use strict";

var inherits = require('inherits');
inherits(PouchError, Error);

function PouchError(opts) {
  Error.call(opts.reason);
  this.status = opts.status;
  this.name = opts.error;
  this.message = opts.reason;
  this.error = true;
}

PouchError.prototype.toString = function () {
  return JSON.stringify({
    status: this.status,
    name: this.name,
    message: this.message
  });
};

exports.UNAUTHORIZED = new PouchError({
  status: 401,
  error: 'unauthorized',
  reason: "Name or password is incorrect."
});

exports.MISSING_BULK_DOCS = new PouchError({
  status: 400,
  error: 'bad_request',
  reason: "Missing JSON list of 'docs'"
});

exports.MISSING_DOC = new PouchError({
  status: 404,
  error: 'not_found',
  reason: 'missing'
});

exports.REV_CONFLICT = new PouchError({
  status: 409,
  error: 'conflict',
  reason: 'Document update conflict'
});

exports.INVALID_ID = new PouchError({
  status: 400,
  error: 'invalid_id',
  reason: '_id field must contain a string'
});

exports.MISSING_ID = new PouchError({
  status: 412,
  error: 'missing_id',
  reason: '_id is required for puts'
});

exports.RESERVED_ID = new PouchError({
  status: 400,
  error: 'bad_request',
  reason: 'Only reserved document ids may start with underscore.'
});

exports.NOT_OPEN = new PouchError({
  status: 412,
  error: 'precondition_failed',
  reason: 'Database not open'
});

exports.UNKNOWN_ERROR = new PouchError({
  status: 500,
  error: 'unknown_error',
  reason: 'Database encountered an unknown error'
});

exports.BAD_ARG = new PouchError({
  status: 500,
  error: 'badarg',
  reason: 'Some query argument is invalid'
});

exports.INVALID_REQUEST = new PouchError({
  status: 400,
  error: 'invalid_request',
  reason: 'Request was invalid'
});

exports.QUERY_PARSE_ERROR = new PouchError({
  status: 400,
  error: 'query_parse_error',
  reason: 'Some query parameter is invalid'
});

exports.DOC_VALIDATION = new PouchError({
  status: 500,
  error: 'doc_validation',
  reason: 'Bad special document member'
});

exports.BAD_REQUEST = new PouchError({
  status: 400,
  error: 'bad_request',
  reason: 'Something wrong with the request'
});

exports.NOT_AN_OBJECT = new PouchError({
  status: 400,
  error: 'bad_request',
  reason: 'Document must be a JSON object'
});

exports.DB_MISSING = new PouchError({
  status: 404,
  error: 'not_found',
  reason: 'Database not found'
});

exports.IDB_ERROR = new PouchError({
  status: 500,
  error: 'indexed_db_went_bad',
  reason: 'unknown'
});

exports.WSQ_ERROR = new PouchError({
  status: 500,
  error: 'web_sql_went_bad',
  reason: 'unknown'
});

exports.LDB_ERROR = new PouchError({
  status: 500,
  error: 'levelDB_went_went_bad',
  reason: 'unknown'
});

exports.FORBIDDEN = new PouchError({
  status: 403,
  error: 'forbidden',
  reason: 'Forbidden by design doc validate_doc_update function'
});

exports.INVALID_REV = new PouchError({
  status: 400,
  error: 'bad_request',
  reason: 'Invalid rev format'
});

exports.FILE_EXISTS = new PouchError({
  status: 412,
  error: 'file_exists',
  reason: 'The database could not be created, the file already exists.'
});

exports.MISSING_STUB = new PouchError({
  status: 412,
  error: 'missing_stub'
});

exports.error = function (error, reason, name) {
  function CustomPouchError(reason) {
    // inherit error properties from our parent error manually
    // so as to allow proper JSON parsing.
    /* jshint ignore:start */
    for (var p in error) {
      if (typeof error[p] !== 'function') {
        this[p] = error[p];
      }
    }
    /* jshint ignore:end */
    if (name !== undefined) {
      this.name = name;
    }
    if (reason !== undefined) {
      this.reason = reason;
    }
  }
  CustomPouchError.prototype = PouchError.prototype;
  return new CustomPouchError(reason);
};

// Find one of the errors defined above based on the value
// of the specified property.
// If reason is provided prefer the error matching that reason.
// This is for differentiating between errors with the same name and status,
// eg, bad_request.
exports.getErrorTypeByProp = function (prop, value, reason) {
  var errors = exports;
  var keys = Object.keys(errors).filter(function (key) {
    var error = errors[key];
    return typeof error !== 'function' && error[prop] === value;
  });
  var key = reason && keys.filter(function (key) {
        var error = errors[key];
        return error.message === reason;
      })[0] || keys[0];
  return (key) ? errors[key] : null;
};

exports.generateErrorFromResponse = function (res) {
  var error, errName, errType, errMsg, errReason;
  var errors = exports;

  errName = (res.error === true && typeof res.name === 'string') ?
              res.name :
              res.error;
  errReason = res.reason;
  errType = errors.getErrorTypeByProp('name', errName, errReason);

  if (res.missing ||
      errReason === 'missing' ||
      errReason === 'deleted' ||
      errName === 'not_found') {
    errType = errors.MISSING_DOC;
  } else if (errName === 'doc_validation') {
    // doc validation needs special treatment since
    // res.reason depends on the validation error.
    // see utils.js
    errType = errors.DOC_VALIDATION;
    errMsg = errReason;
  } else if (errName === 'bad_request' && errType.message !== errReason) {
    // if bad_request error already found based on reason don't override.

    // attachment errors.
    if (errReason.indexOf('unknown stub attachment') === 0) {
      errType = errors.MISSING_STUB;
      errMsg = errReason;
    } else {
      errType = errors.BAD_REQUEST;
    }
  }

  // fallback to error by statys or unknown error.
  if (!errType) {
    errType = errors.getErrorTypeByProp('status', res.status, errReason) ||
                errors.UNKNOWN_ERROR;
  }

  error = errors.error(errType, errReason, errName);

  // Keep custom message.
  if (errMsg) {
    error.message = errMsg;
  }

  // Keep helpful response data in our error messages.
  if (res.id) {
    error.id = res.id;
  }
  if (res.status) {
    error.status = res.status;
  }
  if (res.statusText) {
    error.name = res.statusText;
  }
  if (res.missing) {
    error.missing = res.missing;
  }

  return error;
};

},{"inherits":46}],25:[function(require,module,exports){
(function (process,global){
'use strict';

var crypto = require('crypto');
var Md5 = require('spark-md5');
var setImmediateShim = global.setImmediate || global.setTimeout;
var MD5_CHUNK_SIZE = 32768;

// convert a 64-bit int to a binary string
function intToString(int) {
  var bytes = [
    (int & 0xff),
    ((int >>> 8) & 0xff),
    ((int >>> 16) & 0xff),
    ((int >>> 24) & 0xff)
  ];
  return bytes.map(function (byte) {
    return String.fromCharCode(byte);
  }).join('');
}

// convert an array of 64-bit ints into
// a base64-encoded string
function rawToBase64(raw) {
  var res = '';
  for (var i = 0; i < raw.length; i++) {
    res += intToString(raw[i]);
  }
  return btoa(res);
}

function appendBuffer(buffer, data, start, end) {
  if (start > 0 || end < data.byteLength) {
    // only create a subarray if we really need to
    data = new Uint8Array(data, start,
      Math.min(end, data.byteLength) - start);
  }
  buffer.append(data);
}

function appendString(buffer, data, start, end) {
  if (start > 0 || end < data.length) {
    // only create a substring if we really need to
    data = data.substring(start, end);
  }
  buffer.appendBinary(data);
}

module.exports = function (data, callback) {
  if (!process.browser) {
    var base64 = crypto.createHash('md5').update(data).digest('base64');
    callback(null, base64);
    return;
  }
  var inputIsString = typeof data === 'string';
  var len = inputIsString ? data.length : data.byteLength;
  var chunkSize = Math.min(MD5_CHUNK_SIZE, len);
  var chunks = Math.ceil(len / chunkSize);
  var currentChunk = 0;
  var buffer = inputIsString ? new Md5() : new Md5.ArrayBuffer();

  var append = inputIsString ? appendString : appendBuffer;

  function loadNextChunk() {
    var start = currentChunk * chunkSize;
    var end = start + chunkSize;
    currentChunk++;
    if (currentChunk < chunks) {
      append(buffer, data, start, end);
      setImmediateShim(loadNextChunk);
    } else {
      append(buffer, data, start, end);
      var raw = buffer.end(true);
      var base64 = rawToBase64(raw);
      callback(null, base64);
      buffer.destroy();
    }
  }
  loadNextChunk();
};

}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"_process":80,"crypto":78,"spark-md5":76}],26:[function(require,module,exports){
'use strict';

var errors = require('./errors');
var uuid = require('./uuid');

function toObject(array) {
  return array.reduce(function (obj, item) {
    obj[item] = true;
    return obj;
  }, {});
}
// List of top level reserved words for doc
var reservedWords = toObject([
  '_id',
  '_rev',
  '_attachments',
  '_deleted',
  '_revisions',
  '_revs_info',
  '_conflicts',
  '_deleted_conflicts',
  '_local_seq',
  '_rev_tree',
  //replication documents
  '_replication_id',
  '_replication_state',
  '_replication_state_time',
  '_replication_state_reason',
  '_replication_stats',
  // Specific to Couchbase Sync Gateway
  '_removed'
]);

// List of reserved words that should end up the document
var dataWords = toObject([
  '_attachments',
  //replication documents
  '_replication_id',
  '_replication_state',
  '_replication_state_time',
  '_replication_state_reason',
  '_replication_stats'
]);

// Determine id an ID is valid
//   - invalid IDs begin with an underescore that does not begin '_design' or
//     '_local'
//   - any other string value is a valid id
// Returns the specific error object for each case
exports.invalidIdError = function (id) {
  var err;
  if (!id) {
    err = errors.error(errors.MISSING_ID);
  } else if (typeof id !== 'string') {
    err = errors.error(errors.INVALID_ID);
  } else if (/^_/.test(id) && !(/^_(design|local)/).test(id)) {
    err = errors.error(errors.RESERVED_ID);
  }
  if (err) {
    throw err;
  }
};

function parseRevisionInfo(rev) {
  if (!/^\d+\-./.test(rev)) {
    return errors.error(errors.INVALID_REV);
  }
  var idx = rev.indexOf('-');
  var left = rev.substring(0, idx);
  var right = rev.substring(idx + 1);
  return {
    prefix: parseInt(left, 10),
    id: right
  };
}

function makeRevTreeFromRevisions(revisions, opts) {
  var pos = revisions.start - revisions.ids.length + 1;

  var revisionIds = revisions.ids;
  var ids = [revisionIds[0], opts, []];

  for (var i = 1, len = revisionIds.length; i < len; i++) {
    ids = [revisionIds[i], {status: 'missing'}, [ids]];
  }

  return [{
    pos: pos,
    ids: ids
  }];
}

// Preprocess documents, parse their revisions, assign an id and a
// revision for new writes that are missing them, etc
exports.parseDoc = function (doc, newEdits) {

  var nRevNum;
  var newRevId;
  var revInfo;
  var opts = {status: 'available'};
  if (doc._deleted) {
    opts.deleted = true;
  }

  if (newEdits) {
    if (!doc._id) {
      doc._id = uuid();
    }
    newRevId = uuid(32, 16).toLowerCase();
    if (doc._rev) {
      revInfo = parseRevisionInfo(doc._rev);
      if (revInfo.error) {
        return revInfo;
      }
      doc._rev_tree = [{
        pos: revInfo.prefix,
        ids: [revInfo.id, {status: 'missing'}, [[newRevId, opts, []]]]
      }];
      nRevNum = revInfo.prefix + 1;
    } else {
      doc._rev_tree = [{
        pos: 1,
        ids : [newRevId, opts, []]
      }];
      nRevNum = 1;
    }
  } else {
    if (doc._revisions) {
      doc._rev_tree = makeRevTreeFromRevisions(doc._revisions, opts);
      nRevNum = doc._revisions.start;
      newRevId = doc._revisions.ids[0];
    }
    if (!doc._rev_tree) {
      revInfo = parseRevisionInfo(doc._rev);
      if (revInfo.error) {
        return revInfo;
      }
      nRevNum = revInfo.prefix;
      newRevId = revInfo.id;
      doc._rev_tree = [{
        pos: nRevNum,
        ids: [newRevId, opts, []]
      }];
    }
  }

  exports.invalidIdError(doc._id);

  doc._rev = nRevNum + '-' + newRevId;

  var result = {metadata : {}, data : {}};
  for (var key in doc) {
    if (doc.hasOwnProperty(key)) {
      var specialKey = key[0] === '_';
      if (specialKey && !reservedWords[key]) {
        var error = errors.error(errors.DOC_VALIDATION, key);
        error.message = errors.DOC_VALIDATION.message + ': ' + key;
        throw error;
      } else if (specialKey && !dataWords[key]) {
        result.metadata[key.slice(1)] = doc[key];
      } else {
        result.data[key] = doc[key];
      }
    }
  }
  return result;
};
},{"./errors":24,"./uuid":31}],27:[function(require,module,exports){
'use strict';

//
// Parsing hex strings. Yeah.
//
// So basically we need this because of a bug in WebSQL:
// https://code.google.com/p/chromium/issues/detail?id=422690
// https://bugs.webkit.org/show_bug.cgi?id=137637
//
// UTF-8 and UTF-16 are provided as separate functions
// for meager performance improvements
//

function decodeUtf8(str) {
  return decodeURIComponent(window.escape(str));
}

function hexToInt(charCode) {
  // '0'-'9' is 48-57
  // 'A'-'F' is 65-70
  // SQLite will only give us uppercase hex
  return charCode < 65 ? (charCode - 48) : (charCode - 55);
}


// Example:
// pragma encoding=utf8;
// select hex('A');
// returns '41'
function parseHexUtf8(str, start, end) {
  var result = '';
  while (start < end) {
    result += String.fromCharCode(
      (hexToInt(str.charCodeAt(start++)) << 4) |
        hexToInt(str.charCodeAt(start++)));
  }
  return result;
}

// Example:
// pragma encoding=utf16;
// select hex('A');
// returns '4100'
// notice that the 00 comes after the 41 (i.e. it's swizzled)
function parseHexUtf16(str, start, end) {
  var result = '';
  while (start < end) {
    // UTF-16, so swizzle the bytes
    result += String.fromCharCode(
      (hexToInt(str.charCodeAt(start + 2)) << 12) |
        (hexToInt(str.charCodeAt(start + 3)) << 8) |
        (hexToInt(str.charCodeAt(start)) << 4) |
        hexToInt(str.charCodeAt(start + 1)));
    start += 4;
  }
  return result;
}

function parseHexString(str, encoding) {
  if (encoding === 'UTF-8') {
    return decodeUtf8(parseHexUtf8(str, 0, str.length));
  } else {
    return parseHexUtf16(str, 0, str.length);
  }
}

module.exports = parseHexString;
},{}],28:[function(require,module,exports){
'use strict';

// originally parseUri 1.2.2, now patched by us
// (c) Steven Levithan <stevenlevithan.com>
// MIT License
var options = {
  strictMode: false,
  key: ["source", "protocol", "authority", "userInfo", "user", "password",
    "host", "port", "relative", "path", "directory", "file", "query",
    "anchor"],
  q:   {
    name:   "queryKey",
    parser: /(?:^|&)([^&=]*)=?([^&]*)/g
  },
  parser: {
    /* jshint maxlen: false */
    strict: /^(?:([^:\/?#]+):)?(?:\/\/((?:(([^:@]*)(?::([^:@]*))?)?@)?([^:\/?#]*)(?::(\d*))?))?((((?:[^?#\/]*\/)*)([^?#]*))(?:\?([^#]*))?(?:#(.*))?)/,
    loose:  /^(?:(?![^:@]+:[^:@\/]*@)([^:\/?#.]+):)?(?:\/\/)?((?:(([^:@]*)(?::([^:@]*))?)?@)?([^:\/?#]*)(?::(\d*))?)(((\/(?:[^?#](?![^?#\/]*\.[^?#\/.]+(?:[?#]|$)))*\/?)?([^?#\/]*))(?:\?([^#]*))?(?:#(.*))?)/
  }
};
function parseUri(str) {
  var o = options;
  var m = o.parser[o.strictMode ? "strict" : "loose"].exec(str);
  var uri = {};
  var i = 14;

  while (i--) {
    var key = o.key[i];
    var value = m[i] || "";
    var encoded = ['user', 'password'].indexOf(key) !== -1;
    uri[key] = encoded ? decodeURIComponent(value) : value;
  }

  uri[o.q.name] = {};
  uri[o.key[12]].replace(o.q.parser, function ($0, $1, $2) {
    if ($1) {
      uri[o.q.name][$1] = $2;
    }
  });

  return uri;
}


module.exports = parseUri;
},{}],29:[function(require,module,exports){
'use strict';

var createBlob = require('./blob.js');
var utils = require('../utils');

module.exports = function(options, callback) {

  var xhr, timer, hasUpload;

  var abortReq = function () {
    xhr.abort();
  };

  if (options.xhr) {
    xhr = new options.xhr();
  } else {
    xhr = new XMLHttpRequest();
  }

  // cache-buster, specifically designed to work around IE's aggressive caching
  // see http://www.dashbay.com/2011/05/internet-explorer-caches-ajax/
  if (options.method === 'GET' && !options.cache) {
    var hasArgs = options.url.indexOf('?') !== -1;
    options.url += (hasArgs ? '&' : '?') + '_nonce=' + Date.now();
  }

  xhr.open(options.method, options.url);
  xhr.withCredentials = true;

  if (options.json) {
    options.headers.Accept = 'application/json';
    options.headers['Content-Type'] = options.headers['Content-Type'] ||
      'application/json';
    if (options.body &&
        options.processData &&
        typeof options.body !== "string") {
      options.body = JSON.stringify(options.body);
    }
  }

  if (options.binary) {
    xhr.responseType = 'arraybuffer';
  }

  if (!('body' in options)) {
    options.body = null;
  }

  for (var key in options.headers) {
    if (options.headers.hasOwnProperty(key)) {
      xhr.setRequestHeader(key, options.headers[key]);
    }
  }

  if (options.timeout > 0) {
    timer = setTimeout(abortReq, options.timeout);
    xhr.onprogress = function () {
      clearTimeout(timer);
      timer = setTimeout(abortReq, options.timeout);
    };
    if (typeof hasUpload === 'undefined') {
      // IE throws an error if you try to access it directly
      hasUpload = Object.keys(xhr).indexOf('upload') !== -1;
    }
    if (hasUpload) { // does not exist in ie9
      xhr.upload.onprogress = xhr.onprogress;
    }
  }

  xhr.onreadystatechange = function () {
    if (xhr.readyState !== 4) {
      return;
    }

    var response = {
      statusCode: xhr.status
    };

    if (xhr.status >= 200 && xhr.status < 300) {
      var data;
      if (options.binary) {
        data = createBlob([xhr.response || ''], {
          type: xhr.getResponseHeader('Content-Type')
        });
      } else {
        data = xhr.responseText;
      }
      callback(null, response, data);
    } else {
      var err = {};
      try {
        err = JSON.parse(xhr.response);
      } catch(e) {}
      callback(err, response);
    }
  };

  if (options.body && (options.body instanceof Blob)) {
    utils.readAsBinaryString(options.body, function (binary) {
      xhr.send(utils.fixBinary(binary));
    });
  } else {
    xhr.send(options.body);
  }

  return {abort: abortReq};
};

},{"../utils":40,"./blob.js":22}],30:[function(require,module,exports){
'use strict';

var upsert = require('pouchdb-upsert').upsert;

module.exports = function (db, doc, diffFun, cb) {
  return upsert.call(db, doc, diffFun, cb);
};

},{"pouchdb-upsert":75}],31:[function(require,module,exports){
"use strict";

// BEGIN Math.uuid.js

/*!
Math.uuid.js (v1.4)
http://www.broofa.com
mailto:robert@broofa.com

Copyright (c) 2010 Robert Kieffer
Dual licensed under the MIT and GPL licenses.
*/

/*
 * Generate a random uuid.
 *
 * USAGE: Math.uuid(length, radix)
 *   length - the desired number of characters
 *   radix  - the number of allowable values for each character.
 *
 * EXAMPLES:
 *   // No arguments  - returns RFC4122, version 4 ID
 *   >>> Math.uuid()
 *   "92329D39-6F5C-4520-ABFC-AAB64544E172"
 *
 *   // One argument - returns ID of the specified length
 *   >>> Math.uuid(15)     // 15 character ID (default base=62)
 *   "VcydxgltxrVZSTV"
 *
 *   // Two arguments - returns ID of the specified length, and radix. 
 *   // (Radix must be <= 62)
 *   >>> Math.uuid(8, 2)  // 8 character ID (base=2)
 *   "01001010"
 *   >>> Math.uuid(8, 10) // 8 character ID (base=10)
 *   "47473046"
 *   >>> Math.uuid(8, 16) // 8 character ID (base=16)
 *   "098F4D35"
 */
var chars = (
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ' +
  'abcdefghijklmnopqrstuvwxyz'
).split('');
function getValue(radix) {
  return 0 | Math.random() * radix;
}
function uuid(len, radix) {
  radix = radix || chars.length;
  var out = '';
  var i = -1;

  if (len) {
    // Compact form
    while (++i < len) {
      out += chars[getValue(radix)];
    }
    return out;
  }
    // rfc4122, version 4 form
    // Fill in random data.  At i==19 set the high bits of clock sequence as
    // per rfc4122, sec. 4.1.5
  while (++i < 36) {
    switch (i) {
      case 8:
      case 13:
      case 18:
      case 23:
        out += '-';
        break;
      case 19:
        out += chars[(getValue(16) & 0x3) | 0x8];
        break;
      default:
        out += chars[getValue(16)];
    }
  }

  return out;
}



module.exports = uuid;


},{}],32:[function(require,module,exports){
'use strict';

module.exports = evalFilter;
function evalFilter(input) {
  /*jshint evil: true */
  return eval([
    '(function () { return ',
    input,
    ' })()'
  ].join(''));
}
},{}],33:[function(require,module,exports){
'use strict';

module.exports = evalView;
function evalView(input) {
  /*jshint evil: true */
  return eval([
    '(function () {',
    '  return function (doc) {',
    '    var emitted = false;',
    '    var emit = function (a, b) {',
    '      emitted = true;',
    '    };',
    '    var view = ' + input + ';',
    '    view(doc);',
    '    if (emitted) {',
    '      return true;',
    '    }',
    '  }',
    '})()'
  ].join('\n'));
}
},{}],34:[function(require,module,exports){
(function (process){
"use strict";

var PouchDB = require('./setup');

module.exports = PouchDB;

PouchDB.ajax = require('./deps/ajax');
PouchDB.utils = require('./utils');
PouchDB.Errors = require('./deps/errors');
PouchDB.replicate = require('./replicate').replicate;
PouchDB.sync = require('./sync');
PouchDB.version = require('./version');
var httpAdapter = require('./adapters/http/http');
PouchDB.adapter('http', httpAdapter);
PouchDB.adapter('https', httpAdapter);

PouchDB.adapter('idb', require('./adapters/idb/idb'));
PouchDB.adapter('websql', require('./adapters/websql/websql'));
PouchDB.plugin(require('pouchdb-mapreduce'));

if (!process.browser) {
  var ldbAdapter = require('./adapters/leveldb/leveldb');
  PouchDB.adapter('ldb', ldbAdapter);
  PouchDB.adapter('leveldb', ldbAdapter);
}

}).call(this,require('_process'))

},{"./adapters/http/http":6,"./adapters/idb/idb":12,"./adapters/leveldb/leveldb":78,"./adapters/websql/websql":17,"./deps/ajax":21,"./deps/errors":24,"./replicate":36,"./setup":37,"./sync":38,"./utils":40,"./version":41,"_process":80,"pouchdb-mapreduce":71}],35:[function(require,module,exports){
'use strict';
var extend = require('pouchdb-extend');


// for a better overview of what this is doing, read:
// https://github.com/apache/couchdb/blob/master/src/couchdb/couch_key_tree.erl
//
// But for a quick intro, CouchDB uses a revision tree to store a documents
// history, A -> B -> C, when a document has conflicts, that is a branch in the
// tree, A -> (B1 | B2 -> C), We store these as a nested array in the format
//
// KeyTree = [Path ... ]
// Path = {pos: position_from_root, ids: Tree}
// Tree = [Key, Opts, [Tree, ...]], in particular single node: [Key, []]

// classic binary search
function binarySearch(arr, item, comparator) {
  var low = 0;
  var high = arr.length;
  var mid;
  while (low < high) {
    mid = (low + high) >>> 1;
    if (comparator(arr[mid], item) < 0) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

// assuming the arr is sorted, insert the item in the proper place
function insertSorted(arr, item, comparator) {
  var idx = binarySearch(arr, item, comparator);
  arr.splice(idx, 0, item);
}

// Turn a path as a flat array into a tree with a single branch
function pathToTree(path) {
  var doc = path.shift();
  var root = [doc.id, doc.opts, []];
  var leaf = root;
  var nleaf;

  while (path.length) {
    doc = path.shift();
    nleaf = [doc.id, doc.opts, []];
    leaf[2].push(nleaf);
    leaf = nleaf;
  }
  return root;
}

// compare the IDs of two trees
function compareTree(a, b) {
  return a[0] < b[0] ? -1 : 1;
}

// Merge two trees together
// The roots of tree1 and tree2 must be the same revision
function mergeTree(in_tree1, in_tree2) {
  var queue = [{tree1: in_tree1, tree2: in_tree2}];
  var conflicts = false;
  while (queue.length > 0) {
    var item = queue.pop();
    var tree1 = item.tree1;
    var tree2 = item.tree2;

    if (tree1[1].status || tree2[1].status) {
      tree1[1].status =
        (tree1[1].status ===  'available' ||
         tree2[1].status === 'available') ? 'available' : 'missing';
    }

    for (var i = 0; i < tree2[2].length; i++) {
      if (!tree1[2][0]) {
        conflicts = 'new_leaf';
        tree1[2][0] = tree2[2][i];
        continue;
      }

      var merged = false;
      for (var j = 0; j < tree1[2].length; j++) {
        if (tree1[2][j][0] === tree2[2][i][0]) {
          queue.push({tree1: tree1[2][j], tree2: tree2[2][i]});
          merged = true;
        }
      }
      if (!merged) {
        conflicts = 'new_branch';
        insertSorted(tree1[2], tree2[2][i], compareTree);
      }
    }
  }
  return {conflicts: conflicts, tree: in_tree1};
}

function doMerge(tree, path, dontExpand) {
  var restree = [];
  var conflicts = false;
  var merged = false;
  var res;

  if (!tree.length) {
    return {tree: [path], conflicts: 'new_leaf'};
  }

  tree.forEach(function (branch) {
    if (branch.pos === path.pos && branch.ids[0] === path.ids[0]) {
      // Paths start at the same position and have the same root, so they need
      // merged
      res = mergeTree(branch.ids, path.ids);
      restree.push({pos: branch.pos, ids: res.tree});
      conflicts = conflicts || res.conflicts;
      merged = true;
    } else if (dontExpand !== true) {
      // The paths start at a different position, take the earliest path and
      // traverse up until it as at the same point from root as the path we
      // want to merge.  If the keys match we return the longer path with the
      // other merged After stemming we dont want to expand the trees

      var t1 = branch.pos < path.pos ? branch : path;
      var t2 = branch.pos < path.pos ? path : branch;
      var diff = t2.pos - t1.pos;

      var candidateParents = [];

      var trees = [];
      trees.push({ids: t1.ids, diff: diff, parent: null, parentIdx: null});
      while (trees.length > 0) {
        var item = trees.pop();
        if (item.diff === 0) {
          if (item.ids[0] === t2.ids[0]) {
            candidateParents.push(item);
          }
          continue;
        }
        if (!item.ids) {
          continue;
        }
        /*jshint loopfunc:true */
        item.ids[2].forEach(function (el, idx) {
          trees.push(
            {ids: el, diff: item.diff - 1, parent: item.ids, parentIdx: idx});
        });
      }

      var el = candidateParents[0];

      if (!el) {
        restree.push(branch);
      } else {
        res = mergeTree(el.ids, t2.ids);
        el.parent[2][el.parentIdx] = res.tree;
        restree.push({pos: t1.pos, ids: t1.ids});
        conflicts = conflicts || res.conflicts;
        merged = true;
      }
    } else {
      restree.push(branch);
    }
  });

  // We didnt find
  if (!merged) {
    restree.push(path);
  }

  restree.sort(function (a, b) {
    return a.pos - b.pos;
  });

  return {
    tree: restree,
    conflicts: conflicts || 'internal_node'
  };
}

// To ensure we dont grow the revision tree infinitely, we stem old revisions
function stem(tree, depth) {
  // First we break out the tree into a complete list of root to leaf paths,
  // we cut off the start of the path and generate a new set of flat trees
  var stemmedPaths = PouchMerge.rootToLeaf(tree).map(function (path) {
    var stemmed = path.ids.slice(-depth);
    return {
      pos: path.pos + (path.ids.length - stemmed.length),
      ids: pathToTree(stemmed)
    };
  });
  // Then we remerge all those flat trees together, ensuring that we dont
  // connect trees that would go beyond the depth limit
  return stemmedPaths.reduce(function (prev, current) {
    return doMerge(prev, current, true).tree;
  }, [stemmedPaths.shift()]);
}

var PouchMerge = {};

PouchMerge.merge = function (tree, path, depth) {
  // Ugh, nicer way to not modify arguments in place?
  tree = extend(true, [], tree);
  path = extend(true, {}, path);
  var newTree = doMerge(tree, path);
  return {
    tree: stem(newTree.tree, depth),
    conflicts: newTree.conflicts
  };
};

// We fetch all leafs of the revision tree, and sort them based on tree length
// and whether they were deleted, undeleted documents with the longest revision
// tree (most edits) win
// The final sort algorithm is slightly documented in a sidebar here:
// http://guide.couchdb.org/draft/conflicts.html
PouchMerge.winningRev = function (metadata) {
  var leafs = [];
  PouchMerge.traverseRevTree(metadata.rev_tree,
                              function (isLeaf, pos, id, something, opts) {
    if (isLeaf) {
      leafs.push({pos: pos, id: id, deleted: !!opts.deleted});
    }
  });
  leafs.sort(function (a, b) {
    if (a.deleted !== b.deleted) {
      return a.deleted > b.deleted ? 1 : -1;
    }
    if (a.pos !== b.pos) {
      return b.pos - a.pos;
    }
    return a.id < b.id ? 1 : -1;
  });

  return leafs[0].pos + '-' + leafs[0].id;
};

// Pretty much all below can be combined into a higher order function to
// traverse revisions
// The return value from the callback will be passed as context to all
// children of that node
PouchMerge.traverseRevTree = function (revs, callback) {
  var toVisit = revs.slice();

  var node;
  while ((node = toVisit.pop())) {
    var pos = node.pos;
    var tree = node.ids;
    var branches = tree[2];
    var newCtx =
      callback(branches.length === 0, pos, tree[0], node.ctx, tree[1]);
    for (var i = 0, len = branches.length; i < len; i++) {
      toVisit.push({pos: pos + 1, ids: branches[i], ctx: newCtx});
    }
  }
};

PouchMerge.collectLeaves = function (revs) {
  var leaves = [];
  PouchMerge.traverseRevTree(revs, function (isLeaf, pos, id, acc, opts) {
    if (isLeaf) {
      leaves.push({rev: pos + "-" + id, pos: pos, opts: opts});
    }
  });
  leaves.sort(function (a, b) {
    return b.pos - a.pos;
  });
  leaves.forEach(function (leaf) { delete leaf.pos; });
  return leaves;
};

// returns revs of all conflicts that is leaves such that
// 1. are not deleted and
// 2. are different than winning revision
PouchMerge.collectConflicts = function (metadata) {
  var win = PouchMerge.winningRev(metadata);
  var leaves = PouchMerge.collectLeaves(metadata.rev_tree);
  var conflicts = [];
  leaves.forEach(function (leaf) {
    if (leaf.rev !== win && !leaf.opts.deleted) {
      conflicts.push(leaf.rev);
    }
  });
  return conflicts;
};

PouchMerge.rootToLeaf = function (tree) {
  var paths = [];
  PouchMerge.traverseRevTree(tree, function (isLeaf, pos, id, history, opts) {
    history = history ? history.slice(0) : [];
    history.push({id: id, opts: opts});
    if (isLeaf) {
      var rootPos = pos + 1 - history.length;
      paths.unshift({pos: rootPos, ids: history});
    }
    return history;
  });
  return paths;
};


module.exports = PouchMerge;

},{"pouchdb-extend":68}],36:[function(require,module,exports){
'use strict';

var utils = require('./utils');
var EE = require('events').EventEmitter;
var Checkpointer = require('./checkpointer');

var MAX_SIMULTANEOUS_REVS = 50;
var RETRY_DEFAULT = false;

function randomNumber(min, max) {
  min = parseInt(min, 10);
  max = parseInt(max, 10);
  if (min !== min) {
    min = 0;
  }
  if (max !== max || max <= min) {
    max = (min || 1) << 1; //doubling
  } else {
    max = max + 1;
  }
  var ratio = Math.random();
  var range = max - min;

  return ~~(range * ratio + min); // ~~ coerces to an int, but fast.
}

function defaultBackOff(min) {
  var max = 0;
  if (!min) {
    max = 2000;
  }
  return randomNumber(min, max);
}

function backOff(repId, src, target, opts, returnValue, result, error) {
  if (opts.retry === false) {
    returnValue.emit('error', error);
    returnValue.removeAllListeners();
    return;
  }
  opts.default_back_off = opts.default_back_off || 0;
  opts.retries = opts.retries || 0;
  if (typeof opts.back_off_function !== 'function') {
    opts.back_off_function = defaultBackOff;
  }
  opts.retries++;
  if (opts.max_retries && opts.retries > opts.max_retries) {
    returnValue.emit('error', new Error('tried ' +
      opts.retries + ' times but replication failed'));
    returnValue.removeAllListeners();
    return;
  }
  returnValue.emit('requestError', error);
  if (returnValue.state === 'active') {
    returnValue.emit('paused', error);
    returnValue.state = 'stopped';
    returnValue.once('active', function () {
      opts.current_back_off = opts.default_back_off;
    });
  }

  opts.current_back_off = opts.current_back_off || opts.default_back_off;
  opts.current_back_off = opts.back_off_function(opts.current_back_off);
  setTimeout(function () {
    replicate(repId, src, target, opts, returnValue);
  }, opts.current_back_off);
}

// We create a basic promise so the caller can cancel the replication possibly
// before we have actually started listening to changes etc
utils.inherits(Replication, EE);
function Replication() {
  EE.call(this);
  this.cancelled = false;
  this.state = 'pending';
  var self = this;
  var promise = new utils.Promise(function (fulfill, reject) {
    self.once('complete', fulfill);
    self.once('error', reject);
  });
  self.then = function (resolve, reject) {
    return promise.then(resolve, reject);
  };
  self["catch"] = function (reject) {
    return promise["catch"](reject);
  };
  // As we allow error handling via "error" event as well,
  // put a stub in here so that rejecting never throws UnhandledError.
  self["catch"](function () {});
}

Replication.prototype.cancel = function () {
  this.cancelled = true;
  this.state = 'cancelled';
  this.emit('cancel');
};

Replication.prototype.ready = function (src, target) {
  var self = this;
  function onDestroy() {
    self.cancel();
  }
  src.once('destroyed', onDestroy);
  target.once('destroyed', onDestroy);
  function cleanup() {
    src.removeListener('destroyed', onDestroy);
    target.removeListener('destroyed', onDestroy);
  }
  this.then(cleanup, cleanup);
};


// TODO: check CouchDB's replication id generation
// Generate a unique id particular to this replication
function genReplicationId(src, target, opts) {
  var filterFun = opts.filter ? opts.filter.toString() : '';
  return src.id().then(function (src_id) {
    return target.id().then(function (target_id) {
      var queryData = src_id + target_id + filterFun +
        JSON.stringify(opts.query_params) + opts.doc_ids;
      return utils.MD5(queryData).then(function (md5) {
        // can't use straight-up md5 alphabet, because
        // the char '/' is interpreted as being for attachments,
        // and + is also not url-safe
        md5 = md5.replace(/\//g, '.').replace(/\+/g, '_');
        return '_local/' + md5;
      });
    });
  });
}

function replicate(repId, src, target, opts, returnValue, result) {
  var batches = [];               // list of batches to be processed
  var currentBatch;               // the batch currently being processed
  var pendingBatch = {
    seq: 0,
    changes: [],
    docs: []
  }; // next batch, not yet ready to be processed
  var writingCheckpoint = false;  // true while checkpoint is being written
  var changesCompleted = false;   // true when all changes received
  var replicationCompleted = false; // true when replication has completed
  var last_seq = 0;
  var continuous = opts.continuous || opts.live || false;
  var batch_size = opts.batch_size || 100;
  var batches_limit = opts.batches_limit || 10;
  var changesPending = false;     // true while src.changes is running
  var doc_ids = opts.doc_ids;
  var state = {
    cancelled: false
  };
  var checkpointer = new Checkpointer(src, target, repId, state);
  var allErrors = [];
  var changedDocs = [];

  result = result || {
    ok: true,
    start_time: new Date(),
    docs_read: 0,
    docs_written: 0,
    doc_write_failures: 0,
    errors: []
  };

  var changesOpts = {};
  returnValue.ready(src, target);

  function writeDocs() {
    if (currentBatch.docs.length === 0) {
      return;
    }
    var docs = currentBatch.docs;
    return target.bulkDocs({docs: docs, new_edits: false}).then(function (res) {
      if (state.cancelled) {
        completeReplication();
        throw new Error('cancelled');
      }
      var errors = [];
      var errorsById = {};
      res.forEach(function (res) {
        if (res.error) {
          result.doc_write_failures++;
          errors.push(res);
          errorsById[res.id] = res;
        }
      });
      result.errors = errors;
      allErrors = allErrors.concat(errors);
      result.docs_written += currentBatch.docs.length - errors.length;
      var non403s = errors.filter(function (error) {
        return error.name !== 'unauthorized' && error.name !== 'forbidden';
      });

      changedDocs = [];
      docs.forEach(function(doc) {
        var error = errorsById[doc._id];
        if (error) {
          returnValue.emit('denied', utils.clone(error));
        } else {
          changedDocs.push(doc);
        }
      });

      if (non403s.length > 0) {
        var error = new Error('bulkDocs error');
        error.other_errors = errors;
        abortReplication('target.bulkDocs failed to write docs', error);
        throw new Error('bulkWrite partial failure');
      }
    }, function (err) {
      result.doc_write_failures += docs.length;
      throw err;
    });
  }

  function processDiffDoc(id) {
    var diffs = currentBatch.diffs;
    var allMissing = diffs[id].missing;
    // avoid url too long error by batching
    var missingBatches = [];
    for (var i = 0; i < allMissing.length; i += MAX_SIMULTANEOUS_REVS) {
      missingBatches.push(allMissing.slice(i, Math.min(allMissing.length,
        i + MAX_SIMULTANEOUS_REVS)));
    }

    return utils.Promise.all(missingBatches.map(function (missing) {
      var opts = {
        revs: true,
        open_revs: missing,
        attachments: true
      };
      return src.get(id, opts).then(function (docs) {
        docs.forEach(function (doc) {
          if (state.cancelled) {
            return completeReplication();
          }
          if (doc.ok) {
            result.docs_read++;
            currentBatch.pendingRevs++;
            currentBatch.docs.push(doc.ok);
          }
        });
        delete diffs[id];
      });
    }));
  }

  function getAllDocs() {
    var diffKeys = Object.keys(currentBatch.diffs);
    return utils.Promise.all(diffKeys.map(processDiffDoc));
  }


  function getRevisionOneDocs() {
    // filter out the generation 1 docs and get them
    // leaving the non-generation one docs to be got otherwise
    var ids = Object.keys(currentBatch.diffs).filter(function (id) {
      var missing = currentBatch.diffs[id].missing;
      return missing.length === 1 && missing[0].slice(0, 2) === '1-';
    });
    if (!ids.length) { // nothing to fetch
      return utils.Promise.resolve();
    }
    return src.allDocs({
      keys: ids,
      include_docs: true
    }).then(function (res) {
      if (state.cancelled) {
        completeReplication();
        throw (new Error('cancelled'));
      }
      res.rows.forEach(function (row) {
        if (row.doc && !row.deleted &&
          row.value.rev.slice(0, 2) === '1-' && (
            !row.doc._attachments ||
            Object.keys(row.doc._attachments).length === 0
          )
        ) {
          result.docs_read++;
          currentBatch.pendingRevs++;
          currentBatch.docs.push(row.doc);
          delete currentBatch.diffs[row.id];
        }
      });
    });
  }

  function getDocs() {
    return getRevisionOneDocs().then(getAllDocs);
  }

  function finishBatch() {
    writingCheckpoint = true;
    return checkpointer.writeCheckpoint(currentBatch.seq).then(function () {
      writingCheckpoint = false;
      if (state.cancelled) {
        completeReplication();
        throw new Error('cancelled');
      }
      result.last_seq = last_seq = currentBatch.seq;
      var outResult = utils.clone(result);
      outResult.docs = changedDocs;
      returnValue.emit('change', outResult);
      currentBatch = undefined;
      getChanges();
    })["catch"](function (err) {
      writingCheckpoint = false;
      abortReplication('writeCheckpoint completed with error', err);
      throw err;
    });
  }

  function getDiffs() {
    var diff = {};
    currentBatch.changes.forEach(function (change) {
      // Couchbase Sync Gateway emits these, but we can ignore them
      if (change.id === "_user/") {
        return;
      }
      diff[change.id] = change.changes.map(function (x) {
        return x.rev;
      });
    });
    return target.revsDiff(diff).then(function (diffs) {
      if (state.cancelled) {
        completeReplication();
        throw new Error('cancelled');
      }
      // currentBatch.diffs elements are deleted as the documents are written
      currentBatch.diffs = diffs;
      currentBatch.pendingRevs = 0;
    });
  }

  function startNextBatch() {
    if (state.cancelled || currentBatch) {
      return;
    }
    if (batches.length === 0) {
      processPendingBatch(true);
      return;
    }
    currentBatch = batches.shift();
    getDiffs()
      .then(getDocs)
      .then(writeDocs)
      .then(finishBatch)
      .then(startNextBatch)[
      "catch"](function (err) {
        abortReplication('batch processing terminated with error', err);
      });
  }


  function processPendingBatch(immediate) {
    if (pendingBatch.changes.length === 0) {
      if (batches.length === 0 && !currentBatch) {
        if ((continuous && changesOpts.live) || changesCompleted) {
          returnValue.state = 'pending';
          returnValue.emit('paused');
          returnValue.emit('uptodate', result);
        }
        if (changesCompleted) {
          completeReplication();
        }
      }
      return;
    }
    if (
      immediate ||
      changesCompleted ||
      pendingBatch.changes.length >= batch_size
    ) {
      batches.push(pendingBatch);
      pendingBatch = {
        seq: 0,
        changes: [],
        docs: []
      };
      if (returnValue.state === 'pending' || returnValue.state === 'stopped') {
        returnValue.state = 'active';
        returnValue.emit('active');
      }
      startNextBatch();
    }
  }


  function abortReplication(reason, err) {
    if (replicationCompleted) {
      return;
    }
    if (!err.message) {
      err.message = reason;
    }
    result.ok = false;
    result.status = 'aborting';
    result.errors.push(err);
    allErrors = allErrors.concat(err);
    batches = [];
    pendingBatch = {
      seq: 0,
      changes: [],
      docs: []
    };
    completeReplication();
  }


  function completeReplication() {
    if (replicationCompleted) {
      return;
    }
    if (state.cancelled) {
      result.status = 'cancelled';
      if (writingCheckpoint) {
        return;
      }
    }
    result.status = result.status || 'complete';
    result.end_time = new Date();
    result.last_seq = last_seq;
    replicationCompleted = state.cancelled = true;
    var non403s = allErrors.filter(function (error) {
      return error.name !== 'unauthorized' && error.name !== 'forbidden';
    });
    if (non403s.length > 0) {
      var error = allErrors.pop();
      if (allErrors.length > 0) {
        error.other_errors = allErrors;
      }
      error.result = result;
      backOff(repId, src, target, opts, returnValue, result, error);
    } else {
      result.errors = allErrors;
      returnValue.emit('complete', result);
      returnValue.removeAllListeners();
    }
  }


  function onChange(change) {
    if (state.cancelled) {
      return completeReplication();
    }
    var filter = utils.filterChange(opts)(change);
    if (!filter) {
      return;
    }
    if (
      pendingBatch.changes.length === 0 &&
      batches.length === 0 &&
      !currentBatch
    ) {
      returnValue.emit('outofdate', result);
    }
    pendingBatch.seq = change.seq;
    pendingBatch.changes.push(change);
    processPendingBatch(batches.length === 0);
  }


  function onChangesComplete(changes) {
    changesPending = false;
    if (state.cancelled) {
      return completeReplication();
    }

    // if no results were returned then we're done,
    // else fetch more
    if (changes.results.length > 0) {
      changesOpts.since = changes.last_seq;
      getChanges();
    } else {
      if (continuous) {
        changesOpts.live = true;
        getChanges();
      } else {
        changesCompleted = true;
      }
    }
    processPendingBatch(true);
  }


  function onChangesError(err) {
    changesPending = false;
    if (state.cancelled) {
      return completeReplication();
    }
    abortReplication('changes rejected', err);
  }


  function getChanges() {
    if (!(
      !changesPending &&
      !changesCompleted &&
      batches.length < batches_limit
    )) {
      return;
    }
    changesPending = true;
    function abortChanges() {
      changes.cancel();
    }
    function removeListener() {
      returnValue.removeListener('cancel', abortChanges);
    }
    returnValue.once('cancel', abortChanges);
    var changes = src.changes(changesOpts)
    .on('change', onChange);
    changes.then(removeListener, removeListener);
    changes.then(onChangesComplete)[
    "catch"](onChangesError);
  }


  function startChanges() {
    checkpointer.getCheckpoint().then(function (checkpoint) {
      last_seq = checkpoint;
      changesOpts = {
        since: last_seq,
        limit: batch_size,
        batch_size: batch_size,
        style: 'all_docs',
        doc_ids: doc_ids,
        returnDocs: true // required so we know when we're done
      };
      if (opts.filter) {
        if (typeof opts.filter !== 'string') {
          // required for the client-side filter in onChange
          changesOpts.include_docs = true;
        } else { // ddoc filter
          changesOpts.filter = opts.filter;
        }
      }
      if (opts.query_params) {
        changesOpts.query_params = opts.query_params;
      }
      if (opts.view) {
        changesOpts.view = opts.view;
      }
      getChanges();
    })["catch"](function (err) {
      abortReplication('getCheckpoint rejected with ', err);
    });
  }

  if (returnValue.cancelled) { // cancelled immediately
    completeReplication();
    return;
  }

  returnValue.once('cancel', completeReplication);

  if (typeof opts.onChange === 'function') {
    returnValue.on('change', opts.onChange);
  }

  if (typeof opts.complete === 'function') {
    returnValue.once('error', opts.complete);
    returnValue.once('complete', function (result) {
      opts.complete(null, result);
    });
  }

  if (typeof opts.since === 'undefined') {
    startChanges();
  } else {
    writingCheckpoint = true;
    checkpointer.writeCheckpoint(opts.since).then(function () {
      writingCheckpoint = false;
      if (state.cancelled) {
        completeReplication();
        return;
      }
      last_seq = opts.since;
      startChanges();
    })["catch"](function (err) {
      writingCheckpoint = false;
      abortReplication('writeCheckpoint completed with error', err);
      throw err;
    });
  }
}

exports.toPouch = toPouch;
function toPouch(db, opts) {
  var PouchConstructor = opts.PouchConstructor;
  if (typeof db === 'string') {
    return new PouchConstructor(db, opts);
  } else if (db.then) {
    return db;
  } else {
    return utils.Promise.resolve(db);
  }
}


exports.replicate = replicateWrapper;
function replicateWrapper(src, target, opts, callback) {
  if (typeof opts === 'function') {
    callback = opts;
    opts = {};
  }
  if (typeof opts === 'undefined') {
    opts = {};
  }
  if (!opts.complete) {
    opts.complete = callback || function () {};
  }
  opts = utils.clone(opts);
  opts.continuous = opts.continuous || opts.live;
  opts.retry = ('retry' in opts) ? opts.retry : RETRY_DEFAULT;
  /*jshint validthis:true */
  opts.PouchConstructor = opts.PouchConstructor || this;
  var replicateRet = new Replication(opts);
  toPouch(src, opts).then(function (src) {
    return toPouch(target, opts).then(function (target) {
      return genReplicationId(src, target, opts).then(function (repId) {
        replicate(repId, src, target, opts, replicateRet);
      });
    });
  })["catch"](function (err) {
    replicateRet.emit('error', err);
    opts.complete(err);
  });
  return replicateRet;
}

},{"./checkpointer":19,"./utils":40,"events":79}],37:[function(require,module,exports){
"use strict";

var PouchDB = require("./constructor");
var utils = require('./utils');
var Promise = utils.Promise;
var EventEmitter = require('events').EventEmitter;
PouchDB.adapters = {};
PouchDB.preferredAdapters = require('./adapters/preferredAdapters.js');

PouchDB.prefix = '_pouch_';

var eventEmitter = new EventEmitter();

var eventEmitterMethods = [
  'on',
  'addListener',
  'emit',
  'listeners',
  'once',
  'removeAllListeners',
  'removeListener',
  'setMaxListeners'
];

eventEmitterMethods.forEach(function (method) {
  PouchDB[method] = eventEmitter[method].bind(eventEmitter);
});
PouchDB.setMaxListeners(0);
PouchDB.parseAdapter = function (name, opts) {
  var match = name.match(/([a-z\-]*):\/\/(.*)/);
  var adapter, adapterName;
  if (match) {
    // the http adapter expects the fully qualified name
    name = /http(s?)/.test(match[1]) ? match[1] + '://' + match[2] : match[2];
    adapter = match[1];
    if (!PouchDB.adapters[adapter].valid()) {
      throw 'Invalid adapter';
    }
    return {name: name, adapter: match[1]};
  }

  // check for browsers that have been upgraded from websql-only to websql+idb
  var skipIdb = 'idb' in PouchDB.adapters && 'websql' in PouchDB.adapters &&
    utils.hasLocalStorage() &&
    localStorage['_pouch__websqldb_' + PouchDB.prefix + name];

  if (typeof opts !== 'undefined' && opts.db) {
    adapterName = 'leveldb';
  } else {
    for (var i = 0; i < PouchDB.preferredAdapters.length; ++i) {
      adapterName = PouchDB.preferredAdapters[i];
      if (adapterName in PouchDB.adapters) {
        if (skipIdb && adapterName === 'idb') {
          continue; // keep using websql to avoid user data loss
        }
        break;
      }
    }
  }

  adapter = PouchDB.adapters[adapterName];
  if (adapterName && adapter) {
    var use_prefix = 'use_prefix' in adapter ? adapter.use_prefix : true;

    return {
      name: use_prefix ? PouchDB.prefix + name : name,
      adapter: adapterName
    };
  }

  throw 'No valid adapter found';
};

PouchDB.destroy = utils.toPromise(function (name, opts, callback) {

  if (typeof opts === 'function' || typeof opts === 'undefined') {
    callback = opts;
    opts = {};
  }
  if (name && typeof name === 'object') {
    opts = name;
    name = undefined;
  }

  if (!opts.internal) {
    console.log('PouchDB.destroy() is deprecated and will be removed. ' +
                'Please use db.destroy() instead.');
  }

  var backend = PouchDB.parseAdapter(opts.name || name, opts);
  var dbName = backend.name;
  var adapter = PouchDB.adapters[backend.adapter];
  var usePrefix = 'use_prefix' in adapter ? adapter.use_prefix : true;
  var baseName = usePrefix ?
    dbName.replace(new RegExp('^' + PouchDB.prefix), '') : dbName;
  var fullName = (backend.adapter === 'http' || backend.adapter === 'https' ?
      '' : (opts.prefix || '')) + dbName;
  function destroyDb() {
    // call destroy method of the particular adaptor
    adapter.destroy(fullName, opts, function (err, resp) {
      if (err) {
        callback(err);
      } else {
        PouchDB.emit('destroyed', name);
        //so we don't have to sift through all dbnames
        PouchDB.emit(name, 'destroyed');
        callback(null, resp || { 'ok': true });
      }
    });
  }

  var createOpts = utils.extend(true, {}, opts, {adapter : backend.adapter});
  new PouchDB(baseName, createOpts, function (err, db) {
    if (err) {
      return callback(err);
    }
    db.get('_local/_pouch_dependentDbs', function (err, localDoc) {
      if (err) {
        if (err.status !== 404) {
          return callback(err);
        } else { // no dependencies
          return destroyDb();
        }
      }
      var dependentDbs = localDoc.dependentDbs;
      var deletedMap = Object.keys(dependentDbs).map(function (name) {
        var trueName = usePrefix ?
          name.replace(new RegExp('^' + PouchDB.prefix), '') : name;
        var subOpts = utils.extend(true, opts, db.__opts || {});
        return db.constructor.destroy(trueName, subOpts);
      });
      Promise.all(deletedMap).then(destroyDb, function (error) {
        callback(error);
      });
    });
  });
});

PouchDB.adapter = function (id, obj) {
  if (obj.valid()) {
    PouchDB.adapters[id] = obj;
  }
};

PouchDB.plugin = function (obj) {
  Object.keys(obj).forEach(function (id) {
    PouchDB.prototype[id] = obj[id];
  });
};

PouchDB.defaults = function (defaultOpts) {
  function PouchAlt(name, opts, callback) {
    if (typeof opts === 'function' || typeof opts === 'undefined') {
      callback = opts;
      opts = {};
    }
    if (name && typeof name === 'object') {
      opts = name;
      name = undefined;
    }

    opts = utils.extend(true, {}, defaultOpts, opts);
    PouchDB.call(this, name, opts, callback);
  }

  utils.inherits(PouchAlt, PouchDB);

  PouchAlt.destroy = utils.toPromise(function (name, opts, callback) {
    if (typeof opts === 'function' || typeof opts === 'undefined') {
      callback = opts;
      opts = {};
    }

    if (name && typeof name === 'object') {
      opts = name;
      name = undefined;
    }
    opts = utils.extend(true, {}, defaultOpts, opts);
    return PouchDB.destroy(name, opts, callback);
  });

  eventEmitterMethods.forEach(function (method) {
    PouchAlt[method] = eventEmitter[method].bind(eventEmitter);
  });
  PouchAlt.setMaxListeners(0);

  PouchAlt.preferredAdapters = PouchDB.preferredAdapters.slice();
  Object.keys(PouchDB).forEach(function (key) {
    if (!(key in PouchAlt)) {
      PouchAlt[key] = PouchDB[key];
    }
  });

  return PouchAlt;
};

module.exports = PouchDB;

},{"./adapters/preferredAdapters.js":13,"./constructor":20,"./utils":40,"events":79}],38:[function(require,module,exports){
'use strict';

var utils = require('./utils');
var replication = require('./replicate');
var replicate = replication.replicate;
var EE = require('events').EventEmitter;

utils.inherits(Sync, EE);
module.exports = sync;
function sync(src, target, opts, callback) {
  if (typeof opts === 'function') {
    callback = opts;
    opts = {};
  }
  if (typeof opts === 'undefined') {
    opts = {};
  }
  opts = utils.clone(opts);
  /*jshint validthis:true */
  opts.PouchConstructor = opts.PouchConstructor || this;
  src = replication.toPouch(src, opts);
  target = replication.toPouch(target, opts);
  return new Sync(src, target, opts, callback);
}

function Sync(src, target, opts, callback) {
  var self = this;
  this.canceled = false;

  var onChange, complete;
  if ('onChange' in opts) {
    onChange = opts.onChange;
    delete opts.onChange;
  }
  if (typeof callback === 'function' && !opts.complete) {
    complete = callback;
  } else if ('complete' in opts) {
    complete = opts.complete;
    delete opts.complete;
  }

  this.push = replicate(src, target, opts);
  this.pull = replicate(target, src, opts);

  var emittedCancel = false;
  function onCancel(data) {
    if (!emittedCancel) {
      emittedCancel = true;
      self.emit('cancel', data);
    }
  }
  function pullChange(change) {
    self.emit('change', {
      direction: 'pull',
      change: change
    });
  }
  function pushChange(change) {
    self.emit('change', {
      direction: 'push',
      change: change
    });
  }
  function pushDenied(doc) {
    self.emit('denied', {
      direction: 'push',
      doc: doc
    });
  }
  function pullDenied(doc) {
    self.emit('denied', {
      direction: 'pull',
      doc: doc
    });
  }

  var listeners = {};
  var removed = {};

  function removeAll(type) { // type is 'push' or 'pull'
    return function (event, func) {
      var isChange = event === 'change' &&
        (func === pullChange || func === pushChange);
      var isCancel = event === 'cancel' && func === onCancel;
      var isOtherEvent = event in listeners && func === listeners[event];

      if (isChange || isCancel || isOtherEvent) {
        if (!(event in removed)) {
          removed[event] = {};
        }
        removed[event][type] = true;
        if (Object.keys(removed[event]).length === 2) {
          // both push and pull have asked to be removed
          self.removeAllListeners(event);
        }
      }
    };
  }

  if (opts.live) {
    this.push.on('complete', self.pull.cancel.bind(self.pull));
    this.pull.on('complete', self.push.cancel.bind(self.push));
  }

  this.on('newListener', function (event) {
    if (event === 'change') {
      self.pull.on('change', pullChange);
      self.push.on('change', pushChange);
    } else if (event === 'denied') {
      self.pull.on('denied', pullDenied);
      self.push.on('denied', pushDenied);
    } else if (event === 'cancel') {
      self.pull.on('cancel', onCancel);
      self.push.on('cancel', onCancel);
    } else if (event !== 'error' &&
      event !== 'removeListener' &&
      event !== 'complete' && !(event in listeners)) {
      listeners[event] = function (e) {
        self.emit(event, e);
      };
      self.pull.on(event, listeners[event]);
      self.push.on(event, listeners[event]);
    }
  });

  this.on('removeListener', function (event) {
    if (event === 'change') {
      self.pull.removeListener('change', pullChange);
      self.push.removeListener('change', pushChange);
    } else if (event === 'cancel') {
      self.pull.removeListener('cancel', onCancel);
      self.push.removeListener('cancel', onCancel);
    } else if (event in listeners) {
      if (typeof listeners[event] === 'function') {
        self.pull.removeListener(event, listeners[event]);
        self.push.removeListener(event, listeners[event]);
        delete listeners[event];
      }
    }
  });

  this.pull.on('removeListener', removeAll('pull'));
  this.push.on('removeListener', removeAll('push'));

  var promise = utils.Promise.all([
    this.push,
    this.pull
  ]).then(function (resp) {
    var out = {
      push: resp[0],
      pull: resp[1]
    };
    self.emit('complete', out);
    if (complete) {
      complete(null, out);
    }
    self.removeAllListeners();
    return out;
  }, function (err) {
    self.cancel();
    self.emit('error', err);
    if (complete) {
      complete(err);
    }
    self.removeAllListeners();
    throw err;
  });

  this.then = function (success, err) {
    return promise.then(success, err);
  };

  this["catch"] = function (err) {
    return promise["catch"](err);
  };
}

Sync.prototype.cancel = function () {
  if (!this.canceled) {
    this.canceled = true;
    this.push.cancel();
    this.pull.cancel();
  }
};

},{"./replicate":36,"./utils":40,"events":79}],39:[function(require,module,exports){
'use strict';

module.exports = TaskQueue;

function TaskQueue() {
  this.isReady = false;
  this.failed = false;
  this.queue = [];
}

TaskQueue.prototype.execute = function () {
  var d, func;
  if (this.failed) {
    while ((d = this.queue.shift())) {
      if (typeof d === 'function') {
        d(this.failed);
        continue;
      }
      func = d.parameters[d.parameters.length - 1];
      if (typeof func === 'function') {
        func(this.failed);
      } else if (d.name === 'changes' && typeof func.complete === 'function') {
        func.complete(this.failed);
      }
    }
  } else if (this.isReady) {
    while ((d = this.queue.shift())) {

      if (typeof d === 'function') {
        d();
      } else {
        d.task = this.db[d.name].apply(this.db, d.parameters);
      }
    }
  }
};

TaskQueue.prototype.fail = function (err) {
  this.failed = err;
  this.execute();
};

TaskQueue.prototype.ready = function (db) {
  if (this.failed) {
    return false;
  } else if (arguments.length === 0) {
    return this.isReady;
  }
  this.isReady = db ? true: false;
  this.db = db;
  this.execute();
};

TaskQueue.prototype.addTask = function (name, parameters) {
  if (typeof name === 'function') {
    this.queue.push(name);
    if (this.failed) {
      this.execute();
    }
  } else {
    var task = { name: name, parameters: parameters };
    this.queue.push(task);
    if (this.failed) {
      this.execute();
    }
    return task;
  }
};

},{}],40:[function(require,module,exports){
(function (process,global){
/*jshint strict: false */
/*global chrome */
var merge = require('./merge');
exports.extend = require('pouchdb-extend');
exports.ajax = require('./deps/ajax');
exports.createBlob = require('./deps/blob');
exports.uuid = require('./deps/uuid');
exports.getArguments = require('argsarray');
var buffer = require('./deps/buffer');
var errors = require('./deps/errors');
var EventEmitter = require('events').EventEmitter;
var collections = require('pouchdb-collections');
exports.Map = collections.Map;
exports.Set = collections.Set;
var parseDoc = require('./deps/parse-doc');

if (typeof global.Promise === 'function') {
  exports.Promise = global.Promise;
} else {
  exports.Promise = require('bluebird');
}
var Promise = exports.Promise;

exports.lastIndexOf = function (str, char) {
  for (var i = str.length - 1; i >= 0; i--) {
    if (str.charAt(i) === char) {
      return i;
    }
  }
  return -1;
};

exports.clone = function (obj) {
  return exports.extend(true, {}, obj);
};

// like underscore/lodash _.pick()
exports.pick = function (obj, arr) {
  var res = {};
  for (var i = 0, len = arr.length; i < len; i++) {
    var prop = arr[i];
    res[prop] = obj[prop];
  }
  return res;
};

exports.inherits = require('inherits');

function isChromeApp() {
  return (typeof chrome !== "undefined" &&
          typeof chrome.storage !== "undefined" &&
          typeof chrome.storage.local !== "undefined");
}

// Pretty dumb name for a function, just wraps callback calls so we dont
// to if (callback) callback() everywhere
exports.call = exports.getArguments(function (args) {
  if (!args.length) {
    return;
  }
  var fun = args.shift();
  if (typeof fun === 'function') {
    fun.apply(this, args);
  }
});

exports.isLocalId = function (id) {
  return (/^_local/).test(id);
};

// check if a specific revision of a doc has been deleted
//  - metadata: the metadata object from the doc store
//  - rev: (optional) the revision to check. defaults to winning revision
exports.isDeleted = function (metadata, rev) {
  if (!rev) {
    rev = merge.winningRev(metadata);
  }
  var dashIndex = rev.indexOf('-');
  if (dashIndex !== -1) {
    rev = rev.substring(dashIndex + 1);
  }
  var deleted = false;
  merge.traverseRevTree(metadata.rev_tree,
  function (isLeaf, pos, id, acc, opts) {
    if (id === rev) {
      deleted = !!opts.deleted;
    }
  });

  return deleted;
};

exports.revExists = function (metadata, rev) {
  var found = false;
  merge.traverseRevTree(metadata.rev_tree, function (leaf, pos, id) {
    if ((pos + '-' + id) === rev) {
      found = true;
    }
  });
  return found;
};

exports.filterChange = function filterChange(opts) {
  var req = {};
  var hasFilter = opts.filter && typeof opts.filter === 'function';
  req.query = opts.query_params;

  return function filter(change) {
    if (!change.doc) {
      // CSG sends events on the changes feed that don't have documents,
      // this hack makes a whole lot of existing code robust.
      change.doc = {};
    }
    if (opts.filter && hasFilter && !opts.filter.call(this, change.doc, req)) {
      return false;
    }
    if (!opts.include_docs) {
      delete change.doc;
    } else if (!opts.attachments) {
      for (var att in change.doc._attachments) {
        if (change.doc._attachments.hasOwnProperty(att)) {
          change.doc._attachments[att].stub = true;
        }
      }
    }
    return true;
  };
};

exports.parseDoc = parseDoc.parseDoc;
exports.invalidIdError = parseDoc.invalidIdError;

exports.isCordova = function () {
  return (typeof cordova !== "undefined" ||
          typeof PhoneGap !== "undefined" ||
          typeof phonegap !== "undefined");
};

exports.hasLocalStorage = function () {
  if (isChromeApp()) {
    return false;
  }
  try {
    return localStorage;
  } catch (e) {
    return false;
  }
};
exports.Changes = Changes;
exports.inherits(Changes, EventEmitter);
function Changes() {
  if (!(this instanceof Changes)) {
    return new Changes();
  }
  var self = this;
  EventEmitter.call(this);
  this.isChrome = isChromeApp();
  this.listeners = {};
  this.hasLocal = false;
  if (!this.isChrome) {
    this.hasLocal = exports.hasLocalStorage();
  }
  if (this.isChrome) {
    chrome.storage.onChanged.addListener(function (e) {
      // make sure it's event addressed to us
      if (e.db_name != null) {
        //object only has oldValue, newValue members
        self.emit(e.dbName.newValue);
      }
    });
  } else if (this.hasLocal) {
    if (typeof addEventListener !== 'undefined') {
      addEventListener("storage", function (e) {
        self.emit(e.key);
      });
    } else { // old IE
      window.attachEvent("storage", function (e) {
        self.emit(e.key);
      });
    }
  }

}
Changes.prototype.addListener = function (dbName, id, db, opts) {
  if (this.listeners[id]) {
    return;
  }
  var self = this;
  var inprogress = false;
  function eventFunction() {
    if (!self.listeners[id]) {
      return;
    }
    if (inprogress) {
      inprogress = 'waiting';
      return;
    }
    inprogress = true;
    db.changes({
      style: opts.style,
      include_docs: opts.include_docs,
      attachments: opts.attachments,
      conflicts: opts.conflicts,
      continuous: false,
      descending: false,
      filter: opts.filter,
      doc_ids: opts.doc_ids,
      view: opts.view,
      since: opts.since,
      query_params: opts.query_params
    }).on('change', function (c) {
      if (c.seq > opts.since && !opts.cancelled) {
        opts.since = c.seq;
        exports.call(opts.onChange, c);
      }
    }).on('complete', function () {
      if (inprogress === 'waiting') {
        process.nextTick(function () {
          self.notify(dbName);
        });
      }
      inprogress = false;
    }).on('error', function () {
      inprogress = false;
    });
  }
  this.listeners[id] = eventFunction;
  this.on(dbName, eventFunction);
};

Changes.prototype.removeListener = function (dbName, id) {
  if (!(id in this.listeners)) {
    return;
  }
  EventEmitter.prototype.removeListener.call(this, dbName,
    this.listeners[id]);
};


Changes.prototype.notifyLocalWindows = function (dbName) {
  //do a useless change on a storage thing
  //in order to get other windows's listeners to activate
  if (this.isChrome) {
    chrome.storage.local.set({dbName: dbName});
  } else if (this.hasLocal) {
    localStorage[dbName] = (localStorage[dbName] === "a") ? "b" : "a";
  }
};

Changes.prototype.notify = function (dbName) {
  this.emit(dbName);
  this.notifyLocalWindows(dbName);
};

if (typeof atob === 'function') {
  exports.atob = function (str) {
    return atob(str);
  };
} else {
  exports.atob = function (str) {
    var base64 = new buffer(str, 'base64');
    // Node.js will just skip the characters it can't encode instead of
    // throwing and exception
    if (base64.toString('base64') !== str) {
      throw ("Cannot base64 encode full string");
    }
    return base64.toString('binary');
  };
}

if (typeof btoa === 'function') {
  exports.btoa = function (str) {
    return btoa(str);
  };
} else {
  exports.btoa = function (str) {
    return new buffer(str, 'binary').toString('base64');
  };
}

// From http://stackoverflow.com/questions/14967647/ (continues on next line)
// encode-decode-image-with-base64-breaks-image (2013-04-21)
exports.fixBinary = function (bin) {
  if (!process.browser) {
    // don't need to do this in Node
    return bin;
  }

  var length = bin.length;
  var buf = new ArrayBuffer(length);
  var arr = new Uint8Array(buf);
  for (var i = 0; i < length; i++) {
    arr[i] = bin.charCodeAt(i);
  }
  return buf;
};

// shim for browsers that don't support it
exports.readAsBinaryString = function (blob, callback) {
  var reader = new FileReader();
  var hasBinaryString = typeof reader.readAsBinaryString === 'function';
  reader.onloadend = function (e) {
    var result = e.target.result || '';
    if (hasBinaryString) {
      return callback(result);
    }
    callback(exports.arrayBufferToBinaryString(result));
  };
  if (hasBinaryString) {
    reader.readAsBinaryString(blob);
  } else {
    reader.readAsArrayBuffer(blob);
  }
};

// simplified API. universal browser support is assumed
exports.readAsArrayBuffer = function (blob, callback) {
  var reader = new FileReader();
  reader.onloadend = function (e) {
    var result = e.target.result || new ArrayBuffer(0);
    callback(result);
  };
  reader.readAsArrayBuffer(blob);
};

exports.once = function (fun) {
  var called = false;
  return exports.getArguments(function (args) {
    if (called) {
      throw new Error('once called  more than once');
    } else {
      called = true;
      fun.apply(this, args);
    }
  });
};

exports.toPromise = function (func) {
  //create the function we will be returning
  return exports.getArguments(function (args) {
    var self = this;
    var tempCB =
      (typeof args[args.length - 1] === 'function') ? args.pop() : false;
    // if the last argument is a function, assume its a callback
    var usedCB;
    if (tempCB) {
      // if it was a callback, create a new callback which calls it,
      // but do so async so we don't trap any errors
      usedCB = function (err, resp) {
        process.nextTick(function () {
          tempCB(err, resp);
        });
      };
    }
    var promise = new Promise(function (fulfill, reject) {
      var resp;
      try {
        var callback = exports.once(function (err, mesg) {
          if (err) {
            reject(err);
          } else {
            fulfill(mesg);
          }
        });
        // create a callback for this invocation
        // apply the function in the orig context
        args.push(callback);
        resp = func.apply(self, args);
        if (resp && typeof resp.then === 'function') {
          fulfill(resp);
        }
      } catch (e) {
        reject(e);
      }
    });
    // if there is a callback, call it back
    if (usedCB) {
      promise.then(function (result) {
        usedCB(null, result);
      }, usedCB);
    }
    promise.cancel = function () {
      return this;
    };
    return promise;
  });
};

exports.adapterFun = function (name, callback) {
  var log = require('debug')('pouchdb:api');

  function logApiCall(self, name, args) {
    if (!log.enabled) {
      return;
    }
    var logArgs = [self._db_name, name];
    for (var i = 0; i < args.length - 1; i++) {
      logArgs.push(args[i]);
    }
    log.apply(null, logArgs);

    // override the callback itself to log the response
    var origCallback = args[args.length - 1];
    args[args.length - 1] = function (err, res) {
      var responseArgs = [self._db_name, name];
      responseArgs = responseArgs.concat(
        err ? ['error', err] : ['success', res]
      );
      log.apply(null, responseArgs);
      origCallback(err, res);
    };
  }


  return exports.toPromise(exports.getArguments(function (args) {
    if (this._closed) {
      return Promise.reject(new Error('database is closed'));
    }
    var self = this;
    logApiCall(self, name, args);
    if (!this.taskqueue.isReady) {
      return new exports.Promise(function (fulfill, reject) {
        self.taskqueue.addTask(function (failed) {
          if (failed) {
            reject(failed);
          } else {
            fulfill(self[name].apply(self, args));
          }
        });
      });
    }
    return callback.apply(this, args);
  }));
};

//Can't find original post, but this is close
//http://stackoverflow.com/questions/6965107/ (continues on next line)
//converting-between-strings-and-arraybuffers
exports.arrayBufferToBinaryString = function (buffer) {
  var binary = "";
  var bytes = new Uint8Array(buffer);
  var length = bytes.byteLength;
  for (var i = 0; i < length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return binary;
};

exports.cancellableFun = function (fun, self, opts) {

  opts = opts ? exports.clone(true, {}, opts) : {};

  var emitter = new EventEmitter();
  var oldComplete = opts.complete || function () { };
  var complete = opts.complete = exports.once(function (err, resp) {
    if (err) {
      oldComplete(err);
    } else {
      emitter.emit('end', resp);
      oldComplete(null, resp);
    }
    emitter.removeAllListeners();
  });
  var oldOnChange = opts.onChange || function () {};
  var lastChange = 0;
  self.on('destroyed', function () {
    emitter.removeAllListeners();
  });
  opts.onChange = function (change) {
    oldOnChange(change);
    if (change.seq <= lastChange) {
      return;
    }
    lastChange = change.seq;
    emitter.emit('change', change);
    if (change.deleted) {
      emitter.emit('delete', change);
    } else if (change.changes.length === 1 &&
      change.changes[0].rev.slice(0, 1) === '1-') {
      emitter.emit('create', change);
    } else {
      emitter.emit('update', change);
    }
  };
  var promise = new Promise(function (fulfill, reject) {
    opts.complete = function (err, res) {
      if (err) {
        reject(err);
      } else {
        fulfill(res);
      }
    };
  });

  promise.then(function (result) {
    complete(null, result);
  }, complete);

  // this needs to be overwridden by caller, dont fire complete until
  // the task is ready
  promise.cancel = function () {
    promise.isCancelled = true;
    if (self.taskqueue.isReady) {
      opts.complete(null, {status: 'cancelled'});
    }
  };

  if (!self.taskqueue.isReady) {
    self.taskqueue.addTask(function () {
      if (promise.isCancelled) {
        opts.complete(null, {status: 'cancelled'});
      } else {
        fun(self, opts, promise);
      }
    });
  } else {
    fun(self, opts, promise);
  }
  promise.on = emitter.on.bind(emitter);
  promise.once = emitter.once.bind(emitter);
  promise.addListener = emitter.addListener.bind(emitter);
  promise.removeListener = emitter.removeListener.bind(emitter);
  promise.removeAllListeners = emitter.removeAllListeners.bind(emitter);
  promise.setMaxListeners = emitter.setMaxListeners.bind(emitter);
  promise.listeners = emitter.listeners.bind(emitter);
  promise.emit = emitter.emit.bind(emitter);
  return promise;
};

exports.MD5 = exports.toPromise(require('./deps/md5'));

// designed to give info to browser users, who are disturbed
// when they see 404s in the console
exports.explain404 = function (str) {
  if (process.browser && 'console' in global && 'info' in console) {
    console.info('The above 404 is totally normal. ' + str);
  }
};

exports.info = function (str) {
  if (typeof console !== 'undefined' && 'info' in console) {
    console.info(str);
  }
};

exports.parseUri = require('./deps/parse-uri');

exports.compare = function (left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
};

exports.updateDoc = function updateDoc(prev, docInfo, results,
                                       i, cb, writeDoc, newEdits) {

  if (exports.revExists(prev, docInfo.metadata.rev)) {
    results[i] = docInfo;
    return cb();
  }

  // TODO: some of these can be pre-calculated, but it's safer to just
  // call merge.winningRev() and exports.isDeleted() all over again
  var previousWinningRev = merge.winningRev(prev);
  var previouslyDeleted = exports.isDeleted(prev, previousWinningRev);
  var deleted = exports.isDeleted(docInfo.metadata);
  var isRoot = /^1-/.test(docInfo.metadata.rev);

  if (previouslyDeleted && !deleted && newEdits && isRoot) {
    var newDoc = docInfo.data;
    newDoc._rev = previousWinningRev;
    newDoc._id = docInfo.metadata.id;
    docInfo = exports.parseDoc(newDoc, newEdits);
  }

  var merged = merge.merge(prev.rev_tree, docInfo.metadata.rev_tree[0], 1000);

  var inConflict = newEdits && (((previouslyDeleted && deleted) ||
    (!previouslyDeleted && merged.conflicts !== 'new_leaf') ||
    (previouslyDeleted && !deleted && merged.conflicts === 'new_branch')));

  if (inConflict) {
    var err = errors.error(errors.REV_CONFLICT);
    results[i] = err;
    return cb();
  }

  var newRev = docInfo.metadata.rev;
  docInfo.metadata.rev_tree = merged.tree;
  if (prev.rev_map) {
    docInfo.metadata.rev_map = prev.rev_map; // used by leveldb
  }

  // recalculate
  var winningRev = merge.winningRev(docInfo.metadata);
  var winningRevIsDeleted = exports.isDeleted(docInfo.metadata, winningRev);

  // calculate the total number of documents that were added/removed,
  // from the perspective of total_rows/doc_count
  var delta = (previouslyDeleted === winningRevIsDeleted) ? 0 :
      previouslyDeleted < winningRevIsDeleted ? -1 : 1;

  var newRevIsDeleted = exports.isDeleted(docInfo.metadata, newRev);

  writeDoc(docInfo, winningRev, winningRevIsDeleted, newRevIsDeleted,
    true, delta, i, cb);
};

exports.processDocs = function processDocs(docInfos, api, fetchedDocs,
                                           tx, results, writeDoc, opts,
                                           overallCallback) {

  if (!docInfos.length) {
    return;
  }

  function insertDoc(docInfo, resultsIdx, callback) {
    // Cant insert new deleted documents
    var winningRev = merge.winningRev(docInfo.metadata);
    var deleted = exports.isDeleted(docInfo.metadata, winningRev);
    if ('was_delete' in opts && deleted) {
      results[resultsIdx] = errors.error(errors.MISSING_DOC, 'deleted');
      return callback();
    }

    var delta = deleted ? 0 : 1;

    writeDoc(docInfo, winningRev, deleted, deleted, false,
      delta, resultsIdx, callback);
  }

  var newEdits = opts.new_edits;
  var idsToDocs = new exports.Map();

  var docsDone = 0;
  var docsToDo = docInfos.length;

  function checkAllDocsDone() {
    if (++docsDone === docsToDo && overallCallback) {
      overallCallback();
    }
  }

  docInfos.forEach(function (currentDoc, resultsIdx) {

    if (currentDoc._id && exports.isLocalId(currentDoc._id)) {
      api[currentDoc._deleted ? '_removeLocal' : '_putLocal'](
        currentDoc, {ctx: tx}, function (err) {
          if (err) {
            results[resultsIdx] = err;
          } else {
            results[resultsIdx] = {ok: true};
          }
          checkAllDocsDone();
        });
      return;
    }

    var id = currentDoc.metadata.id;
    if (idsToDocs.has(id)) {
      docsToDo--; // duplicate
      idsToDocs.get(id).push([currentDoc, resultsIdx]);
    } else {
      idsToDocs.set(id, [[currentDoc, resultsIdx]]);
    }
  });

  // in the case of new_edits, the user can provide multiple docs
  // with the same id. these need to be processed sequentially
  idsToDocs.forEach(function (docs, id) {
    var numDone = 0;

    function docWritten() {
      if (++numDone < docs.length) {
        nextDoc();
      } else {
        checkAllDocsDone();
      }
    }
    function nextDoc() {
      var value = docs[numDone];
      var currentDoc = value[0];
      var resultsIdx = value[1];

      if (fetchedDocs.has(id)) {
        exports.updateDoc(fetchedDocs.get(id), currentDoc, results,
          resultsIdx, docWritten, writeDoc, newEdits);
      } else {
        insertDoc(currentDoc, resultsIdx, docWritten);
      }
    }
    nextDoc();
  });
};

exports.preprocessAttachments = function preprocessAttachments(
    docInfos, blobType, callback) {

  if (!docInfos.length) {
    return callback();
  }

  var docv = 0;

  function parseBase64(data) {
    try {
      return exports.atob(data);
    } catch (e) {
      var err = errors.error(errors.BAD_ARG,
                             'Attachments need to be base64 encoded');
      return {error: err};
    }
  }

  function preprocessAttachment(att, callback) {
    if (att.stub) {
      return callback();
    }
    if (typeof att.data === 'string') {
      // input is a base64 string

      var asBinary = parseBase64(att.data);
      if (asBinary.error) {
        return callback(asBinary.error);
      }

      att.length = asBinary.length;
      if (blobType === 'blob') {
        att.data = exports.createBlob([exports.fixBinary(asBinary)],
          {type: att.content_type});
      } else if (blobType === 'base64') {
        att.data = exports.btoa(asBinary);
      } else { // binary
        att.data = asBinary;
      }
      exports.MD5(asBinary).then(function (result) {
        att.digest = 'md5-' + result;
        callback();
      });
    } else { // input is a blob
      exports.readAsArrayBuffer(att.data, function (buff) {
        if (blobType === 'binary') {
          att.data = exports.arrayBufferToBinaryString(buff);
        } else if (blobType === 'base64') {
          att.data = exports.btoa(exports.arrayBufferToBinaryString(buff));
        }
        exports.MD5(buff).then(function (result) {
          att.digest = 'md5-' + result;
          att.length = buff.byteLength;
          callback();
        });
      });
    }
  }

  var overallErr;

  docInfos.forEach(function (docInfo) {
    var attachments = docInfo.data && docInfo.data._attachments ?
      Object.keys(docInfo.data._attachments) : [];
    var recv = 0;

    if (!attachments.length) {
      return done();
    }

    function processedAttachment(err) {
      overallErr = err;
      recv++;
      if (recv === attachments.length) {
        done();
      }
    }

    for (var key in docInfo.data._attachments) {
      if (docInfo.data._attachments.hasOwnProperty(key)) {
        preprocessAttachment(docInfo.data._attachments[key],
          processedAttachment);
      }
    }
  });

  function done() {
    docv++;
    if (docInfos.length === docv) {
      if (overallErr) {
        callback(overallErr);
      } else {
        callback();
      }
    }
  }
};

// compact a tree by marking its non-leafs as missing,
// and return a list of revs to delete
exports.compactTree = function compactTree(metadata) {
  var revs = [];
  merge.traverseRevTree(metadata.rev_tree, function (isLeaf, pos,
                                                     revHash, ctx, opts) {
    if (opts.status === 'available' && !isLeaf) {
      revs.push(pos + '-' + revHash);
      opts.status = 'missing';
    }
  });
  return revs;
};

var vuvuzela = require('vuvuzela');

exports.safeJsonParse = function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch (e) {
    return vuvuzela.parse(str);
  }
};

exports.safeJsonStringify = function safeJsonStringify(json) {
  try {
    return JSON.stringify(json);
  } catch (e) {
    return vuvuzela.stringify(json);
  }
};

}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"./deps/ajax":21,"./deps/blob":22,"./deps/buffer":23,"./deps/errors":24,"./deps/md5":25,"./deps/parse-doc":26,"./deps/parse-uri":28,"./deps/uuid":31,"./merge":35,"_process":80,"argsarray":42,"bluebird":50,"debug":43,"events":79,"inherits":46,"pouchdb-collections":67,"pouchdb-extend":68,"vuvuzela":77}],41:[function(require,module,exports){
module.exports = "3.4.0";

},{}],42:[function(require,module,exports){
'use strict';

module.exports = argsArray;

function argsArray(fun) {
  return function () {
    var len = arguments.length;
    if (len) {
      var args = [];
      var i = -1;
      while (++i < len) {
        args[i] = arguments[i];
      }
      return fun.call(this, args);
    } else {
      return fun.call(this, []);
    }
  };
}
},{}],43:[function(require,module,exports){

/**
 * This is the web browser implementation of `debug()`.
 *
 * Expose `debug()` as the module.
 */

exports = module.exports = require('./debug');
exports.log = log;
exports.formatArgs = formatArgs;
exports.save = save;
exports.load = load;
exports.useColors = useColors;

/**
 * Use chrome.storage.local if we are in an app
 */

var storage;

if (typeof chrome !== 'undefined' && typeof chrome.storage !== 'undefined')
  storage = chrome.storage.local;
else
  storage = localstorage();

/**
 * Colors.
 */

exports.colors = [
  'lightseagreen',
  'forestgreen',
  'goldenrod',
  'dodgerblue',
  'darkorchid',
  'crimson'
];

/**
 * Currently only WebKit-based Web Inspectors, Firefox >= v31,
 * and the Firebug extension (any Firefox version) are known
 * to support "%c" CSS customizations.
 *
 * TODO: add a `localStorage` variable to explicitly enable/disable colors
 */

function useColors() {
  // is webkit? http://stackoverflow.com/a/16459606/376773
  return ('WebkitAppearance' in document.documentElement.style) ||
    // is firebug? http://stackoverflow.com/a/398120/376773
    (window.console && (console.firebug || (console.exception && console.table))) ||
    // is firefox >= v31?
    // https://developer.mozilla.org/en-US/docs/Tools/Web_Console#Styling_messages
    (navigator.userAgent.toLowerCase().match(/firefox\/(\d+)/) && parseInt(RegExp.$1, 10) >= 31);
}

/**
 * Map %j to `JSON.stringify()`, since no Web Inspectors do that by default.
 */

exports.formatters.j = function(v) {
  return JSON.stringify(v);
};


/**
 * Colorize log arguments if enabled.
 *
 * @api public
 */

function formatArgs() {
  var args = arguments;
  var useColors = this.useColors;

  args[0] = (useColors ? '%c' : '')
    + this.namespace
    + (useColors ? ' %c' : ' ')
    + args[0]
    + (useColors ? '%c ' : ' ')
    + '+' + exports.humanize(this.diff);

  if (!useColors) return args;

  var c = 'color: ' + this.color;
  args = [args[0], c, 'color: inherit'].concat(Array.prototype.slice.call(args, 1));

  // the final "%c" is somewhat tricky, because there could be other
  // arguments passed either before or after the %c, so we need to
  // figure out the correct index to insert the CSS into
  var index = 0;
  var lastC = 0;
  args[0].replace(/%[a-z%]/g, function(match) {
    if ('%%' === match) return;
    index++;
    if ('%c' === match) {
      // we only are interested in the *last* %c
      // (the user may have provided their own)
      lastC = index;
    }
  });

  args.splice(lastC, 0, c);
  return args;
}

/**
 * Invokes `console.log()` when available.
 * No-op when `console.log` is not a "function".
 *
 * @api public
 */

function log() {
  // this hackery is required for IE8/9, where
  // the `console.log` function doesn't have 'apply'
  return 'object' === typeof console
    && console.log
    && Function.prototype.apply.call(console.log, console, arguments);
}

/**
 * Save `namespaces`.
 *
 * @param {String} namespaces
 * @api private
 */

function save(namespaces) {
  try {
    if (null == namespaces) {
      storage.removeItem('debug');
    } else {
      storage.debug = namespaces;
    }
  } catch(e) {}
}

/**
 * Load `namespaces`.
 *
 * @return {String} returns the previously persisted debug modes
 * @api private
 */

function load() {
  var r;
  try {
    r = storage.debug;
  } catch(e) {}
  return r;
}

/**
 * Enable namespaces listed in `localStorage.debug` initially.
 */

exports.enable(load());

/**
 * Localstorage attempts to return the localstorage.
 *
 * This is necessary because safari throws
 * when a user disables cookies/localstorage
 * and you attempt to access it.
 *
 * @return {LocalStorage}
 * @api private
 */

function localstorage(){
  try {
    return window.localStorage;
  } catch (e) {}
}

},{"./debug":44}],44:[function(require,module,exports){

/**
 * This is the common logic for both the Node.js and web browser
 * implementations of `debug()`.
 *
 * Expose `debug()` as the module.
 */

exports = module.exports = debug;
exports.coerce = coerce;
exports.disable = disable;
exports.enable = enable;
exports.enabled = enabled;
exports.humanize = require('ms');

/**
 * The currently active debug mode names, and names to skip.
 */

exports.names = [];
exports.skips = [];

/**
 * Map of special "%n" handling functions, for the debug "format" argument.
 *
 * Valid key names are a single, lowercased letter, i.e. "n".
 */

exports.formatters = {};

/**
 * Previously assigned color.
 */

var prevColor = 0;

/**
 * Previous log timestamp.
 */

var prevTime;

/**
 * Select a color.
 *
 * @return {Number}
 * @api private
 */

function selectColor() {
  return exports.colors[prevColor++ % exports.colors.length];
}

/**
 * Create a debugger with the given `namespace`.
 *
 * @param {String} namespace
 * @return {Function}
 * @api public
 */

function debug(namespace) {

  // define the `disabled` version
  function disabled() {
  }
  disabled.enabled = false;

  // define the `enabled` version
  function enabled() {

    var self = enabled;

    // set `diff` timestamp
    var curr = +new Date();
    var ms = curr - (prevTime || curr);
    self.diff = ms;
    self.prev = prevTime;
    self.curr = curr;
    prevTime = curr;

    // add the `color` if not set
    if (null == self.useColors) self.useColors = exports.useColors();
    if (null == self.color && self.useColors) self.color = selectColor();

    var args = Array.prototype.slice.call(arguments);

    args[0] = exports.coerce(args[0]);

    if ('string' !== typeof args[0]) {
      // anything else let's inspect with %o
      args = ['%o'].concat(args);
    }

    // apply any `formatters` transformations
    var index = 0;
    args[0] = args[0].replace(/%([a-z%])/g, function(match, format) {
      // if we encounter an escaped % then don't increase the array index
      if (match === '%%') return match;
      index++;
      var formatter = exports.formatters[format];
      if ('function' === typeof formatter) {
        var val = args[index];
        match = formatter.call(self, val);

        // now we need to remove `args[index]` since it's inlined in the `format`
        args.splice(index, 1);
        index--;
      }
      return match;
    });

    if ('function' === typeof exports.formatArgs) {
      args = exports.formatArgs.apply(self, args);
    }
    var logFn = enabled.log || exports.log || console.log.bind(console);
    logFn.apply(self, args);
  }
  enabled.enabled = true;

  var fn = exports.enabled(namespace) ? enabled : disabled;

  fn.namespace = namespace;

  return fn;
}

/**
 * Enables a debug mode by namespaces. This can include modes
 * separated by a colon and wildcards.
 *
 * @param {String} namespaces
 * @api public
 */

function enable(namespaces) {
  exports.save(namespaces);

  var split = (namespaces || '').split(/[\s,]+/);
  var len = split.length;

  for (var i = 0; i < len; i++) {
    if (!split[i]) continue; // ignore empty strings
    namespaces = split[i].replace(/\*/g, '.*?');
    if (namespaces[0] === '-') {
      exports.skips.push(new RegExp('^' + namespaces.substr(1) + '$'));
    } else {
      exports.names.push(new RegExp('^' + namespaces + '$'));
    }
  }
}

/**
 * Disable debug output.
 *
 * @api public
 */

function disable() {
  exports.enable('');
}

/**
 * Returns true if the given mode name is enabled, false otherwise.
 *
 * @param {String} name
 * @return {Boolean}
 * @api public
 */

function enabled(name) {
  var i, len;
  for (i = 0, len = exports.skips.length; i < len; i++) {
    if (exports.skips[i].test(name)) {
      return false;
    }
  }
  for (i = 0, len = exports.names.length; i < len; i++) {
    if (exports.names[i].test(name)) {
      return true;
    }
  }
  return false;
}

/**
 * Coerce `val`.
 *
 * @param {Mixed} val
 * @return {Mixed}
 * @api private
 */

function coerce(val) {
  if (val instanceof Error) return val.stack || val.message;
  return val;
}

},{"ms":45}],45:[function(require,module,exports){
/**
 * Helpers.
 */

var s = 1000;
var m = s * 60;
var h = m * 60;
var d = h * 24;
var y = d * 365.25;

/**
 * Parse or format the given `val`.
 *
 * Options:
 *
 *  - `long` verbose formatting [false]
 *
 * @param {String|Number} val
 * @param {Object} options
 * @return {String|Number}
 * @api public
 */

module.exports = function(val, options){
  options = options || {};
  if ('string' == typeof val) return parse(val);
  return options.long
    ? long(val)
    : short(val);
};

/**
 * Parse the given `str` and return milliseconds.
 *
 * @param {String} str
 * @return {Number}
 * @api private
 */

function parse(str) {
  var match = /^((?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|years?|yrs?|y)?$/i.exec(str);
  if (!match) return;
  var n = parseFloat(match[1]);
  var type = (match[2] || 'ms').toLowerCase();
  switch (type) {
    case 'years':
    case 'year':
    case 'yrs':
    case 'yr':
    case 'y':
      return n * y;
    case 'days':
    case 'day':
    case 'd':
      return n * d;
    case 'hours':
    case 'hour':
    case 'hrs':
    case 'hr':
    case 'h':
      return n * h;
    case 'minutes':
    case 'minute':
    case 'mins':
    case 'min':
    case 'm':
      return n * m;
    case 'seconds':
    case 'second':
    case 'secs':
    case 'sec':
    case 's':
      return n * s;
    case 'milliseconds':
    case 'millisecond':
    case 'msecs':
    case 'msec':
    case 'ms':
      return n;
  }
}

/**
 * Short format for `ms`.
 *
 * @param {Number} ms
 * @return {String}
 * @api private
 */

function short(ms) {
  if (ms >= d) return Math.round(ms / d) + 'd';
  if (ms >= h) return Math.round(ms / h) + 'h';
  if (ms >= m) return Math.round(ms / m) + 'm';
  if (ms >= s) return Math.round(ms / s) + 's';
  return ms + 'ms';
}

/**
 * Long format for `ms`.
 *
 * @param {Number} ms
 * @return {String}
 * @api private
 */

function long(ms) {
  return plural(ms, d, 'day')
    || plural(ms, h, 'hour')
    || plural(ms, m, 'minute')
    || plural(ms, s, 'second')
    || ms + ' ms';
}

/**
 * Pluralization helper.
 */

function plural(ms, n, name) {
  if (ms < n) return;
  if (ms < n * 1.5) return Math.floor(ms / n) + ' ' + name;
  return Math.ceil(ms / n) + ' ' + name + 's';
}

},{}],46:[function(require,module,exports){
if (typeof Object.create === 'function') {
  // implementation from standard node.js 'util' module
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: {
        value: ctor,
        enumerable: false,
        writable: true,
        configurable: true
      }
    });
  };
} else {
  // old school shim for old browsers
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    var TempCtor = function () {}
    TempCtor.prototype = superCtor.prototype
    ctor.prototype = new TempCtor()
    ctor.prototype.constructor = ctor
  }
}

},{}],47:[function(require,module,exports){
'use strict';

module.exports = INTERNAL;

function INTERNAL() {}
},{}],48:[function(require,module,exports){
'use strict';
var Promise = require('./promise');
var reject = require('./reject');
var resolve = require('./resolve');
var INTERNAL = require('./INTERNAL');
var handlers = require('./handlers');
module.exports = all;
function all(iterable) {
  if (Object.prototype.toString.call(iterable) !== '[object Array]') {
    return reject(new TypeError('must be an array'));
  }

  var len = iterable.length;
  var called = false;
  if (!len) {
    return resolve([]);
  }

  var values = new Array(len);
  var resolved = 0;
  var i = -1;
  var promise = new Promise(INTERNAL);
  
  while (++i < len) {
    allResolver(iterable[i], i);
  }
  return promise;
  function allResolver(value, i) {
    resolve(value).then(resolveFromAll, function (error) {
      if (!called) {
        called = true;
        handlers.reject(promise, error);
      }
    });
    function resolveFromAll(outValue) {
      values[i] = outValue;
      if (++resolved === len & !called) {
        called = true;
        handlers.resolve(promise, values);
      }
    }
  }
}
},{"./INTERNAL":47,"./handlers":49,"./promise":51,"./reject":54,"./resolve":55}],49:[function(require,module,exports){
'use strict';
var tryCatch = require('./tryCatch');
var resolveThenable = require('./resolveThenable');
var states = require('./states');

exports.resolve = function (self, value) {
  var result = tryCatch(getThen, value);
  if (result.status === 'error') {
    return exports.reject(self, result.value);
  }
  var thenable = result.value;

  if (thenable) {
    resolveThenable.safely(self, thenable);
  } else {
    self.state = states.FULFILLED;
    self.outcome = value;
    var i = -1;
    var len = self.queue.length;
    while (++i < len) {
      self.queue[i].callFulfilled(value);
    }
  }
  return self;
};
exports.reject = function (self, error) {
  self.state = states.REJECTED;
  self.outcome = error;
  var i = -1;
  var len = self.queue.length;
  while (++i < len) {
    self.queue[i].callRejected(error);
  }
  return self;
};

function getThen(obj) {
  // Make sure we only access the accessor once as required by the spec
  var then = obj && obj.then;
  if (obj && typeof obj === 'object' && typeof then === 'function') {
    return function appyThen() {
      then.apply(obj, arguments);
    };
  }
}
},{"./resolveThenable":56,"./states":57,"./tryCatch":58}],50:[function(require,module,exports){
module.exports = exports = require('./promise');

exports.resolve = require('./resolve');
exports.reject = require('./reject');
exports.all = require('./all');
exports.race = require('./race');
},{"./all":48,"./promise":51,"./race":53,"./reject":54,"./resolve":55}],51:[function(require,module,exports){
'use strict';

var unwrap = require('./unwrap');
var INTERNAL = require('./INTERNAL');
var resolveThenable = require('./resolveThenable');
var states = require('./states');
var QueueItem = require('./queueItem');

module.exports = Promise;
function Promise(resolver) {
  if (!(this instanceof Promise)) {
    return new Promise(resolver);
  }
  if (typeof resolver !== 'function') {
    throw new TypeError('resolver must be a function');
  }
  this.state = states.PENDING;
  this.queue = [];
  this.outcome = void 0;
  if (resolver !== INTERNAL) {
    resolveThenable.safely(this, resolver);
  }
}

Promise.prototype['catch'] = function (onRejected) {
  return this.then(null, onRejected);
};
Promise.prototype.then = function (onFulfilled, onRejected) {
  if (typeof onFulfilled !== 'function' && this.state === states.FULFILLED ||
    typeof onRejected !== 'function' && this.state === states.REJECTED) {
    return this;
  }
  var promise = new Promise(INTERNAL);

  
  if (this.state !== states.PENDING) {
    var resolver = this.state === states.FULFILLED ? onFulfilled: onRejected;
    unwrap(promise, resolver, this.outcome);
  } else {
    this.queue.push(new QueueItem(promise, onFulfilled, onRejected));
  }

  return promise;
};

},{"./INTERNAL":47,"./queueItem":52,"./resolveThenable":56,"./states":57,"./unwrap":59}],52:[function(require,module,exports){
'use strict';
var handlers = require('./handlers');
var unwrap = require('./unwrap');

module.exports = QueueItem;
function QueueItem(promise, onFulfilled, onRejected) {
  this.promise = promise;
  if (typeof onFulfilled === 'function') {
    this.onFulfilled = onFulfilled;
    this.callFulfilled = this.otherCallFulfilled;
  }
  if (typeof onRejected === 'function') {
    this.onRejected = onRejected;
    this.callRejected = this.otherCallRejected;
  }
}
QueueItem.prototype.callFulfilled = function (value) {
  handlers.resolve(this.promise, value);
};
QueueItem.prototype.otherCallFulfilled = function (value) {
  unwrap(this.promise, this.onFulfilled, value);
};
QueueItem.prototype.callRejected = function (value) {
  handlers.reject(this.promise, value);
};
QueueItem.prototype.otherCallRejected = function (value) {
  unwrap(this.promise, this.onRejected, value);
};
},{"./handlers":49,"./unwrap":59}],53:[function(require,module,exports){
'use strict';
var Promise = require('./promise');
var reject = require('./reject');
var resolve = require('./resolve');
var INTERNAL = require('./INTERNAL');
var handlers = require('./handlers');
module.exports = race;
function race(iterable) {
  if (Object.prototype.toString.call(iterable) !== '[object Array]') {
    return reject(new TypeError('must be an array'));
  }

  var len = iterable.length;
  var called = false;
  if (!len) {
    return resolve([]);
  }

  var resolved = 0;
  var i = -1;
  var promise = new Promise(INTERNAL);
  
  while (++i < len) {
    resolver(iterable[i]);
  }
  return promise;
  function resolver(value) {
    resolve(value).then(function (response) {
      if (!called) {
        called = true;
        handlers.resolve(promise, response);
      }
    }, function (error) {
      if (!called) {
        called = true;
        handlers.reject(promise, error);
      }
    });
  }
}
},{"./INTERNAL":47,"./handlers":49,"./promise":51,"./reject":54,"./resolve":55}],54:[function(require,module,exports){
'use strict';

var Promise = require('./promise');
var INTERNAL = require('./INTERNAL');
var handlers = require('./handlers');
module.exports = reject;

function reject(reason) {
	var promise = new Promise(INTERNAL);
	return handlers.reject(promise, reason);
}
},{"./INTERNAL":47,"./handlers":49,"./promise":51}],55:[function(require,module,exports){
'use strict';

var Promise = require('./promise');
var INTERNAL = require('./INTERNAL');
var handlers = require('./handlers');
module.exports = resolve;

var FALSE = handlers.resolve(new Promise(INTERNAL), false);
var NULL = handlers.resolve(new Promise(INTERNAL), null);
var UNDEFINED = handlers.resolve(new Promise(INTERNAL), void 0);
var ZERO = handlers.resolve(new Promise(INTERNAL), 0);
var EMPTYSTRING = handlers.resolve(new Promise(INTERNAL), '');

function resolve(value) {
  if (value) {
    if (value instanceof Promise) {
      return value;
    }
    return handlers.resolve(new Promise(INTERNAL), value);
  }
  var valueType = typeof value;
  switch (valueType) {
    case 'boolean':
      return FALSE;
    case 'undefined':
      return UNDEFINED;
    case 'object':
      return NULL;
    case 'number':
      return ZERO;
    case 'string':
      return EMPTYSTRING;
  }
}
},{"./INTERNAL":47,"./handlers":49,"./promise":51}],56:[function(require,module,exports){
'use strict';
var handlers = require('./handlers');
var tryCatch = require('./tryCatch');
function safelyResolveThenable(self, thenable) {
  // Either fulfill, reject or reject with error
  var called = false;
  function onError(value) {
    if (called) {
      return;
    }
    called = true;
    handlers.reject(self, value);
  }

  function onSuccess(value) {
    if (called) {
      return;
    }
    called = true;
    handlers.resolve(self, value);
  }

  function tryToUnwrap() {
    thenable(onSuccess, onError);
  }
  
  var result = tryCatch(tryToUnwrap);
  if (result.status === 'error') {
    onError(result.value);
  }
}
exports.safely = safelyResolveThenable;
},{"./handlers":49,"./tryCatch":58}],57:[function(require,module,exports){
// Lazy man's symbols for states

exports.REJECTED = ['REJECTED'];
exports.FULFILLED = ['FULFILLED'];
exports.PENDING = ['PENDING'];
},{}],58:[function(require,module,exports){
'use strict';

module.exports = tryCatch;

function tryCatch(func, value) {
  var out = {};
  try {
    out.value = func(value);
    out.status = 'success';
  } catch (e) {
    out.status = 'error';
    out.value = e;
  }
  return out;
}
},{}],59:[function(require,module,exports){
'use strict';

var immediate = require('immediate');
var handlers = require('./handlers');
module.exports = unwrap;

function unwrap(promise, func, value) {
  immediate(function () {
    var returnValue;
    try {
      returnValue = func(value);
    } catch (e) {
      return handlers.reject(promise, e);
    }
    if (returnValue === promise) {
      handlers.reject(promise, new TypeError('Cannot resolve promise with itself'));
    } else {
      handlers.resolve(promise, returnValue);
    }
  });
}
},{"./handlers":49,"immediate":60}],60:[function(require,module,exports){
'use strict';
var types = [
  require('./nextTick'),
  require('./mutation.js'),
  require('./messageChannel'),
  require('./stateChange'),
  require('./timeout')
];
var draining;
var currentQueue;
var queueIndex = -1;
var queue = [];
function cleanUpNextTick() {
    draining = false;
    if (currentQueue && currentQueue.length) {
      queue = currentQueue.concat(queue);
    } else {
      queueIndex = -1;
    }
    if (queue.length) {
      nextTick();
    }
}

//named nextTick for less confusing stack traces
function nextTick() {
  draining = true;
  var len = queue.length;
  var timeout = setTimeout(cleanUpNextTick);
  while (len) {
    currentQueue = queue;
    queue = [];
    while (++queueIndex < len) {
      currentQueue[queueIndex]();
    }
    queueIndex = -1;
    len = queue.length;
  }
  queueIndex = -1;
  draining = false;
  clearTimeout(timeout);
}
var scheduleDrain;
var i = -1;
var len = types.length;
while (++ i < len) {
  if (types[i] && types[i].test && types[i].test()) {
    scheduleDrain = types[i].install(nextTick);
    break;
  }
}
module.exports = immediate;
function immediate(task) {
  if (queue.push(task) === 1 && !draining) {
    scheduleDrain();
  }
}
},{"./messageChannel":61,"./mutation.js":62,"./nextTick":78,"./stateChange":63,"./timeout":64}],61:[function(require,module,exports){
(function (global){
'use strict';

exports.test = function () {
  if (global.setImmediate) {
    // we can only get here in IE10
    // which doesn't handel postMessage well
    return false;
  }
  return typeof global.MessageChannel !== 'undefined';
};

exports.install = function (func) {
  var channel = new global.MessageChannel();
  channel.port1.onmessage = func;
  return function () {
    channel.port2.postMessage(0);
  };
};
}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}],62:[function(require,module,exports){
(function (global){
'use strict';
//based off rsvp https://github.com/tildeio/rsvp.js
//license https://github.com/tildeio/rsvp.js/blob/master/LICENSE
//https://github.com/tildeio/rsvp.js/blob/master/lib/rsvp/asap.js

var Mutation = global.MutationObserver || global.WebKitMutationObserver;

exports.test = function () {
  return Mutation;
};

exports.install = function (handle) {
  var called = 0;
  var observer = new Mutation(handle);
  var element = global.document.createTextNode('');
  observer.observe(element, {
    characterData: true
  });
  return function () {
    element.data = (called = ++called % 2);
  };
};
}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}],63:[function(require,module,exports){
(function (global){
'use strict';

exports.test = function () {
  return 'document' in global && 'onreadystatechange' in global.document.createElement('script');
};

exports.install = function (handle) {
  return function () {

    // Create a <script> element; its readystatechange event will be fired asynchronously once it is inserted
    // into the document. Do so, thus queuing up the task. Remember to clean up once it's been called.
    var scriptEl = global.document.createElement('script');
    scriptEl.onreadystatechange = function () {
      handle();

      scriptEl.onreadystatechange = null;
      scriptEl.parentNode.removeChild(scriptEl);
      scriptEl = null;
    };
    global.document.documentElement.appendChild(scriptEl);

    return handle;
  };
};
}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}],64:[function(require,module,exports){
'use strict';
exports.test = function () {
  return true;
};

exports.install = function (t) {
  return function () {
    setTimeout(t, 0);
  };
};
},{}],65:[function(require,module,exports){
'use strict';

var MIN_MAGNITUDE = -324; // verified by -Number.MIN_VALUE
var MAGNITUDE_DIGITS = 3; // ditto
var SEP = ''; // set to '_' for easier debugging 

var utils = require('./utils');

exports.collate = function (a, b) {

  if (a === b) {
    return 0;
  }

  a = exports.normalizeKey(a);
  b = exports.normalizeKey(b);

  var ai = collationIndex(a);
  var bi = collationIndex(b);
  if ((ai - bi) !== 0) {
    return ai - bi;
  }
  if (a === null) {
    return 0;
  }
  switch (typeof a) {
    case 'number':
      return a - b;
    case 'boolean':
      return a === b ? 0 : (a < b ? -1 : 1);
    case 'string':
      return stringCollate(a, b);
  }
  return Array.isArray(a) ? arrayCollate(a, b) : objectCollate(a, b);
};

// couch considers null/NaN/Infinity/-Infinity === undefined,
// for the purposes of mapreduce indexes. also, dates get stringified.
exports.normalizeKey = function (key) {
  switch (typeof key) {
    case 'undefined':
      return null;
    case 'number':
      if (key === Infinity || key === -Infinity || isNaN(key)) {
        return null;
      }
      return key;
    case 'object':
      var origKey = key;
      if (Array.isArray(key)) {
        var len = key.length;
        key = new Array(len);
        for (var i = 0; i < len; i++) {
          key[i] = exports.normalizeKey(origKey[i]);
        }
      } else if (key instanceof Date) {
        return key.toJSON();
      } else if (key !== null) { // generic object
        key = {};
        for (var k in origKey) {
          if (origKey.hasOwnProperty(k)) {
            var val = origKey[k];
            if (typeof val !== 'undefined') {
              key[k] = exports.normalizeKey(val);
            }
          }
        }
      }
  }
  return key;
};

function indexify(key) {
  if (key !== null) {
    switch (typeof key) {
      case 'boolean':
        return key ? 1 : 0;
      case 'number':
        return numToIndexableString(key);
      case 'string':
        // We've to be sure that key does not contain \u0000
        // Do order-preserving replacements:
        // 0 -> 1, 1
        // 1 -> 1, 2
        // 2 -> 2, 2
        return key
          .replace(/\u0002/g, '\u0002\u0002')
          .replace(/\u0001/g, '\u0001\u0002')
          .replace(/\u0000/g, '\u0001\u0001');
      case 'object':
        var isArray = Array.isArray(key);
        var arr = isArray ? key : Object.keys(key);
        var i = -1;
        var len = arr.length;
        var result = '';
        if (isArray) {
          while (++i < len) {
            result += exports.toIndexableString(arr[i]);
          }
        } else {
          while (++i < len) {
            var objKey = arr[i];
            result += exports.toIndexableString(objKey) +
                exports.toIndexableString(key[objKey]);
          }
        }
        return result;
    }
  }
  return '';
}

// convert the given key to a string that would be appropriate
// for lexical sorting, e.g. within a database, where the
// sorting is the same given by the collate() function.
exports.toIndexableString = function (key) {
  var zero = '\u0000';
  key = exports.normalizeKey(key);
  return collationIndex(key) + SEP + indexify(key) + zero;
};

function parseNumber(str, i) {
  var originalIdx = i;
  var num;
  var zero = str[i] === '1';
  if (zero) {
    num = 0;
    i++;
  } else {
    var neg = str[i] === '0';
    i++;
    var numAsString = '';
    var magAsString = str.substring(i, i + MAGNITUDE_DIGITS);
    var magnitude = parseInt(magAsString, 10) + MIN_MAGNITUDE;
    if (neg) {
      magnitude = -magnitude;
    }
    i += MAGNITUDE_DIGITS;
    while (true) {
      var ch = str[i];
      if (ch === '\u0000') {
        break;
      } else {
        numAsString += ch;
      }
      i++;
    }
    numAsString = numAsString.split('.');
    if (numAsString.length === 1) {
      num = parseInt(numAsString, 10);
    } else {
      num = parseFloat(numAsString[0] + '.' + numAsString[1]);
    }
    if (neg) {
      num = num - 10;
    }
    if (magnitude !== 0) {
      // parseFloat is more reliable than pow due to rounding errors
      // e.g. Number.MAX_VALUE would return Infinity if we did
      // num * Math.pow(10, magnitude);
      num = parseFloat(num + 'e' + magnitude);
    }
  }
  return {num: num, length : i - originalIdx};
}

// move up the stack while parsing
// this function moved outside of parseIndexableString for performance
function pop(stack, metaStack) {
  var obj = stack.pop();

  if (metaStack.length) {
    var lastMetaElement = metaStack[metaStack.length - 1];
    if (obj === lastMetaElement.element) {
      // popping a meta-element, e.g. an object whose value is another object
      metaStack.pop();
      lastMetaElement = metaStack[metaStack.length - 1];
    }
    var element = lastMetaElement.element;
    var lastElementIndex = lastMetaElement.index;
    if (Array.isArray(element)) {
      element.push(obj);
    } else if (lastElementIndex === stack.length - 2) { // obj with key+value
      var key = stack.pop();
      element[key] = obj;
    } else {
      stack.push(obj); // obj with key only
    }
  }
}

exports.parseIndexableString = function (str) {
  var stack = [];
  var metaStack = []; // stack for arrays and objects
  var i = 0;

  while (true) {
    var collationIndex = str[i++];
    if (collationIndex === '\u0000') {
      if (stack.length === 1) {
        return stack.pop();
      } else {
        pop(stack, metaStack);
        continue;
      }
    }
    switch (collationIndex) {
      case '1':
        stack.push(null);
        break;
      case '2':
        stack.push(str[i] === '1');
        i++;
        break;
      case '3':
        var parsedNum = parseNumber(str, i);
        stack.push(parsedNum.num);
        i += parsedNum.length;
        break;
      case '4':
        var parsedStr = '';
        while (true) {
          var ch = str[i];
          if (ch === '\u0000') {
            break;
          }
          parsedStr += ch;
          i++;
        }
        // perform the reverse of the order-preserving replacement
        // algorithm (see above)
        parsedStr = parsedStr.replace(/\u0001\u0001/g, '\u0000')
          .replace(/\u0001\u0002/g, '\u0001')
          .replace(/\u0002\u0002/g, '\u0002');
        stack.push(parsedStr);
        break;
      case '5':
        var arrayElement = { element: [], index: stack.length };
        stack.push(arrayElement.element);
        metaStack.push(arrayElement);
        break;
      case '6':
        var objElement = { element: {}, index: stack.length };
        stack.push(objElement.element);
        metaStack.push(objElement);
        break;
      default:
        throw new Error(
          'bad collationIndex or unexpectedly reached end of input: ' + collationIndex);
    }
  }
};

function arrayCollate(a, b) {
  var len = Math.min(a.length, b.length);
  for (var i = 0; i < len; i++) {
    var sort = exports.collate(a[i], b[i]);
    if (sort !== 0) {
      return sort;
    }
  }
  return (a.length === b.length) ? 0 :
    (a.length > b.length) ? 1 : -1;
}
function stringCollate(a, b) {
  // See: https://github.com/daleharvey/pouchdb/issues/40
  // This is incompatible with the CouchDB implementation, but its the
  // best we can do for now
  return (a === b) ? 0 : ((a > b) ? 1 : -1);
}
function objectCollate(a, b) {
  var ak = Object.keys(a), bk = Object.keys(b);
  var len = Math.min(ak.length, bk.length);
  for (var i = 0; i < len; i++) {
    // First sort the keys
    var sort = exports.collate(ak[i], bk[i]);
    if (sort !== 0) {
      return sort;
    }
    // if the keys are equal sort the values
    sort = exports.collate(a[ak[i]], b[bk[i]]);
    if (sort !== 0) {
      return sort;
    }

  }
  return (ak.length === bk.length) ? 0 :
    (ak.length > bk.length) ? 1 : -1;
}
// The collation is defined by erlangs ordered terms
// the atoms null, true, false come first, then numbers, strings,
// arrays, then objects
// null/undefined/NaN/Infinity/-Infinity are all considered null
function collationIndex(x) {
  var id = ['boolean', 'number', 'string', 'object'];
  var idx = id.indexOf(typeof x);
  //false if -1 otherwise true, but fast!!!!1
  if (~idx) {
    if (x === null) {
      return 1;
    }
    if (Array.isArray(x)) {
      return 5;
    }
    return idx < 3 ? (idx + 2) : (idx + 3);
  }
  if (Array.isArray(x)) {
    return 5;
  }
}

// conversion:
// x yyy zz...zz
// x = 0 for negative, 1 for 0, 2 for positive
// y = exponent (for negative numbers negated) moved so that it's >= 0
// z = mantisse
function numToIndexableString(num) {

  if (num === 0) {
    return '1';
  }

  // convert number to exponential format for easier and
  // more succinct string sorting
  var expFormat = num.toExponential().split(/e\+?/);
  var magnitude = parseInt(expFormat[1], 10);

  var neg = num < 0;

  var result = neg ? '0' : '2';

  // first sort by magnitude
  // it's easier if all magnitudes are positive
  var magForComparison = ((neg ? -magnitude : magnitude) - MIN_MAGNITUDE);
  var magString = utils.padLeft((magForComparison).toString(), '0', MAGNITUDE_DIGITS);

  result += SEP + magString;

  // then sort by the factor
  var factor = Math.abs(parseFloat(expFormat[0])); // [1..10)
  if (neg) { // for negative reverse ordering
    factor = 10 - factor;
  }

  var factorStr = factor.toFixed(20);

  // strip zeros from the end
  factorStr = factorStr.replace(/\.?0+$/, '');

  result += SEP + factorStr;

  return result;
}

},{"./utils":66}],66:[function(require,module,exports){
'use strict';

function pad(str, padWith, upToLength) {
  var padding = '';
  var targetLength = upToLength - str.length;
  while (padding.length < targetLength) {
    padding += padWith;
  }
  return padding;
}

exports.padLeft = function (str, padWith, upToLength) {
  var padding = pad(str, padWith, upToLength);
  return padding + str;
};

exports.padRight = function (str, padWith, upToLength) {
  var padding = pad(str, padWith, upToLength);
  return str + padding;
};

exports.stringLexCompare = function (a, b) {

  var aLen = a.length;
  var bLen = b.length;

  var i;
  for (i = 0; i < aLen; i++) {
    if (i === bLen) {
      // b is shorter substring of a
      return 1;
    }
    var aChar = a.charAt(i);
    var bChar = b.charAt(i);
    if (aChar !== bChar) {
      return aChar < bChar ? -1 : 1;
    }
  }

  if (aLen < bLen) {
    // a is shorter substring of b
    return -1;
  }

  return 0;
};

/*
 * returns the decimal form for the given integer, i.e. writes
 * out all the digits (in base-10) instead of using scientific notation
 */
exports.intToDecimalForm = function (int) {

  var isNeg = int < 0;
  var result = '';

  do {
    var remainder = isNeg ? -Math.ceil(int % 10) : Math.floor(int % 10);

    result = remainder + result;
    int = isNeg ? Math.ceil(int / 10) : Math.floor(int / 10);
  } while (int);


  if (isNeg && result !== '0') {
    result = '-' + result;
  }

  return result;
};
},{}],67:[function(require,module,exports){
'use strict';
exports.Map = LazyMap; // TODO: use ES6 map
exports.Set = LazySet; // TODO: use ES6 set
// based on https://github.com/montagejs/collections
function LazyMap() {
  this.store = {};
}
LazyMap.prototype.mangle = function (key) {
  if (typeof key !== "string") {
    throw new TypeError("key must be a string but Got " + key);
  }
  return '$' + key;
};
LazyMap.prototype.unmangle = function (key) {
  return key.substring(1);
};
LazyMap.prototype.get = function (key) {
  var mangled = this.mangle(key);
  if (mangled in this.store) {
    return this.store[mangled];
  } else {
    return void 0;
  }
};
LazyMap.prototype.set = function (key, value) {
  var mangled = this.mangle(key);
  this.store[mangled] = value;
  return true;
};
LazyMap.prototype.has = function (key) {
  var mangled = this.mangle(key);
  return mangled in this.store;
};
LazyMap.prototype.delete = function (key) {
  var mangled = this.mangle(key);
  if (mangled in this.store) {
    delete this.store[mangled];
    return true;
  }
  return false;
};
LazyMap.prototype.forEach = function (cb) {
  var self = this;
  var keys = Object.keys(self.store);
  keys.forEach(function (key) {
    var value = self.store[key];
    key = self.unmangle(key);
    cb(value, key);
  });
};

function LazySet(array) {
  this.store = new LazyMap();

  // init with an array
  if (array && Array.isArray(array)) {
    for (var i = 0, len = array.length; i < len; i++) {
      this.add(array[i]);
    }
  }
}
LazySet.prototype.add = function (key) {
  return this.store.set(key, true);
};
LazySet.prototype.has = function (key) {
  return this.store.has(key);
};
LazySet.prototype.delete = function (key) {
  return this.store.delete(key);
};

},{}],68:[function(require,module,exports){
"use strict";

// Extends method
// (taken from http://code.jquery.com/jquery-1.9.0.js)
// Populate the class2type map
var class2type = {};

var types = [
  "Boolean", "Number", "String", "Function", "Array",
  "Date", "RegExp", "Object", "Error"
];
for (var i = 0; i < types.length; i++) {
  var typename = types[i];
  class2type["[object " + typename + "]"] = typename.toLowerCase();
}

var core_toString = class2type.toString;
var core_hasOwn = class2type.hasOwnProperty;

function type(obj) {
  if (obj === null) {
    return String(obj);
  }
  return typeof obj === "object" || typeof obj === "function" ?
    class2type[core_toString.call(obj)] || "object" :
    typeof obj;
}

function isWindow(obj) {
  return obj !== null && obj === obj.window;
}

function isPlainObject(obj) {
  // Must be an Object.
  // Because of IE, we also have to check the presence of
  // the constructor property.
  // Make sure that DOM nodes and window objects don't pass through, as well
  if (!obj || type(obj) !== "object" || obj.nodeType || isWindow(obj)) {
    return false;
  }

  try {
    // Not own constructor property must be Object
    if (obj.constructor &&
      !core_hasOwn.call(obj, "constructor") &&
      !core_hasOwn.call(obj.constructor.prototype, "isPrototypeOf")) {
      return false;
    }
  } catch ( e ) {
    // IE8,9 Will throw exceptions on certain host objects #9897
    return false;
  }

  // Own properties are enumerated firstly, so to speed up,
  // if last one is own, then all properties are own.
  var key;
  for (key in obj) {}

  return key === undefined || core_hasOwn.call(obj, key);
}


function isFunction(obj) {
  return type(obj) === "function";
}

var isArray = Array.isArray || function (obj) {
  return type(obj) === "array";
};

function extend() {
  // originally extend() was recursive, but this ended up giving us
  // "call stack exceeded", so it's been unrolled to use a literal stack
  // (see https://github.com/pouchdb/pouchdb/issues/2543)
  var stack = [];
  var i = -1;
  var len = arguments.length;
  var args = new Array(len);
  while (++i < len) {
    args[i] = arguments[i];
  }
  var container = {};
  stack.push({args: args, result: {container: container, key: 'key'}});
  var next;
  while ((next = stack.pop())) {
    extendInner(stack, next.args, next.result);
  }
  return container.key;
}

function extendInner(stack, args, result) {
  var options, name, src, copy, copyIsArray, clone,
    target = args[0] || {},
    i = 1,
    length = args.length,
    deep = false,
    numericStringRegex = /\d+/,
    optionsIsArray;

  // Handle a deep copy situation
  if (typeof target === "boolean") {
    deep = target;
    target = args[1] || {};
    // skip the boolean and the target
    i = 2;
  }

  // Handle case when target is a string or something (possible in deep copy)
  if (typeof target !== "object" && !isFunction(target)) {
    target = {};
  }

  // extend jQuery itself if only one argument is passed
  if (length === i) {
    /* jshint validthis: true */
    target = this;
    --i;
  }

  for (; i < length; i++) {
    // Only deal with non-null/undefined values
    if ((options = args[i]) != null) {
      optionsIsArray = isArray(options);
      // Extend the base object
      for (name in options) {
        //if (options.hasOwnProperty(name)) {
        if (!(name in Object.prototype)) {
          if (optionsIsArray && !numericStringRegex.test(name)) {
            continue;
          }

          src = target[name];
          copy = options[name];

          // Prevent never-ending loop
          if (target === copy) {
            continue;
          }

          // Recurse if we're merging plain objects or arrays
          if (deep && copy && (isPlainObject(copy) ||
              (copyIsArray = isArray(copy)))) {
            if (copyIsArray) {
              copyIsArray = false;
              clone = src && isArray(src) ? src : [];

            } else {
              clone = src && isPlainObject(src) ? src : {};
            }

            // Never move original objects, clone them
            stack.push({
              args: [deep, clone, copy],
              result: {
                container: target,
                key: name
              }
            });

          // Don't bring in undefined values
          } else if (copy !== undefined) {
            if (!(isArray(options) && isFunction(copy))) {
              target[name] = copy;
            }
          }
        }
      }
    }
  }

  // "Return" the modified object by setting the key
  // on the given container
  result.container[result.key] = target;
}


module.exports = extend;



},{}],69:[function(require,module,exports){
'use strict';

var upsert = require('./upsert');
var utils = require('./utils');
var Promise = utils.Promise;

module.exports = function (opts) {
  var sourceDB = opts.db;
  var viewName = opts.viewName;
  var mapFun = opts.map;
  var reduceFun = opts.reduce;
  var temporary = opts.temporary;

  // the "undefined" part is for backwards compatibility
  var viewSignature = mapFun.toString() + (reduceFun && reduceFun.toString()) +
    'undefined';

  if (!temporary && sourceDB._cachedViews) {
    var cachedView = sourceDB._cachedViews[viewSignature];
    if (cachedView) {
      return Promise.resolve(cachedView);
    }
  }

  return sourceDB.info().then(function (info) {

    var depDbName = info.db_name + '-mrview-' +
      (temporary ? 'temp' : utils.MD5(viewSignature));

    // save the view name in the source PouchDB so it can be cleaned up if necessary
    // (e.g. when the _design doc is deleted, remove all associated view data)
    function diffFunction(doc) {
      doc.views = doc.views || {};
      var fullViewName = viewName;
      if (fullViewName.indexOf('/') === -1) {
        fullViewName = viewName + '/' + viewName;
      }
      var depDbs = doc.views[fullViewName] = doc.views[fullViewName] || {};
      /* istanbul ignore if */
      if (depDbs[depDbName]) {
        return; // no update necessary
      }
      depDbs[depDbName] = true;
      return doc;
    }
    return upsert(sourceDB, '_local/mrviews', diffFunction).then(function () {
      return sourceDB.registerDependentDatabase(depDbName).then(function (res) {
        var db = res.db;
        db.auto_compaction = true;
        var view = {
          name: depDbName,
          db: db, 
          sourceDB: sourceDB,
          adapter: sourceDB.adapter,
          mapFun: mapFun,
          reduceFun: reduceFun
        };
        return view.db.get('_local/lastSeq')["catch"](function (err) {
          /* istanbul ignore if */
          if (err.status !== 404) {
            throw err;
          }
        }).then(function (lastSeqDoc) {
          view.seq = lastSeqDoc ? lastSeqDoc.seq : 0;
          if (!temporary) {
            sourceDB._cachedViews = sourceDB._cachedViews || {};
            sourceDB._cachedViews[viewSignature] = view;
            view.db.on('destroyed', function () {
              delete sourceDB._cachedViews[viewSignature];
            });
          }
          return view;
        });
      });
    });
  });
};

},{"./upsert":73,"./utils":74}],70:[function(require,module,exports){
'use strict';

module.exports = function (func, emit, sum, log, isArray, toJSON) {
  /*jshint evil:true,unused:false */
  return eval("'use strict'; (" + func.replace(/;\s*$/, "") + ");");
};

},{}],71:[function(require,module,exports){
(function (process){
'use strict';

var pouchCollate = require('pouchdb-collate');
var TaskQueue = require('./taskqueue');
var collate = pouchCollate.collate;
var toIndexableString = pouchCollate.toIndexableString;
var normalizeKey = pouchCollate.normalizeKey;
var createView = require('./create-view');
var evalFunc = require('./evalfunc');
var log; 
/* istanbul ignore else */
if ((typeof console !== 'undefined') && (typeof console.log === 'function')) {
  log = Function.prototype.bind.call(console.log, console);
} else {
  log = function () {};
}
var utils = require('./utils');
var Promise = utils.Promise;
var persistentQueues = {};
var tempViewQueue = new TaskQueue();
var CHANGES_BATCH_SIZE = 50;

function parseViewName(name) {
  // can be either 'ddocname/viewname' or just 'viewname'
  // (where the ddoc name is the same)
  return name.indexOf('/') === -1 ? [name, name] : name.split('/');
}

function isGenOne(changes) {
  // only return true if the current change is 1-
  // and there are no other leafs
  return changes.length === 1 && /^1-/.test(changes[0].rev);
}

function emitError(db, e) {
  try {
    db.emit('error', e);
  } catch (err) {
    console.error(
      'The user\'s map/reduce function threw an uncaught error.\n' +
      'You can debug this error by doing:\n' +
      'myDatabase.on(\'error\', function (err) { debugger; });\n' +
      'Please double-check your map/reduce function.');
    console.error(e);
  }
}

function tryCode(db, fun, args) {
  // emit an event if there was an error thrown by a map/reduce function.
  // putting try/catches in a single function also avoids deoptimizations.
  try {
    return {
      output : fun.apply(null, args)
    };
  } catch (e) {
    emitError(db, e);
    return {error: e};
  }
}

function sortByKeyThenValue(x, y) {
  var keyCompare = collate(x.key, y.key);
  return keyCompare !== 0 ? keyCompare : collate(x.value, y.value);
}

function sliceResults(results, limit, skip) {
  skip = skip || 0;
  if (typeof limit === 'number') {
    return results.slice(skip, limit + skip);
  } else if (skip > 0) {
    return results.slice(skip);
  }
  return results;
}

function rowToDocId(row) {
  var val = row.value;
  // Users can explicitly specify a joined doc _id, or it
  // defaults to the doc _id that emitted the key/value.
  var docId = (val && typeof val === 'object' && val._id) || row.id;
  return docId;
}

function createBuiltInError(name) {
  var message = 'builtin ' + name +
    ' function requires map values to be numbers' +
    ' or number arrays';
  return new BuiltInError(message);
}

function sum(values) {
  var result = 0;
  for (var i = 0, len = values.length; i < len; i++) {
    var num = values[i];
    if (typeof num !== 'number') {
      if (Array.isArray(num)) {
        // lists of numbers are also allowed, sum them separately
        result = typeof result === 'number' ? [result] : result;
        for (var j = 0, jLen = num.length; j < jLen; j++) {
          var jNum = num[j];
          if (typeof jNum !== 'number') {
            throw createBuiltInError('_sum');
          } else if (typeof result[j] === 'undefined') {
            result.push(jNum);
          } else {
            result[j] += jNum;
          }
        }
      } else { // not array/number
        throw createBuiltInError('_sum');
      }
    } else if (typeof result === 'number') {
      result += num;
    } else { // add number to array
      result[0] += num;
    }
  }
  return result;
}

var builtInReduce = {
  _sum: function (keys, values) {
    return sum(values);
  },

  _count: function (keys, values) {
    return values.length;
  },

  _stats: function (keys, values) {
    // no need to implement rereduce=true, because Pouch
    // will never call it
    function sumsqr(values) {
      var _sumsqr = 0;
      for (var i = 0, len = values.length; i < len; i++) {
        var num = values[i];
        _sumsqr += (num * num);
      }
      return _sumsqr;
    }
    return {
      sum     : sum(values),
      min     : Math.min.apply(null, values),
      max     : Math.max.apply(null, values),
      count   : values.length,
      sumsqr : sumsqr(values)
    };
  }
};

function addHttpParam(paramName, opts, params, asJson) {
  // add an http param from opts to params, optionally json-encoded
  var val = opts[paramName];
  if (typeof val !== 'undefined') {
    if (asJson) {
      val = encodeURIComponent(JSON.stringify(val));
    }
    params.push(paramName + '=' + val);
  }
}

function checkQueryParseError(options, fun) {
  var startkeyName = options.descending ? 'endkey' : 'startkey';
  var endkeyName = options.descending ? 'startkey' : 'endkey';

  if (typeof options[startkeyName] !== 'undefined' &&
    typeof options[endkeyName] !== 'undefined' &&
    collate(options[startkeyName], options[endkeyName]) > 0) {
    throw new QueryParseError('No rows can match your key range, reverse your ' +
        'start_key and end_key or set {descending : true}');
  } else if (fun.reduce && options.reduce !== false) {
    if (options.include_docs) {
      throw new QueryParseError('{include_docs:true} is invalid for reduce');
    } else if (options.keys && options.keys.length > 1 &&
        !options.group && !options.group_level) {
      throw new QueryParseError('Multi-key fetches for reduce views must use {group: true}');
    }
  }
  if (options.group_level) {
    if (typeof options.group_level !== 'number') {
      throw new QueryParseError('Invalid value for integer: "' + options.group_level + '"');
    }
    if (options.group_level < 0) {
      throw new QueryParseError('Invalid value for positive integer: ' +
        '"' + options.group_level + '"');
    }
  }
}

function httpQuery(db, fun, opts) {
  // List of parameters to add to the PUT request
  var params = [];
  var body;
  var method = 'GET';

  // If opts.reduce exists and is defined, then add it to the list
  // of parameters.
  // If reduce=false then the results are that of only the map function
  // not the final result of map and reduce.
  addHttpParam('reduce', opts, params);
  addHttpParam('include_docs', opts, params);
  addHttpParam('attachments', opts, params);
  addHttpParam('limit', opts, params);
  addHttpParam('descending', opts, params);
  addHttpParam('group', opts, params);
  addHttpParam('group_level', opts, params);
  addHttpParam('skip', opts, params);
  addHttpParam('stale', opts, params);
  addHttpParam('conflicts', opts, params);
  addHttpParam('startkey', opts, params, true);
  addHttpParam('endkey', opts, params, true);
  addHttpParam('inclusive_end', opts, params);
  addHttpParam('key', opts, params, true);

  // Format the list of parameters into a valid URI query string
  params = params.join('&');
  params = params === '' ? '' : '?' + params;

  // If keys are supplied, issue a POST request to circumvent GET query string limits
  // see http://wiki.apache.org/couchdb/HTTP_view_API#Querying_Options
  if (typeof opts.keys !== 'undefined') {
    var MAX_URL_LENGTH = 2000;
    // according to http://stackoverflow.com/a/417184/680742,
    // the de facto URL length limit is 2000 characters

    var keysAsString =
      'keys=' + encodeURIComponent(JSON.stringify(opts.keys));
    if (keysAsString.length + params.length + 1 <= MAX_URL_LENGTH) {
      // If the keys are short enough, do a GET. we do this to work around
      // Safari not understanding 304s on POSTs (see pouchdb/pouchdb#1239)
      params += (params[0] === '?' ? '&' : '?') + keysAsString;
    } else {
      method = 'POST';
      if (typeof fun === 'string') {
        body = JSON.stringify({keys: opts.keys});
      } else { // fun is {map : mapfun}, so append to this
        fun.keys = opts.keys;
      }
    }
  }

  // We are referencing a query defined in the design doc
  if (typeof fun === 'string') {
    var parts = parseViewName(fun);
    return db.request({
      method: method,
      url: '_design/' + parts[0] + '/_view/' + parts[1] + params,
      body: body
    });
  }

  // We are using a temporary view, terrible for performance but good for testing
  body = body || {};
  Object.keys(fun).forEach(function (key) {
    if (Array.isArray(fun[key])) {
      body[key] = fun[key];
    } else {
      body[key] = fun[key].toString();
    }
  });
  return db.request({
    method: 'POST',
    url: '_temp_view' + params,
    body: body
  });
}

function defaultsTo(value) {
  return function (reason) {
    /* istanbul ignore else */
    if (reason.status === 404) {
      return value;
    } else {
      throw reason;
    }
  };
}

// returns a promise for a list of docs to update, based on the input docId.
// the order doesn't matter, because post-3.2.0, bulkDocs
// is an atomic operation in all three adapters.
function getDocsToPersist(docId, view, docIdsToChangesAndEmits) {
  var metaDocId = '_local/doc_' + docId;
  var defaultMetaDoc = {_id: metaDocId, keys: []};
  var docData = docIdsToChangesAndEmits[docId];
  var indexableKeysToKeyValues = docData.indexableKeysToKeyValues;
  var changes = docData.changes;

  function getMetaDoc() {
    if (isGenOne(changes)) {
      // generation 1, so we can safely assume initial state
      // for performance reasons (avoids unnecessary GETs)
      return Promise.resolve(defaultMetaDoc);
    }
    return view.db.get(metaDocId)["catch"](defaultsTo(defaultMetaDoc));
  }

  function getKeyValueDocs(metaDoc) {
    if (!metaDoc.keys.length) {
      // no keys, no need for a lookup
      return Promise.resolve({rows: []});
    }
    return view.db.allDocs({
      keys: metaDoc.keys,
      include_docs: true
    });
  }

  function processKvDocs(metaDoc, kvDocsRes) {
    var kvDocs = [];
    var oldKeysMap = {};

    for (var i = 0, len = kvDocsRes.rows.length; i < len; i++) {
      var row = kvDocsRes.rows[i];
      var doc = row.doc;
      if (!doc) { // deleted
        continue;
      }
      kvDocs.push(doc);
      oldKeysMap[doc._id] = true;
      doc._deleted = !indexableKeysToKeyValues[doc._id];
      if (!doc._deleted) {
        var keyValue = indexableKeysToKeyValues[doc._id];
        if ('value' in keyValue) {
          doc.value = keyValue.value;
        }
      }
    }

    var newKeys = Object.keys(indexableKeysToKeyValues);
    newKeys.forEach(function (key) {
      if (!oldKeysMap[key]) {
        // new doc
        var kvDoc = {
          _id: key
        };
        var keyValue = indexableKeysToKeyValues[key];
        if ('value' in keyValue) {
          kvDoc.value = keyValue.value;
        }
        kvDocs.push(kvDoc);
      }
    });
    metaDoc.keys = utils.uniq(newKeys.concat(metaDoc.keys));
    kvDocs.push(metaDoc);

    return kvDocs;
  }

  return getMetaDoc().then(function (metaDoc) {
    return getKeyValueDocs(metaDoc).then(function (kvDocsRes) {
      return processKvDocs(metaDoc, kvDocsRes);
    });
  });
}

// updates all emitted key/value docs and metaDocs in the mrview database
// for the given batch of documents from the source database
function saveKeyValues(view, docIdsToChangesAndEmits, seq) {
  var seqDocId = '_local/lastSeq';
  return view.db.get(seqDocId)[
  "catch"](defaultsTo({_id: seqDocId, seq: 0}))
  .then(function (lastSeqDoc) {
    var docIds = Object.keys(docIdsToChangesAndEmits);
    return Promise.all(docIds.map(function (docId) {
      return getDocsToPersist(docId, view, docIdsToChangesAndEmits);
    })).then(function (listOfDocsToPersist) {
      var docsToPersist = utils.flatten(listOfDocsToPersist);
      lastSeqDoc.seq = seq;
      docsToPersist.push(lastSeqDoc);
      // write all docs in a single operation, update the seq once
      return view.db.bulkDocs({docs : docsToPersist});
    });
  });
}

function getQueue(view) {
  var viewName = typeof view === 'string' ? view : view.name;
  var queue = persistentQueues[viewName];
  if (!queue) {
    queue = persistentQueues[viewName] = new TaskQueue();
  }
  return queue;
}

function updateView(view) {
  return utils.sequentialize(getQueue(view), function () {
    return updateViewInQueue(view);
  })();
}

function updateViewInQueue(view) {
  // bind the emit function once
  var mapResults;
  var doc;

  function emit(key, value) {
    var output = {id: doc._id, key: normalizeKey(key)};
    // Don't explicitly store the value unless it's defined and non-null.
    // This saves on storage space, because often people don't use it.
    if (typeof value !== 'undefined' && value !== null) {
      output.value = normalizeKey(value);
    }
    mapResults.push(output);
  }

  var mapFun;
  // for temp_views one can use emit(doc, emit), see #38
  if (typeof view.mapFun === "function" && view.mapFun.length === 2) {
    var origMap = view.mapFun;
    mapFun = function (doc) {
      return origMap(doc, emit);
    };
  } else {
    mapFun = evalFunc(view.mapFun.toString(), emit, sum, log, Array.isArray, JSON.parse);
  }

  var currentSeq = view.seq || 0;

  function processChange(docIdsToChangesAndEmits, seq) {
    return function () {
      return saveKeyValues(view, docIdsToChangesAndEmits, seq);
    };
  }

  var queue = new TaskQueue();
  // TODO(neojski): https://github.com/daleharvey/pouchdb/issues/1521

  return new Promise(function (resolve, reject) {

    function complete() {
      queue.finish().then(function () {
        view.seq = currentSeq;
        resolve();
      });
    }

    function processNextBatch() {
      view.sourceDB.changes({
        conflicts: true,
        include_docs: true,
        style: 'all_docs',
        since: currentSeq,
        limit: CHANGES_BATCH_SIZE
      }).on('complete', function (response) {
        var results = response.results;
        if (!results.length) {
          return complete();
        }
        var docIdsToChangesAndEmits = {};
        for (var i = 0, l = results.length; i < l; i++) {
          var change = results[i];
          if (change.doc._id[0] !== '_') {
            mapResults = [];
            doc = change.doc;

            if (!doc._deleted) {
              tryCode(view.sourceDB, mapFun, [doc]);
            }
            mapResults.sort(sortByKeyThenValue);

            var indexableKeysToKeyValues = {};
            var lastKey;
            for (var j = 0, jl = mapResults.length; j < jl; j++) {
              var obj = mapResults[j];
              var complexKey = [obj.key, obj.id];
              if (collate(obj.key, lastKey) === 0) {
                complexKey.push(j); // dup key+id, so make it unique
              }
              var indexableKey = toIndexableString(complexKey);
              indexableKeysToKeyValues[indexableKey] = obj;
              lastKey = obj.key;
            }
            docIdsToChangesAndEmits[change.doc._id] = {
              indexableKeysToKeyValues: indexableKeysToKeyValues,
              changes: change.changes
            };
          }
          currentSeq = change.seq;
        }
        queue.add(processChange(docIdsToChangesAndEmits, currentSeq));
        if (results.length < CHANGES_BATCH_SIZE) {
          return complete();
        }
        return processNextBatch();
      }).on('error', onError);
      /* istanbul ignore next */
      function onError(err) {
        reject(err);
      }
    }

    processNextBatch();
  });
}

function reduceView(view, results, options) {
  if (options.group_level === 0) {
    delete options.group_level;
  }

  var shouldGroup = options.group || options.group_level;

  var reduceFun;
  if (builtInReduce[view.reduceFun]) {
    reduceFun = builtInReduce[view.reduceFun];
  } else {
    reduceFun = evalFunc(
      view.reduceFun.toString(), null, sum, log, Array.isArray, JSON.parse);
  }

  var groups = [];
  var lvl = options.group_level;
  results.forEach(function (e) {
    var last = groups[groups.length - 1];
    var key = shouldGroup ? e.key : null;

    // only set group_level for array keys
    if (shouldGroup && Array.isArray(key) && typeof lvl === 'number') {
      key = key.length > lvl ? key.slice(0, lvl) : key;
    }

    if (last && collate(last.key[0][0], key) === 0) {
      last.key.push([key, e.id]);
      last.value.push(e.value);
      return;
    }
    groups.push({key: [
      [key, e.id]
    ], value: [e.value]});
  });
  for (var i = 0, len = groups.length; i < len; i++) {
    var e = groups[i];
    var reduceTry = tryCode(view.sourceDB, reduceFun, [e.key, e.value, false]);
    if (reduceTry.error && reduceTry.error instanceof BuiltInError) {
      // CouchDB returns an error if a built-in errors out
      throw reduceTry.error;
    }
    // CouchDB just sets the value to null if a non-built-in errors out
    e.value = reduceTry.error ? null : reduceTry.output;
    e.key = e.key[0][0];
  }
  // no total_rows/offset when reducing
  return {rows: sliceResults(groups, options.limit, options.skip)};
}

function queryView(view, opts) {
  return utils.sequentialize(getQueue(view), function () {
    return queryViewInQueue(view, opts);
  })();
}

function queryViewInQueue(view, opts) {
  var totalRows;
  var shouldReduce = view.reduceFun && opts.reduce !== false;
  var skip = opts.skip || 0;
  if (typeof opts.keys !== 'undefined' && !opts.keys.length) {
    // equivalent query
    opts.limit = 0;
    delete opts.keys;
  }

  function fetchFromView(viewOpts) {
    viewOpts.include_docs = true;
    return view.db.allDocs(viewOpts).then(function (res) {
      totalRows = res.total_rows;
      return res.rows.map(function (result) {

        // implicit migration - in older versions of PouchDB,
        // we explicitly stored the doc as {id: ..., key: ..., value: ...}
        // this is tested in a migration test
        /* istanbul ignore next */
        if ('value' in result.doc && typeof result.doc.value === 'object' &&
            result.doc.value !== null) {
          var keys = Object.keys(result.doc.value).sort();
          // this detection method is not perfect, but it's unlikely the user
          // emitted a value which was an object with these 3 exact keys
          var expectedKeys = ['id', 'key', 'value'];
          if (!(keys < expectedKeys || keys > expectedKeys)) {
            return result.doc.value;
          }
        }

        var parsedKeyAndDocId = pouchCollate.parseIndexableString(result.doc._id);
        return {
          key: parsedKeyAndDocId[0],
          id: parsedKeyAndDocId[1],
          value: ('value' in result.doc ? result.doc.value : null)
        };
      });
    });
  }

  function onMapResultsReady(rows) {
    var finalResults;
    if (shouldReduce) {
      finalResults = reduceView(view, rows, opts);
    } else {
      finalResults = {
        total_rows: totalRows,
        offset: skip,
        rows: rows
      };
    }
    if (opts.include_docs) {
      var docIds = utils.uniq(rows.map(rowToDocId));

      return view.sourceDB.allDocs({
        keys: docIds,
        include_docs: true,
        conflicts: opts.conflicts,
        attachments: opts.attachments
      }).then(function (allDocsRes) {
        var docIdsToDocs = {};
        allDocsRes.rows.forEach(function (row) {
          if (row.doc) {
            docIdsToDocs['$' + row.id] = row.doc;
          }
        });
        rows.forEach(function (row) {
          var docId = rowToDocId(row);
          var doc = docIdsToDocs['$' + docId];
          if (doc) {
            row.doc = doc;
          }
        });
        return finalResults;
      });
    } else {
      return finalResults;
    }
  }

  var flatten = function (array) {
    return array.reduce(function (prev, cur) {
      return prev.concat(cur);
    });
  };

  if (typeof opts.keys !== 'undefined') {
    var keys = opts.keys;
    var fetchPromises = keys.map(function (key) {
      var viewOpts = {
        startkey : toIndexableString([key]),
        endkey   : toIndexableString([key, {}])
      };
      return fetchFromView(viewOpts);
    });
    return Promise.all(fetchPromises).then(flatten).then(onMapResultsReady);
  } else { // normal query, no 'keys'
    var viewOpts = {
      descending : opts.descending
    };
    if (typeof opts.startkey !== 'undefined') {
      viewOpts.startkey = opts.descending ?
        toIndexableString([opts.startkey, {}]) :
        toIndexableString([opts.startkey]);
    }
    if (typeof opts.endkey !== 'undefined') {
      var inclusiveEnd = opts.inclusive_end !== false;
      if (opts.descending) {
        inclusiveEnd = !inclusiveEnd;
      }

      viewOpts.endkey = toIndexableString(inclusiveEnd ? [opts.endkey, {}] : [opts.endkey]);
    }
    if (typeof opts.key !== 'undefined') {
      var keyStart = toIndexableString([opts.key]);
      var keyEnd = toIndexableString([opts.key, {}]);
      if (viewOpts.descending) {
        viewOpts.endkey = keyStart;
        viewOpts.startkey = keyEnd;
      } else {
        viewOpts.startkey = keyStart;
        viewOpts.endkey = keyEnd;
      }
    }
    if (!shouldReduce) {
      if (typeof opts.limit === 'number') {
        viewOpts.limit = opts.limit;
      }
      viewOpts.skip = skip;
    }
    return fetchFromView(viewOpts).then(onMapResultsReady);
  }
}

function httpViewCleanup(db) {
  return db.request({
    method: 'POST',
    url: '_view_cleanup'
  });
}

function localViewCleanup(db) {
  return db.get('_local/mrviews').then(function (metaDoc) {
    var docsToViews = {};
    Object.keys(metaDoc.views).forEach(function (fullViewName) {
      var parts = parseViewName(fullViewName);
      var designDocName = '_design/' + parts[0];
      var viewName = parts[1];
      docsToViews[designDocName] = docsToViews[designDocName] || {};
      docsToViews[designDocName][viewName] = true;
    });
    var opts = {
      keys : Object.keys(docsToViews),
      include_docs : true
    };
    return db.allDocs(opts).then(function (res) {
      var viewsToStatus = {};
      res.rows.forEach(function (row) {
        var ddocName = row.key.substring(8);
        Object.keys(docsToViews[row.key]).forEach(function (viewName) {
          var fullViewName = ddocName + '/' + viewName;
          /* istanbul ignore if */
          if (!metaDoc.views[fullViewName]) {
            // new format, without slashes, to support PouchDB 2.2.0
            // migration test in pouchdb's browser.migration.js verifies this
            fullViewName = viewName;
          }
          var viewDBNames = Object.keys(metaDoc.views[fullViewName]);
          // design doc deleted, or view function nonexistent
          var statusIsGood = row.doc && row.doc.views && row.doc.views[viewName];
          viewDBNames.forEach(function (viewDBName) {
            viewsToStatus[viewDBName] = viewsToStatus[viewDBName] || statusIsGood;
          });
        });
      });
      var dbsToDelete = Object.keys(viewsToStatus).filter(function (viewDBName) {
        return !viewsToStatus[viewDBName];
      });
      var destroyPromises = dbsToDelete.map(function (viewDBName) {
        return utils.sequentialize(getQueue(viewDBName), function () {
          return new db.constructor(viewDBName, db.__opts).destroy();
        })();
      });
      return Promise.all(destroyPromises).then(function () {
        return {ok: true};
      });
    });
  }, defaultsTo({ok: true}));
}

exports.viewCleanup = utils.callbackify(function () {
  var db = this;
  if (db.type() === 'http') {
    return httpViewCleanup(db);
  }
  return localViewCleanup(db);
});

function queryPromised(db, fun, opts) {
  if (db.type() === 'http') {
    return httpQuery(db, fun, opts);
  }

  if (typeof fun !== 'string') {
    // temp_view
    checkQueryParseError(opts, fun);

    var createViewOpts = {
      db : db,
      viewName : 'temp_view/temp_view',
      map : fun.map,
      reduce : fun.reduce,
      temporary : true
    };
    tempViewQueue.add(function () {
      return createView(createViewOpts).then(function (view) {
        function cleanup() {
          return view.db.destroy();
        }
        return utils.fin(updateView(view).then(function () {
          return queryView(view, opts);
        }), cleanup);
      });
    });
    return tempViewQueue.finish();
  } else {
    // persistent view
    var fullViewName = fun;
    var parts = parseViewName(fullViewName);
    var designDocName = parts[0];
    var viewName = parts[1];
    return db.get('_design/' + designDocName).then(function (doc) {
      var fun = doc.views && doc.views[viewName];

      if (!fun || typeof fun.map !== 'string') {
        throw new NotFoundError('ddoc ' + designDocName + ' has no view named ' +
          viewName);
      }
      checkQueryParseError(opts, fun);

      var createViewOpts = {
        db : db,
        viewName : fullViewName,
        map : fun.map,
        reduce : fun.reduce
      };
      return createView(createViewOpts).then(function (view) {
        if (opts.stale === 'ok' || opts.stale === 'update_after') {
          if (opts.stale === 'update_after') {
            process.nextTick(function () {
              updateView(view);
            });
          }
          return queryView(view, opts);
        } else { // stale not ok
          return updateView(view).then(function () {
            return queryView(view, opts);
          });
        }
      });
    });
  }
}

exports.query = function (fun, opts, callback) {
  if (typeof opts === 'function') {
    callback = opts;
    opts = {};
  }
  opts = utils.extend(true, {}, opts);

  if (typeof fun === 'function') {
    fun = {map : fun};
  }

  var db = this;
  var promise = Promise.resolve().then(function () {
    return queryPromised(db, fun, opts);
  });
  utils.promisedCallback(promise, callback);
  return promise;
};

function QueryParseError(message) {
  this.status = 400;
  this.name = 'query_parse_error';
  this.message = message;
  this.error = true;
  try {
    Error.captureStackTrace(this, QueryParseError);
  } catch (e) {}
}

utils.inherits(QueryParseError, Error);

function NotFoundError(message) {
  this.status = 404;
  this.name = 'not_found';
  this.message = message;
  this.error = true;
  try {
    Error.captureStackTrace(this, NotFoundError);
  } catch (e) {}
}

utils.inherits(NotFoundError, Error);

function BuiltInError(message) {
  this.status = 500;
  this.name = 'invalid_value';
  this.message = message;
  this.error = true;
  try {
    Error.captureStackTrace(this, BuiltInError);
  } catch (e) {}
}

utils.inherits(BuiltInError, Error);
}).call(this,require('_process'))

},{"./create-view":69,"./evalfunc":70,"./taskqueue":72,"./utils":74,"_process":80,"pouchdb-collate":65}],72:[function(require,module,exports){
'use strict';
/*
 * Simple task queue to sequentialize actions. Assumes callbacks will eventually fire (once).
 */

var Promise = require('./utils').Promise;

function TaskQueue() {
  this.promise = new Promise(function (fulfill) {fulfill(); });
}
TaskQueue.prototype.add = function (promiseFactory) {
  this.promise = this.promise["catch"](function () {
    // just recover
  }).then(function () {
    return promiseFactory();
  });
  return this.promise;
};
TaskQueue.prototype.finish = function () {
  return this.promise;
};

module.exports = TaskQueue;

},{"./utils":74}],73:[function(require,module,exports){
'use strict';

var upsert = require('pouchdb-upsert').upsert;

module.exports = function (db, doc, diffFun) {
  return upsert.apply(db, [doc, diffFun]);
};
},{"pouchdb-upsert":75}],74:[function(require,module,exports){
(function (process,global){
'use strict';
/* istanbul ignore if */
if (typeof global.Promise === 'function') {
  exports.Promise = global.Promise;
} else {
  exports.Promise = require('lie');
}

exports.inherits = require('inherits');
exports.extend = require('pouchdb-extend');
var argsarray = require('argsarray');

exports.promisedCallback = function (promise, callback) {
  if (callback) {
    promise.then(function (res) {
      process.nextTick(function () {
        callback(null, res);
      });
    }, function (reason) {
      process.nextTick(function () {
        callback(reason);
      });
    });
  }
  return promise;
};

exports.callbackify = function (fun) {
  return argsarray(function (args) {
    var cb = args.pop();
    var promise = fun.apply(this, args);
    if (typeof cb === 'function') {
      exports.promisedCallback(promise, cb);
    }
    return promise;
  });
};

// Promise finally util similar to Q.finally
exports.fin = function (promise, cb) {
  return promise.then(function (res) {
    var promise2 = cb();
    if (typeof promise2.then === 'function') {
      return promise2.then(function () {
        return res;
      });
    }
    return res;
  }, function (reason) {
    var promise2 = cb();
    if (typeof promise2.then === 'function') {
      return promise2.then(function () {
        throw reason;
      });
    }
    throw reason;
  });
};

exports.sequentialize = function (queue, promiseFactory) {
  return function () {
    var args = arguments;
    var that = this;
    return queue.add(function () {
      return promiseFactory.apply(that, args);
    });
  };
};

exports.flatten = function (arrs) {
  var res = [];
  for (var i = 0, len = arrs.length; i < len; i++) {
    res = res.concat(arrs[i]);
  }
  return res;
};

// uniq an array of strings, order not guaranteed
// similar to underscore/lodash _.uniq
exports.uniq = function (arr) {
  var map = {};

  for (var i = 0, len = arr.length; i < len; i++) {
    map['$' + arr[i]] = true;
  }

  var keys = Object.keys(map);
  var output = new Array(keys.length);

  for (i = 0, len = keys.length; i < len; i++) {
    output[i] = keys[i].substring(1);
  }
  return output;
};

var crypto = require('crypto');
var Md5 = require('spark-md5');

exports.MD5 = function (string) {
  /* istanbul ignore else */
  if (!process.browser) {
    return crypto.createHash('md5').update(string).digest('hex');
  } else {
    return Md5.hash(string);
  }
};
}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"_process":80,"argsarray":42,"crypto":78,"inherits":46,"lie":50,"pouchdb-extend":68,"spark-md5":76}],75:[function(require,module,exports){
(function (global){
'use strict';

var PouchPromise;
/* istanbul ignore next */
if (typeof window !== 'undefined' && window.PouchDB) {
  PouchPromise = window.PouchDB.utils.Promise;
} else {
  PouchPromise = typeof global.Promise === 'function' ? global.Promise : require('lie');
}

// this is essentially the "update sugar" function from daleharvey/pouchdb#1388
// the diffFun tells us what delta to apply to the doc.  it either returns
// the doc, or false if it doesn't need to do an update after all
function upsertInner(db, docId, diffFun) {
  return new PouchPromise(function (fulfill, reject) {
    if (typeof docId !== 'string') {
      return reject(new Error('doc id is required'));
    }

    db.get(docId, function (err, doc) {
      if (err) {
        /* istanbul ignore next */
        if (err.status !== 404) {
          return reject(err);
        }
        doc = {};
      }

      // the user might change the _rev, so save it for posterity
      var docRev = doc._rev;
      var newDoc = diffFun(doc);

      if (!newDoc) {
        // if the diffFun returns falsy, we short-circuit as
        // an optimization
        return fulfill({updated: false, rev: docRev});
      }

      // users aren't allowed to modify these values,
      // so reset them here
      newDoc._id = docId;
      newDoc._rev = docRev;
      fulfill(tryAndPut(db, newDoc, diffFun));
    });
  });
}

function tryAndPut(db, doc, diffFun) {
  return db.put(doc).then(function (res) {
    return {
      updated: true,
      rev: res.rev
    };
  }, function (err) {
    /* istanbul ignore next */
    if (err.status !== 409) {
      throw err;
    }
    return upsertInner(db, doc._id, diffFun);
  });
}

exports.upsert = function upsert(docId, diffFun, cb) {
  var db = this;
  var promise = upsertInner(db, docId, diffFun);
  if (typeof cb !== 'function') {
    return promise;
  }
  promise.then(function (resp) {
    cb(null, resp);
  }, cb);
};

exports.putIfNotExists = function putIfNotExists(docId, doc, cb) {
  var db = this;

  if (typeof docId !== 'string') {
    cb = doc;
    doc = docId;
    docId = doc._id;
  }

  var diffFun = function (existingDoc) {
    if (existingDoc._rev) {
      return false; // do nothing
    }
    return doc;
  };

  var promise = upsertInner(db, docId, diffFun);
  if (typeof cb !== 'function') {
    return promise;
  }
  promise.then(function (resp) {
    cb(null, resp);
  }, cb);
};


/* istanbul ignore next */
if (typeof window !== 'undefined' && window.PouchDB) {
  window.PouchDB.plugin(exports);
}

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"lie":50}],76:[function(require,module,exports){
/*jshint bitwise:false*/
/*global unescape*/

(function (factory) {
    if (typeof exports === 'object') {
        // Node/CommonJS
        module.exports = factory();
    } else if (typeof define === 'function' && define.amd) {
        // AMD
        define(factory);
    } else {
        // Browser globals (with support for web workers)
        var glob;
        try {
            glob = window;
        } catch (e) {
            glob = self;
        }

        glob.SparkMD5 = factory();
    }
}(function (undefined) {

    'use strict';

    ////////////////////////////////////////////////////////////////////////////

    /*
     * Fastest md5 implementation around (JKM md5)
     * Credits: Joseph Myers
     *
     * @see http://www.myersdaily.org/joseph/javascript/md5-text.html
     * @see http://jsperf.com/md5-shootout/7
     */

    /* this function is much faster,
      so if possible we use it. Some IEs
      are the only ones I know of that
      need the idiotic second function,
      generated by an if clause.  */
    var add32 = function (a, b) {
        return (a + b) & 0xFFFFFFFF;
    },

    cmn = function (q, a, b, x, s, t) {
        a = add32(add32(a, q), add32(x, t));
        return add32((a << s) | (a >>> (32 - s)), b);
    },

    ff = function (a, b, c, d, x, s, t) {
        return cmn((b & c) | ((~b) & d), a, b, x, s, t);
    },

    gg = function (a, b, c, d, x, s, t) {
        return cmn((b & d) | (c & (~d)), a, b, x, s, t);
    },

    hh = function (a, b, c, d, x, s, t) {
        return cmn(b ^ c ^ d, a, b, x, s, t);
    },

    ii = function (a, b, c, d, x, s, t) {
        return cmn(c ^ (b | (~d)), a, b, x, s, t);
    },

    md5cycle = function (x, k) {
        var a = x[0],
            b = x[1],
            c = x[2],
            d = x[3];

        a = ff(a, b, c, d, k[0], 7, -680876936);
        d = ff(d, a, b, c, k[1], 12, -389564586);
        c = ff(c, d, a, b, k[2], 17, 606105819);
        b = ff(b, c, d, a, k[3], 22, -1044525330);
        a = ff(a, b, c, d, k[4], 7, -176418897);
        d = ff(d, a, b, c, k[5], 12, 1200080426);
        c = ff(c, d, a, b, k[6], 17, -1473231341);
        b = ff(b, c, d, a, k[7], 22, -45705983);
        a = ff(a, b, c, d, k[8], 7, 1770035416);
        d = ff(d, a, b, c, k[9], 12, -1958414417);
        c = ff(c, d, a, b, k[10], 17, -42063);
        b = ff(b, c, d, a, k[11], 22, -1990404162);
        a = ff(a, b, c, d, k[12], 7, 1804603682);
        d = ff(d, a, b, c, k[13], 12, -40341101);
        c = ff(c, d, a, b, k[14], 17, -1502002290);
        b = ff(b, c, d, a, k[15], 22, 1236535329);

        a = gg(a, b, c, d, k[1], 5, -165796510);
        d = gg(d, a, b, c, k[6], 9, -1069501632);
        c = gg(c, d, a, b, k[11], 14, 643717713);
        b = gg(b, c, d, a, k[0], 20, -373897302);
        a = gg(a, b, c, d, k[5], 5, -701558691);
        d = gg(d, a, b, c, k[10], 9, 38016083);
        c = gg(c, d, a, b, k[15], 14, -660478335);
        b = gg(b, c, d, a, k[4], 20, -405537848);
        a = gg(a, b, c, d, k[9], 5, 568446438);
        d = gg(d, a, b, c, k[14], 9, -1019803690);
        c = gg(c, d, a, b, k[3], 14, -187363961);
        b = gg(b, c, d, a, k[8], 20, 1163531501);
        a = gg(a, b, c, d, k[13], 5, -1444681467);
        d = gg(d, a, b, c, k[2], 9, -51403784);
        c = gg(c, d, a, b, k[7], 14, 1735328473);
        b = gg(b, c, d, a, k[12], 20, -1926607734);

        a = hh(a, b, c, d, k[5], 4, -378558);
        d = hh(d, a, b, c, k[8], 11, -2022574463);
        c = hh(c, d, a, b, k[11], 16, 1839030562);
        b = hh(b, c, d, a, k[14], 23, -35309556);
        a = hh(a, b, c, d, k[1], 4, -1530992060);
        d = hh(d, a, b, c, k[4], 11, 1272893353);
        c = hh(c, d, a, b, k[7], 16, -155497632);
        b = hh(b, c, d, a, k[10], 23, -1094730640);
        a = hh(a, b, c, d, k[13], 4, 681279174);
        d = hh(d, a, b, c, k[0], 11, -358537222);
        c = hh(c, d, a, b, k[3], 16, -722521979);
        b = hh(b, c, d, a, k[6], 23, 76029189);
        a = hh(a, b, c, d, k[9], 4, -640364487);
        d = hh(d, a, b, c, k[12], 11, -421815835);
        c = hh(c, d, a, b, k[15], 16, 530742520);
        b = hh(b, c, d, a, k[2], 23, -995338651);

        a = ii(a, b, c, d, k[0], 6, -198630844);
        d = ii(d, a, b, c, k[7], 10, 1126891415);
        c = ii(c, d, a, b, k[14], 15, -1416354905);
        b = ii(b, c, d, a, k[5], 21, -57434055);
        a = ii(a, b, c, d, k[12], 6, 1700485571);
        d = ii(d, a, b, c, k[3], 10, -1894986606);
        c = ii(c, d, a, b, k[10], 15, -1051523);
        b = ii(b, c, d, a, k[1], 21, -2054922799);
        a = ii(a, b, c, d, k[8], 6, 1873313359);
        d = ii(d, a, b, c, k[15], 10, -30611744);
        c = ii(c, d, a, b, k[6], 15, -1560198380);
        b = ii(b, c, d, a, k[13], 21, 1309151649);
        a = ii(a, b, c, d, k[4], 6, -145523070);
        d = ii(d, a, b, c, k[11], 10, -1120210379);
        c = ii(c, d, a, b, k[2], 15, 718787259);
        b = ii(b, c, d, a, k[9], 21, -343485551);

        x[0] = add32(a, x[0]);
        x[1] = add32(b, x[1]);
        x[2] = add32(c, x[2]);
        x[3] = add32(d, x[3]);
    },

    /* there needs to be support for Unicode here,
       * unless we pretend that we can redefine the MD-5
       * algorithm for multi-byte characters (perhaps
       * by adding every four 16-bit characters and
       * shortening the sum to 32 bits). Otherwise
       * I suggest performing MD-5 as if every character
       * was two bytes--e.g., 0040 0025 = @%--but then
       * how will an ordinary MD-5 sum be matched?
       * There is no way to standardize text to something
       * like UTF-8 before transformation; speed cost is
       * utterly prohibitive. The JavaScript standard
       * itself needs to look at this: it should start
       * providing access to strings as preformed UTF-8
       * 8-bit unsigned value arrays.
       */
    md5blk = function (s) {
        var md5blks = [],
            i; /* Andy King said do it this way. */

        for (i = 0; i < 64; i += 4) {
            md5blks[i >> 2] = s.charCodeAt(i) + (s.charCodeAt(i + 1) << 8) + (s.charCodeAt(i + 2) << 16) + (s.charCodeAt(i + 3) << 24);
        }
        return md5blks;
    },

    md5blk_array = function (a) {
        var md5blks = [],
            i; /* Andy King said do it this way. */

        for (i = 0; i < 64; i += 4) {
            md5blks[i >> 2] = a[i] + (a[i + 1] << 8) + (a[i + 2] << 16) + (a[i + 3] << 24);
        }
        return md5blks;
    },

    md51 = function (s) {
        var n = s.length,
            state = [1732584193, -271733879, -1732584194, 271733878],
            i,
            length,
            tail,
            tmp,
            lo,
            hi;

        for (i = 64; i <= n; i += 64) {
            md5cycle(state, md5blk(s.substring(i - 64, i)));
        }
        s = s.substring(i - 64);
        length = s.length;
        tail = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        for (i = 0; i < length; i += 1) {
            tail[i >> 2] |= s.charCodeAt(i) << ((i % 4) << 3);
        }
        tail[i >> 2] |= 0x80 << ((i % 4) << 3);
        if (i > 55) {
            md5cycle(state, tail);
            for (i = 0; i < 16; i += 1) {
                tail[i] = 0;
            }
        }

        // Beware that the final length might not fit in 32 bits so we take care of that
        tmp = n * 8;
        tmp = tmp.toString(16).match(/(.*?)(.{0,8})$/);
        lo = parseInt(tmp[2], 16);
        hi = parseInt(tmp[1], 16) || 0;

        tail[14] = lo;
        tail[15] = hi;

        md5cycle(state, tail);
        return state;
    },

    md51_array = function (a) {
        var n = a.length,
            state = [1732584193, -271733879, -1732584194, 271733878],
            i,
            length,
            tail,
            tmp,
            lo,
            hi;

        for (i = 64; i <= n; i += 64) {
            md5cycle(state, md5blk_array(a.subarray(i - 64, i)));
        }

        // Not sure if it is a bug, however IE10 will always produce a sub array of length 1
        // containing the last element of the parent array if the sub array specified starts
        // beyond the length of the parent array - weird.
        // https://connect.microsoft.com/IE/feedback/details/771452/typed-array-subarray-issue
        a = (i - 64) < n ? a.subarray(i - 64) : new Uint8Array(0);

        length = a.length;
        tail = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        for (i = 0; i < length; i += 1) {
            tail[i >> 2] |= a[i] << ((i % 4) << 3);
        }

        tail[i >> 2] |= 0x80 << ((i % 4) << 3);
        if (i > 55) {
            md5cycle(state, tail);
            for (i = 0; i < 16; i += 1) {
                tail[i] = 0;
            }
        }

        // Beware that the final length might not fit in 32 bits so we take care of that
        tmp = n * 8;
        tmp = tmp.toString(16).match(/(.*?)(.{0,8})$/);
        lo = parseInt(tmp[2], 16);
        hi = parseInt(tmp[1], 16) || 0;

        tail[14] = lo;
        tail[15] = hi;

        md5cycle(state, tail);

        return state;
    },

    hex_chr = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f'],

    rhex = function (n) {
        var s = '',
            j;
        for (j = 0; j < 4; j += 1) {
            s += hex_chr[(n >> (j * 8 + 4)) & 0x0F] + hex_chr[(n >> (j * 8)) & 0x0F];
        }
        return s;
    },

    hex = function (x) {
        var i;
        for (i = 0; i < x.length; i += 1) {
            x[i] = rhex(x[i]);
        }
        return x.join('');
    },

    md5 = function (s) {
        return hex(md51(s));
    },



    ////////////////////////////////////////////////////////////////////////////

    /**
     * SparkMD5 OOP implementation.
     *
     * Use this class to perform an incremental md5, otherwise use the
     * static methods instead.
     */
    SparkMD5 = function () {
        // call reset to init the instance
        this.reset();
    };


    // In some cases the fast add32 function cannot be used..
    if (md5('hello') !== '5d41402abc4b2a76b9719d911017c592') {
        add32 = function (x, y) {
            var lsw = (x & 0xFFFF) + (y & 0xFFFF),
                msw = (x >> 16) + (y >> 16) + (lsw >> 16);
            return (msw << 16) | (lsw & 0xFFFF);
        };
    }


    /**
     * Appends a string.
     * A conversion will be applied if an utf8 string is detected.
     *
     * @param {String} str The string to be appended
     *
     * @return {SparkMD5} The instance itself
     */
    SparkMD5.prototype.append = function (str) {
        // converts the string to utf8 bytes if necessary
        if (/[\u0080-\uFFFF]/.test(str)) {
            str = unescape(encodeURIComponent(str));
        }

        // then append as binary
        this.appendBinary(str);

        return this;
    };

    /**
     * Appends a binary string.
     *
     * @param {String} contents The binary string to be appended
     *
     * @return {SparkMD5} The instance itself
     */
    SparkMD5.prototype.appendBinary = function (contents) {
        this._buff += contents;
        this._length += contents.length;

        var length = this._buff.length,
            i;

        for (i = 64; i <= length; i += 64) {
            md5cycle(this._state, md5blk(this._buff.substring(i - 64, i)));
        }

        this._buff = this._buff.substr(i - 64);

        return this;
    };

    /**
     * Finishes the incremental computation, reseting the internal state and
     * returning the result.
     * Use the raw parameter to obtain the raw result instead of the hex one.
     *
     * @param {Boolean} raw True to get the raw result, false to get the hex result
     *
     * @return {String|Array} The result
     */
    SparkMD5.prototype.end = function (raw) {
        var buff = this._buff,
            length = buff.length,
            i,
            tail = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            ret;

        for (i = 0; i < length; i += 1) {
            tail[i >> 2] |= buff.charCodeAt(i) << ((i % 4) << 3);
        }

        this._finish(tail, length);
        ret = !!raw ? this._state : hex(this._state);

        this.reset();

        return ret;
    };

    /**
     * Finish the final calculation based on the tail.
     *
     * @param {Array}  tail   The tail (will be modified)
     * @param {Number} length The length of the remaining buffer
     */
    SparkMD5.prototype._finish = function (tail, length) {
        var i = length,
            tmp,
            lo,
            hi;

        tail[i >> 2] |= 0x80 << ((i % 4) << 3);
        if (i > 55) {
            md5cycle(this._state, tail);
            for (i = 0; i < 16; i += 1) {
                tail[i] = 0;
            }
        }

        // Do the final computation based on the tail and length
        // Beware that the final length may not fit in 32 bits so we take care of that
        tmp = this._length * 8;
        tmp = tmp.toString(16).match(/(.*?)(.{0,8})$/);
        lo = parseInt(tmp[2], 16);
        hi = parseInt(tmp[1], 16) || 0;

        tail[14] = lo;
        tail[15] = hi;
        md5cycle(this._state, tail);
    };

    /**
     * Resets the internal state of the computation.
     *
     * @return {SparkMD5} The instance itself
     */
    SparkMD5.prototype.reset = function () {
        this._buff = "";
        this._length = 0;
        this._state = [1732584193, -271733879, -1732584194, 271733878];

        return this;
    };

    /**
     * Releases memory used by the incremental buffer and other aditional
     * resources. If you plan to use the instance again, use reset instead.
     */
    SparkMD5.prototype.destroy = function () {
        delete this._state;
        delete this._buff;
        delete this._length;
    };


    /**
     * Performs the md5 hash on a string.
     * A conversion will be applied if utf8 string is detected.
     *
     * @param {String}  str The string
     * @param {Boolean} raw True to get the raw result, false to get the hex result
     *
     * @return {String|Array} The result
     */
    SparkMD5.hash = function (str, raw) {
        // converts the string to utf8 bytes if necessary
        if (/[\u0080-\uFFFF]/.test(str)) {
            str = unescape(encodeURIComponent(str));
        }

        var hash = md51(str);

        return !!raw ? hash : hex(hash);
    };

    /**
     * Performs the md5 hash on a binary string.
     *
     * @param {String}  content The binary string
     * @param {Boolean} raw     True to get the raw result, false to get the hex result
     *
     * @return {String|Array} The result
     */
    SparkMD5.hashBinary = function (content, raw) {
        var hash = md51(content);

        return !!raw ? hash : hex(hash);
    };

    /**
     * SparkMD5 OOP implementation for array buffers.
     *
     * Use this class to perform an incremental md5 ONLY for array buffers.
     */
    SparkMD5.ArrayBuffer = function () {
        // call reset to init the instance
        this.reset();
    };

    ////////////////////////////////////////////////////////////////////////////

    /**
     * Appends an array buffer.
     *
     * @param {ArrayBuffer} arr The array to be appended
     *
     * @return {SparkMD5.ArrayBuffer} The instance itself
     */
    SparkMD5.ArrayBuffer.prototype.append = function (arr) {
        // TODO: we could avoid the concatenation here but the algorithm would be more complex
        //       if you find yourself needing extra performance, please make a PR.
        var buff = this._concatArrayBuffer(this._buff, arr),
            length = buff.length,
            i;

        this._length += arr.byteLength;

        for (i = 64; i <= length; i += 64) {
            md5cycle(this._state, md5blk_array(buff.subarray(i - 64, i)));
        }

        // Avoids IE10 weirdness (documented above)
        this._buff = (i - 64) < length ? buff.subarray(i - 64) : new Uint8Array(0);

        return this;
    };

    /**
     * Finishes the incremental computation, reseting the internal state and
     * returning the result.
     * Use the raw parameter to obtain the raw result instead of the hex one.
     *
     * @param {Boolean} raw True to get the raw result, false to get the hex result
     *
     * @return {String|Array} The result
     */
    SparkMD5.ArrayBuffer.prototype.end = function (raw) {
        var buff = this._buff,
            length = buff.length,
            tail = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            i,
            ret;

        for (i = 0; i < length; i += 1) {
            tail[i >> 2] |= buff[i] << ((i % 4) << 3);
        }

        this._finish(tail, length);
        ret = !!raw ? this._state : hex(this._state);

        this.reset();

        return ret;
    };

    SparkMD5.ArrayBuffer.prototype._finish = SparkMD5.prototype._finish;

    /**
     * Resets the internal state of the computation.
     *
     * @return {SparkMD5.ArrayBuffer} The instance itself
     */
    SparkMD5.ArrayBuffer.prototype.reset = function () {
        this._buff = new Uint8Array(0);
        this._length = 0;
        this._state = [1732584193, -271733879, -1732584194, 271733878];

        return this;
    };

    /**
     * Releases memory used by the incremental buffer and other aditional
     * resources. If you plan to use the instance again, use reset instead.
     */
    SparkMD5.ArrayBuffer.prototype.destroy = SparkMD5.prototype.destroy;

    /**
     * Concats two array buffers, returning a new one.
     *
     * @param  {ArrayBuffer} first  The first array buffer
     * @param  {ArrayBuffer} second The second array buffer
     *
     * @return {ArrayBuffer} The new array buffer
     */
    SparkMD5.ArrayBuffer.prototype._concatArrayBuffer = function (first, second) {
        var firstLength = first.length,
            result = new Uint8Array(firstLength + second.byteLength);

        result.set(first);
        result.set(new Uint8Array(second), firstLength);

        return result;
    };

    /**
     * Performs the md5 hash on an array buffer.
     *
     * @param {ArrayBuffer} arr The array buffer
     * @param {Boolean}     raw True to get the raw result, false to get the hex result
     *
     * @return {String|Array} The result
     */
    SparkMD5.ArrayBuffer.hash = function (arr, raw) {
        var hash = md51_array(new Uint8Array(arr));

        return !!raw ? hash : hex(hash);
    };

    return SparkMD5;
}));

},{}],77:[function(require,module,exports){
'use strict';

/**
 * Stringify/parse functions that don't operate
 * recursively, so they avoid call stack exceeded
 * errors.
 */
exports.stringify = function stringify(input) {
  var queue = [];
  queue.push({obj: input});

  var res = '';
  var next, obj, prefix, val, i, arrayPrefix, keys, k, key, value, objPrefix;
  while ((next = queue.pop())) {
    obj = next.obj;
    prefix = next.prefix || '';
    val = next.val || '';
    res += prefix;
    if (val) {
      res += val;
    } else if (typeof obj !== 'object') {
      res += typeof obj === 'undefined' ? null : JSON.stringify(obj);
    } else if (obj === null) {
      res += 'null';
    } else if (Array.isArray(obj)) {
      queue.push({val: ']'});
      for (i = obj.length - 1; i >= 0; i--) {
        arrayPrefix = i === 0 ? '' : ',';
        queue.push({obj: obj[i], prefix: arrayPrefix});
      }
      queue.push({val: '['});
    } else { // object
      keys = [];
      for (k in obj) {
        if (obj.hasOwnProperty(k)) {
          keys.push(k);
        }
      }
      queue.push({val: '}'});
      for (i = keys.length - 1; i >= 0; i--) {
        key = keys[i];
        value = obj[key];
        objPrefix = (i > 0 ? ',' : '');
        objPrefix += JSON.stringify(key) + ':';
        queue.push({obj: value, prefix: objPrefix});
      }
      queue.push({val: '{'});
    }
  }
  return res;
};

// Convenience function for the parse function.
// This pop function is basically copied from
// pouchCollate.parseIndexableString
function pop(obj, stack, metaStack) {
  var lastMetaElement = metaStack[metaStack.length - 1];
  if (obj === lastMetaElement.element) {
    // popping a meta-element, e.g. an object whose value is another object
    metaStack.pop();
    lastMetaElement = metaStack[metaStack.length - 1];
  }
  var element = lastMetaElement.element;
  var lastElementIndex = lastMetaElement.index;
  if (Array.isArray(element)) {
    element.push(obj);
  } else if (lastElementIndex === stack.length - 2) { // obj with key+value
    var key = stack.pop();
    element[key] = obj;
  } else {
    stack.push(obj); // obj with key only
  }
}

exports.parse = function (str) {
  var stack = [];
  var metaStack = []; // stack for arrays and objects
  var i = 0;
  var collationIndex,parsedNum,numChar;
  var parsedString,lastCh,numConsecutiveSlashes,ch;
  var arrayElement, objElement;
  while (true) {
    collationIndex = str[i++];
    if (collationIndex === '}' ||
        collationIndex === ']' ||
        typeof collationIndex === 'undefined') {
      if (stack.length === 1) {
        return stack.pop();
      } else {
        pop(stack.pop(), stack, metaStack);
        continue;
      }
    }
    switch (collationIndex) {
      case ' ':
      case '\t':
      case '\n':
      case ':':
      case ',':
        break;
      case 'n':
        i += 3; // 'ull'
        pop(null, stack, metaStack);
        break;
      case 't':
        i += 3; // 'rue'
        pop(true, stack, metaStack);
        break;
      case 'f':
        i += 4; // 'alse'
        pop(false, stack, metaStack);
        break;
      case '0':
      case '1':
      case '2':
      case '3':
      case '4':
      case '5':
      case '6':
      case '7':
      case '8':
      case '9':
      case '-':
        parsedNum = '';
        i--;
        while (true) {
          numChar = str[i++];
          if (/[\d\.\-e\+]/.test(numChar)) {
            parsedNum += numChar;
          } else {
            i--;
            break;
          }
        }
        pop(parseFloat(parsedNum), stack, metaStack);
        break;
      case '"':
        parsedString = '';
        lastCh = void 0;
        numConsecutiveSlashes = 0;
        while (true) {
          ch = str[i++];
          if (ch !== '"' || (lastCh === '\\' &&
              numConsecutiveSlashes % 2 === 1)) {
            parsedString += ch;
            lastCh = ch;
            if (lastCh === '\\') {
              numConsecutiveSlashes++;
            } else {
              numConsecutiveSlashes = 0;
            }
          } else {
            break;
          }
        }
        pop(JSON.parse('"' + parsedString + '"'), stack, metaStack);
        break;
      case '[':
        arrayElement = { element: [], index: stack.length };
        stack.push(arrayElement.element);
        metaStack.push(arrayElement);
        break;
      case '{':
        objElement = { element: {}, index: stack.length };
        stack.push(objElement.element);
        metaStack.push(objElement);
        break;
      default:
        throw new Error(
          'unexpectedly reached end of input: ' + collationIndex);
    }
  }
};

},{}],78:[function(require,module,exports){

},{}],79:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

function EventEmitter() {
  this._events = this._events || {};
  this._maxListeners = this._maxListeners || undefined;
}
module.exports = EventEmitter;

// Backwards-compat with node 0.10.x
EventEmitter.EventEmitter = EventEmitter;

EventEmitter.prototype._events = undefined;
EventEmitter.prototype._maxListeners = undefined;

// By default EventEmitters will print a warning if more than 10 listeners are
// added to it. This is a useful default which helps finding memory leaks.
EventEmitter.defaultMaxListeners = 10;

// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
EventEmitter.prototype.setMaxListeners = function(n) {
  if (!isNumber(n) || n < 0 || isNaN(n))
    throw TypeError('n must be a positive number');
  this._maxListeners = n;
  return this;
};

EventEmitter.prototype.emit = function(type) {
  var er, handler, len, args, i, listeners;

  if (!this._events)
    this._events = {};

  // If there is no 'error' event listener then throw.
  if (type === 'error') {
    if (!this._events.error ||
        (isObject(this._events.error) && !this._events.error.length)) {
      er = arguments[1];
      if (er instanceof Error) {
        throw er; // Unhandled 'error' event
      }
      throw TypeError('Uncaught, unspecified "error" event.');
    }
  }

  handler = this._events[type];

  if (isUndefined(handler))
    return false;

  if (isFunction(handler)) {
    switch (arguments.length) {
      // fast cases
      case 1:
        handler.call(this);
        break;
      case 2:
        handler.call(this, arguments[1]);
        break;
      case 3:
        handler.call(this, arguments[1], arguments[2]);
        break;
      // slower
      default:
        len = arguments.length;
        args = new Array(len - 1);
        for (i = 1; i < len; i++)
          args[i - 1] = arguments[i];
        handler.apply(this, args);
    }
  } else if (isObject(handler)) {
    len = arguments.length;
    args = new Array(len - 1);
    for (i = 1; i < len; i++)
      args[i - 1] = arguments[i];

    listeners = handler.slice();
    len = listeners.length;
    for (i = 0; i < len; i++)
      listeners[i].apply(this, args);
  }

  return true;
};

EventEmitter.prototype.addListener = function(type, listener) {
  var m;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events)
    this._events = {};

  // To avoid recursion in the case that type === "newListener"! Before
  // adding it to the listeners, first emit "newListener".
  if (this._events.newListener)
    this.emit('newListener', type,
              isFunction(listener.listener) ?
              listener.listener : listener);

  if (!this._events[type])
    // Optimize the case of one listener. Don't need the extra array object.
    this._events[type] = listener;
  else if (isObject(this._events[type]))
    // If we've already got an array, just append.
    this._events[type].push(listener);
  else
    // Adding the second element, need to change to array.
    this._events[type] = [this._events[type], listener];

  // Check for listener leak
  if (isObject(this._events[type]) && !this._events[type].warned) {
    var m;
    if (!isUndefined(this._maxListeners)) {
      m = this._maxListeners;
    } else {
      m = EventEmitter.defaultMaxListeners;
    }

    if (m && m > 0 && this._events[type].length > m) {
      this._events[type].warned = true;
      console.error('(node) warning: possible EventEmitter memory ' +
                    'leak detected. %d listeners added. ' +
                    'Use emitter.setMaxListeners() to increase limit.',
                    this._events[type].length);
      if (typeof console.trace === 'function') {
        // not supported in IE 10
        console.trace();
      }
    }
  }

  return this;
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.once = function(type, listener) {
  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  var fired = false;

  function g() {
    this.removeListener(type, g);

    if (!fired) {
      fired = true;
      listener.apply(this, arguments);
    }
  }

  g.listener = listener;
  this.on(type, g);

  return this;
};

// emits a 'removeListener' event iff the listener was removed
EventEmitter.prototype.removeListener = function(type, listener) {
  var list, position, length, i;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events || !this._events[type])
    return this;

  list = this._events[type];
  length = list.length;
  position = -1;

  if (list === listener ||
      (isFunction(list.listener) && list.listener === listener)) {
    delete this._events[type];
    if (this._events.removeListener)
      this.emit('removeListener', type, listener);

  } else if (isObject(list)) {
    for (i = length; i-- > 0;) {
      if (list[i] === listener ||
          (list[i].listener && list[i].listener === listener)) {
        position = i;
        break;
      }
    }

    if (position < 0)
      return this;

    if (list.length === 1) {
      list.length = 0;
      delete this._events[type];
    } else {
      list.splice(position, 1);
    }

    if (this._events.removeListener)
      this.emit('removeListener', type, listener);
  }

  return this;
};

EventEmitter.prototype.removeAllListeners = function(type) {
  var key, listeners;

  if (!this._events)
    return this;

  // not listening for removeListener, no need to emit
  if (!this._events.removeListener) {
    if (arguments.length === 0)
      this._events = {};
    else if (this._events[type])
      delete this._events[type];
    return this;
  }

  // emit removeListener for all listeners on all events
  if (arguments.length === 0) {
    for (key in this._events) {
      if (key === 'removeListener') continue;
      this.removeAllListeners(key);
    }
    this.removeAllListeners('removeListener');
    this._events = {};
    return this;
  }

  listeners = this._events[type];

  if (isFunction(listeners)) {
    this.removeListener(type, listeners);
  } else {
    // LIFO order
    while (listeners.length)
      this.removeListener(type, listeners[listeners.length - 1]);
  }
  delete this._events[type];

  return this;
};

EventEmitter.prototype.listeners = function(type) {
  var ret;
  if (!this._events || !this._events[type])
    ret = [];
  else if (isFunction(this._events[type]))
    ret = [this._events[type]];
  else
    ret = this._events[type].slice();
  return ret;
};

EventEmitter.listenerCount = function(emitter, type) {
  var ret;
  if (!emitter._events || !emitter._events[type])
    ret = 0;
  else if (isFunction(emitter._events[type]))
    ret = 1;
  else
    ret = emitter._events[type].length;
  return ret;
};

function isFunction(arg) {
  return typeof arg === 'function';
}

function isNumber(arg) {
  return typeof arg === 'number';
}

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}

function isUndefined(arg) {
  return arg === void 0;
}

},{}],80:[function(require,module,exports){
// shim for using process in browser

var process = module.exports = {};
var queue = [];
var draining = false;

function drainQueue() {
    if (draining) {
        return;
    }
    draining = true;
    var currentQueue;
    var len = queue.length;
    while(len) {
        currentQueue = queue;
        queue = [];
        var i = -1;
        while (++i < len) {
            currentQueue[i]();
        }
        len = queue.length;
    }
    draining = false;
}
process.nextTick = function (fun) {
    queue.push(fun);
    if (!draining) {
        setTimeout(drainQueue, 0);
    }
};

process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];
process.version = ''; // empty string to avoid regexp issues
process.versions = {};

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

// TODO(shtylman)
process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};
process.umask = function() { return 0; };

},{}]},{},[1])
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3Vzci9saWIvbm9kZV9tb2R1bGVzL3dhdGNoaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJpbmRleC5qcyIsImxpYi9nZXRUcmVlLmpzIiwibGliL21pblVuaXEuanMiLCJsaWIvdmlzdWFsaXplUmV2VHJlZS5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL2xpYi9hZGFwdGVyLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbGliL2FkYXB0ZXJzL2h0dHAvaHR0cC5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL2xpYi9hZGFwdGVycy9pZGIvaWRiLWFsbC1kb2NzLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbGliL2FkYXB0ZXJzL2lkYi9pZGItYmxvYi1zdXBwb3J0LmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbGliL2FkYXB0ZXJzL2lkYi9pZGItYnVsay1kb2NzLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbGliL2FkYXB0ZXJzL2lkYi9pZGItY29uc3RhbnRzLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbGliL2FkYXB0ZXJzL2lkYi9pZGItdXRpbHMuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9saWIvYWRhcHRlcnMvaWRiL2lkYi5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL2xpYi9hZGFwdGVycy9wcmVmZXJyZWRBZGFwdGVycy1icm93c2VyLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbGliL2FkYXB0ZXJzL3dlYnNxbC93ZWJzcWwtYnVsay1kb2NzLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbGliL2FkYXB0ZXJzL3dlYnNxbC93ZWJzcWwtY29uc3RhbnRzLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbGliL2FkYXB0ZXJzL3dlYnNxbC93ZWJzcWwtdXRpbHMuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9saWIvYWRhcHRlcnMvd2Vic3FsL3dlYnNxbC5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL2xpYi9jaGFuZ2VzLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbGliL2NoZWNrcG9pbnRlci5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL2xpYi9jb25zdHJ1Y3Rvci5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL2xpYi9kZXBzL2FqYXguanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9saWIvZGVwcy9ibG9iLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbGliL2RlcHMvYnVmZmVyLWJyb3dzZXIuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9saWIvZGVwcy9lcnJvcnMuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9saWIvZGVwcy9tZDUuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9saWIvZGVwcy9wYXJzZS1kb2MuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9saWIvZGVwcy9wYXJzZS1oZXguanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9saWIvZGVwcy9wYXJzZS11cmkuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9saWIvZGVwcy9yZXF1ZXN0LWJyb3dzZXIuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9saWIvZGVwcy91cHNlcnQuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9saWIvZGVwcy91dWlkLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbGliL2V2YWxGaWx0ZXIuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9saWIvZXZhbFZpZXcuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9saWIvaW5kZXguanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9saWIvbWVyZ2UuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9saWIvcmVwbGljYXRlLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbGliL3NldHVwLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbGliL3N5bmMuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9saWIvdGFza3F1ZXVlLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbGliL3V0aWxzLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbGliL3ZlcnNpb24tYnJvd3Nlci5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL25vZGVfbW9kdWxlcy9hcmdzYXJyYXkvaW5kZXguanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9ub2RlX21vZHVsZXMvZGVidWcvYnJvd3Nlci5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL25vZGVfbW9kdWxlcy9kZWJ1Zy9kZWJ1Zy5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL25vZGVfbW9kdWxlcy9kZWJ1Zy9ub2RlX21vZHVsZXMvbXMvaW5kZXguanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9ub2RlX21vZHVsZXMvaW5oZXJpdHMvaW5oZXJpdHNfYnJvd3Nlci5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL25vZGVfbW9kdWxlcy9saWUvbGliL0lOVEVSTkFMLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbm9kZV9tb2R1bGVzL2xpZS9saWIvYWxsLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbm9kZV9tb2R1bGVzL2xpZS9saWIvaGFuZGxlcnMuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9ub2RlX21vZHVsZXMvbGllL2xpYi9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL25vZGVfbW9kdWxlcy9saWUvbGliL3Byb21pc2UuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9ub2RlX21vZHVsZXMvbGllL2xpYi9xdWV1ZUl0ZW0uanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9ub2RlX21vZHVsZXMvbGllL2xpYi9yYWNlLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbm9kZV9tb2R1bGVzL2xpZS9saWIvcmVqZWN0LmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbm9kZV9tb2R1bGVzL2xpZS9saWIvcmVzb2x2ZS5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL25vZGVfbW9kdWxlcy9saWUvbGliL3Jlc29sdmVUaGVuYWJsZS5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL25vZGVfbW9kdWxlcy9saWUvbGliL3N0YXRlcy5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL25vZGVfbW9kdWxlcy9saWUvbGliL3RyeUNhdGNoLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbm9kZV9tb2R1bGVzL2xpZS9saWIvdW53cmFwLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbm9kZV9tb2R1bGVzL2xpZS9ub2RlX21vZHVsZXMvaW1tZWRpYXRlL2xpYi9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL25vZGVfbW9kdWxlcy9saWUvbm9kZV9tb2R1bGVzL2ltbWVkaWF0ZS9saWIvbWVzc2FnZUNoYW5uZWwuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9ub2RlX21vZHVsZXMvbGllL25vZGVfbW9kdWxlcy9pbW1lZGlhdGUvbGliL211dGF0aW9uLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbm9kZV9tb2R1bGVzL2xpZS9ub2RlX21vZHVsZXMvaW1tZWRpYXRlL2xpYi9zdGF0ZUNoYW5nZS5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL25vZGVfbW9kdWxlcy9saWUvbm9kZV9tb2R1bGVzL2ltbWVkaWF0ZS9saWIvdGltZW91dC5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL25vZGVfbW9kdWxlcy9wb3VjaGRiLWNvbGxhdGUvbGliL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbm9kZV9tb2R1bGVzL3BvdWNoZGItY29sbGF0ZS9saWIvdXRpbHMuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9ub2RlX21vZHVsZXMvcG91Y2hkYi1jb2xsZWN0aW9ucy9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL25vZGVfbW9kdWxlcy9wb3VjaGRiLWV4dGVuZC9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL25vZGVfbW9kdWxlcy9wb3VjaGRiLW1hcHJlZHVjZS9jcmVhdGUtdmlldy5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL25vZGVfbW9kdWxlcy9wb3VjaGRiLW1hcHJlZHVjZS9ldmFsZnVuYy5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL25vZGVfbW9kdWxlcy9wb3VjaGRiLW1hcHJlZHVjZS9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL25vZGVfbW9kdWxlcy9wb3VjaGRiLW1hcHJlZHVjZS90YXNrcXVldWUuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9ub2RlX21vZHVsZXMvcG91Y2hkYi1tYXByZWR1Y2UvdXBzZXJ0LmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbm9kZV9tb2R1bGVzL3BvdWNoZGItbWFwcmVkdWNlL3V0aWxzLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbm9kZV9tb2R1bGVzL3BvdWNoZGItdXBzZXJ0L2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbm9kZV9tb2R1bGVzL3NwYXJrLW1kNS9zcGFyay1tZDUuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9ub2RlX21vZHVsZXMvdnV2dXplbGEvaW5kZXguanMiLCIuLi8uLi8uLi8uLi91c3IvbGliL25vZGVfbW9kdWxlcy93YXRjaGlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnJvd3Nlci1yZXNvbHZlL2VtcHR5LmpzIiwiLi4vLi4vLi4vLi4vdXNyL2xpYi9ub2RlX21vZHVsZXMvd2F0Y2hpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2V2ZW50cy9ldmVudHMuanMiLCIuLi8uLi8uLi8uLi91c3IvbGliL25vZGVfbW9kdWxlcy93YXRjaGlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvcHJvY2Vzcy9icm93c2VyLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1SEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbkJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2UUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUMxeEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQzNpQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdkxBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM5REE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN6V0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDekJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7Ozs7QUNsUEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUNuOEJBOztBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNuVUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ25PQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeC9CQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDOVBBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQ3BHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7OztBQ3pLQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7O0FDeklBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUM1QkE7QUFDQTs7QUNEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQ3BRQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7O0FDL0VBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdEtBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2xFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzR0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNQQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbkZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDVkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUNwQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQ3pCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1U0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdG5CQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDck1BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeExBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDcEVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUN2ekJBO0FBQ0E7O0FDREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL0tBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNyTUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM0hBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNKQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDTEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdkNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDVkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDakNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDSkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUN4REE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7OztBQ2pCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7Ozs7QUNyQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7O0FDdkJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqV0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDckVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdEVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNuTEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzdFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDTkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUN0MkJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQ05BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7OztBQ3pHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7O0FDdkdBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2bEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM3S0E7O0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM3U0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCJ2YXIgQ09SU19QUk9YWSA9ICAnaHR0cDovL25vZGVqcy1uZW9qc2tpLnJoY2xvdWQuY29tLyc7XG5cbnZhciBQb3VjaERCID0gcmVxdWlyZSgncG91Y2hkYicpO1xudmFyIHZpc3VhbGl6ZVJldlRyZWUgPSByZXF1aXJlKCcuL2xpYi92aXN1YWxpemVSZXZUcmVlJyk7XG5cbnZhciBleHBvcnRXcmFwcGVyID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydCcpO1xudmFyIHBsYWNlaG9sZGVyID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3N2Z1BsYWNlaG9sZGVyJyk7XG52YXIgaW5mbyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdpbmZvJyk7XG52YXIgc3VibWl0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3N1Ym1pdCcpO1xuXG52YXIgZXJyb3IgPSBmdW5jdGlvbihlcnIpIHtcbiAgY29uc29sZS5sb2coZXJyKTtcbiAgdmFyIHN0ciA9ICcnO1xuICBpZiAoZXJyLmVycm9yKSB7XG4gICAgc3RyID0gJ2Vycm9yOiAnICsgZXJyLmVycm9yICsgJywgcmVhc29uOiAnICsgZXJyLnRvU3RyaW5nKCk7XG4gIH0gZWxzZSB7XG4gICAgc3RyID0gZXJyLnRvU3RyaW5nKCk7XG4gIH1cbiAgaW5mby5pbm5lckhUTUwgPSBcIldlIGVuY291bnRlcmVkIGFuIGVycm9yOiBcIiArIHN0cjtcbiAgc3VibWl0LnJlbW92ZUF0dHJpYnV0ZSgnZGlzYWJsZWQnKTtcbiAgZXhwb3J0V3JhcHBlci5zdHlsZS5kaXNwbGF5ID0gJ25vbmUnO1xufTtcblxuZnVuY3Rpb24gcGFyc2VVcmwoc3RyKSB7XG4gIHZhciB1cmwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdhJyk7XG4gIHVybC5ocmVmID0gc3RyO1xuICB2YXIgcGF0aCA9IHVybC5wYXRobmFtZS5zcGxpdCgnLycpO1xuXG4gIC8vIFJlbW92ZSAnJyBjYXVzZSBieSBwcmVjZWVkaW5nIC9cbiAgcGF0aC5zaGlmdCgpO1xuXG4gIHVybC5kYiA9IHBhdGguc2hpZnQoKTtcbiAgdXJsLmRvYyA9IHBhdGguam9pbignLycpO1xuXG4gIHVybC5kYlVybCA9IHVybC5wcm90b2NvbCArICcvLycgKyB1cmwuaG9zdCArICcvJyArIHVybC5kYjtcblxuICByZXR1cm4gdXJsO1xufVxuXG5mdW5jdGlvbiBpc0xvY2FsaG9zdChzdHIpIHtcbiAgdmFyIHVybCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2EnKTtcbiAgdXJsLmhyZWYgPSBzdHI7XG4gIHJldHVybiB1cmwuaG9zdCA9PT0gJ2xvY2FsaG9zdCcgfHwgdXJsLmhvc3QgPT09ICcxMjcuMC4wLjEnO1xufVxuXG5mdW5jdGlvbiBpbml0REIoZGJVcmwpIHtcbiAgcmV0dXJuIG5ldyBQb3VjaERCKGRiVXJsKS5jYXRjaChmdW5jdGlvbiAoZXJyKSB7XG4gICAgY29uc29sZS5sb2coJ2ZpcnN0IHRyeSBlcnJvcicsIGVycik7XG5cbiAgICBpZiAoaXNMb2NhbGhvc3QoZGJVcmwpICYmICFpc0xvY2FsaG9zdChsb2NhdGlvbi5ocmVmKSkge1xuICAgICAgYWxlcnQoJ0Nhbm5vdCByZWFjaCB5b3VyIGxvY2FsaG9zdCBmcm9tIHRoZSB3ZWIuIFRyeSBzb21ldGhpbmcgb25saW5lLicpO1xuICAgICAgdGhyb3cgJ0xvY2FsaG9zdCBub3QgcG9zc2libGUnO1xuICAgIH1cblxuICAgIC8vIExpa2VseSBhIENPUlMgcHJvYmxlbVxuICAgIGlmIChlcnIgJiYgZXJyLnN0YXR1cyA9PT0gNTAwKSB7XG4gICAgICBlcnJvcignUmUtdHJ5aW5nIHdpdGggY29ycyBwcm94eS4nKVxuXG4gICAgICBkYlVybCA9IENPUlNfUFJPWFkgKyBkYlVybC5yZXBsYWNlKC9odHRwcz86XFwvXFwvLywgJycpO1xuICAgICAgcmV0dXJuIG5ldyBQb3VjaERCKGRiVXJsKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgZXJyO1xuICAgIH1cbiAgfSk7XG59XG5cbmZ1bmN0aW9uIGRvVmlzdWFsaXNhdGlvbih1cmxTdHIpIHtcblxuICBwbGFjZWhvbGRlci5pbm5lckhUTUwgPSAnJztcbiAgaW5mby5pbm5lckhUTUwgPSAnTG9hZGluZyAuLi4nO1xuICBleHBvcnRXcmFwcGVyLnN0eWxlLmRpc3BsYXkgPSAnbm9uZSc7XG4gIHN1Ym1pdC5zZXRBdHRyaWJ1dGUoJ2Rpc2FibGVkJywgJ2Rpc2FibGVkJyk7XG5cbiAgdmFyIHVybCA9IHBhcnNlVXJsKHVybFN0cik7XG5cbiAgaW5pdERCKHVybC5kYlVybCkudGhlbihmdW5jdGlvbihkYikge1xuICAgIHJldHVybiB2aXN1YWxpemVSZXZUcmVlKGRiLCB1cmwuZG9jKS50aGVuKGZ1bmN0aW9uKGJveCkge1xuICAgICAgdmFyIHN2ZyA9IGJveC5nZXRFbGVtZW50c0J5VGFnTmFtZSgnc3ZnJylbMF07XG4gICAgICBzdmcuc3R5bGUud2lkdGggPSBzdmcuZ2V0QXR0cmlidXRlKCd2aWV3Qm94Jykuc3BsaXQoJyAnKVsyXSAqIDcgKyAncHgnO1xuICAgICAgc3ZnLnN0eWxlLmhlaWdodCA9IHN2Zy5nZXRBdHRyaWJ1dGUoJ3ZpZXdCb3gnKS5zcGxpdCgnICcpWzNdICogNyArICdweCc7XG5cbiAgICAgIHBsYWNlaG9sZGVyLmFwcGVuZENoaWxkKGJveCk7XG4gICAgICBpbmZvLmlubmVySFRNTCA9ICcnO1xuICAgICAgZXhwb3J0V3JhcHBlci5zdHlsZS5kaXNwbGF5ID0gJ2Jsb2NrJztcbiAgICAgIHN1Ym1pdC5yZW1vdmVBdHRyaWJ1dGUoJ2Rpc2FibGVkJyk7XG4gICAgfSk7XG4gIH0sIGVycm9yKTtcbn1cblxuZnVuY3Rpb24gZXhwb3J0RG9jKCkge1xuICB2YXIgdXJsID0gcGFyc2VVcmwoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3VybCcpLnZhbHVlKTtcbiAgaW5pdERCKHVybC5kYlVybCkudGhlbihmdW5jdGlvbiAoZGIpIHtcbiAgICByZXR1cm4gZGIuZ2V0KHVybC5kb2MsIHtyZXZzOiB0cnVlLCBvcGVuX3JldnM6IFwiYWxsXCJ9KS50aGVuKGZ1bmN0aW9uKHJlc3VsdHMpIHtcbiAgICAgIHZhciBkb2NzID0gcmVzdWx0cy5tYXAoZnVuY3Rpb24ocm93KXtcbiAgICAgICAgcmV0dXJuIHJvdy5vaztcbiAgICAgIH0pO1xuICAgICAgY29uc29sZS5sb2coXCJFeHBvcnRlZCBkb2NzOiBcIiwgSlNPTi5zdHJpbmdpZnkoZG9jcykpO1xuICAgICAgY29uc29sZS5sb2coXCJQb3VjaGRiIGZvcm1hdDogXCIsIFwiZGIuYnVsa0RvY3Moe2RvY3M6XCIgK1xuICAgICAgICAgICAgICAgICAgSlNPTi5zdHJpbmdpZnkoZG9jcykgK1xuICAgICAgICAgICAgICAgICAgXCJ9LCB7bmV3X2VkaXRzOmZhbHNlfSwgZnVuY3Rpb24oZXJyLCByZXMpe30pXCIpO1xuICAgIH0pO1xuICB9LCBlcnJvcik7XG59XG5cbmZ1bmN0aW9uIHBhcnNlQXJncygpIHtcbiAgdmFyIHF1ZXJ5ID0gbG9jYXRpb24uc2VhcmNoLnN1YnN0cigxKTtcbiAgdmFyIGRhdGEgPSBxdWVyeS5zcGxpdChcIiZcIik7XG4gIHZhciByZXN1bHQgPSB7fTtcbiAgZm9yKHZhciBpID0gMDsgaSA8IGRhdGEubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgaXRlbSA9IGRhdGFbaV0uc3BsaXQoXCI9XCIpO1xuICAgIHJlc3VsdFtpdGVtWzBdXSA9IGRlY29kZVVSSUNvbXBvbmVudChpdGVtWzFdKTtcbiAgfVxuICByZXR1cm4gcmVzdWx0O1xufVxuXG5kb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0QnV0dG9uJykuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCBleHBvcnREb2MpO1xuXG52YXIgYXJncyA9IHBhcnNlQXJncygpO1xuaWYgKGFyZ3MudXJsKSB7XG4gIC8vIEJyb3dzZXJzIGFyZSBzdHVwaWQgYW5kIHNvbWV0aW1lcyBhZGQgYSAvIHRvIHRoZSBlbmQgb2YgdGhlIHF1ZXJ5IHBhcmFtXG4gIHZhciB1cmwgPSBhcmdzLnVybC5yZXBsYWNlKC9cXC8rJC8sIFwiXCIpO1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndXJsJykudmFsdWUgPSB1cmw7XG4gIGRvVmlzdWFsaXNhdGlvbih1cmwpO1xufVxuIiwibW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoZGIsIGRvY0lkKSB7XG4gIHJldHVybiBkYi5nZXQoZG9jSWQpLmNhdGNoKGZ1bmN0aW9uIChlcnIpIHtcbiAgICBpZiAoZXJyLnJlYXNvbiAhPT0gXCJkZWxldGVkXCIpIHtcbiAgICAgIHRocm93IGVycjtcbiAgICB9XG4gIH0pLnRoZW4oZnVuY3Rpb24oZG9jKXsgLy8gZ2V0IHdpbm5pbmcgcmV2aXNpb24gaGVyZVxuICAgIHZhciB3aW5uZXIgPSBkb2MuX3JldjtcbiAgICByZXR1cm4gZGIuZ2V0KGRvY0lkLCB7cmV2czogdHJ1ZSwgb3Blbl9yZXZzOiBcImFsbFwifSkudGhlbihmdW5jdGlvbihyZXN1bHRzKXtcbiAgICAgIHZhciBkZWxldGVkID0ge307XG4gICAgICB2YXIgcGF0aHMgPSByZXN1bHRzLm1hcChmdW5jdGlvbihyZXMpIHtcbiAgICAgICAgcmVzID0gcmVzLm9rOyAvLyBUT0RPOiB3aGF0IGFib3V0IG1pc3NpbmdcbiAgICAgICAgaWYgKHJlcy5fZGVsZXRlZCkge1xuICAgICAgICAgIGRlbGV0ZWRbcmVzLl9yZXZdID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgICB2YXIgcmV2cyA9IHJlcy5fcmV2aXNpb25zO1xuICAgICAgICByZXR1cm4gcmV2cy5pZHMubWFwKGZ1bmN0aW9uKGlkLCBpKSB7XG4gICAgICAgICAgcmV0dXJuIChyZXZzLnN0YXJ0LWkpICsgJy0nICsgaWQ7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBwYXRoczogcGF0aHMsXG4gICAgICAgIGRlbGV0ZWQ6IGRlbGV0ZWQsXG4gICAgICAgIHdpbm5lcjogd2lubmVyXG4gICAgICB9O1xuICAgIH0pO1xuICB9KTtcbn07XG4iLCIvLyByZXR1cm5zIG1pbmltYWwgbnVtYmVyIGkgc3VjaCB0aGF0IHByZWZpeGVzIG9mIGxlbmdodCBpIGFyZSB1bmlxdWVcbi8vIGV4OiBbXCJ4eWFhYVwiLCBcInh5YmJiXCIsIFwieHliY2NjXCJdIC0+IDRcbmZ1bmN0aW9uIHN0ckNvbW1vbihhLCBiKXtcbiAgaWYgKGEgPT09IGIpIHJldHVybiBhLmxlbmd0aDtcbiAgdmFyIGkgPSAwO1xuICB3aGlsZSgrK2kpe1xuICAgIGlmKGFbaSAtIDFdICE9PSBiW2kgLSAxXSkgcmV0dXJuIGk7XG4gIH1cbn1cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihhcnIpe1xuICB2YXIgYXJyYXkgPSBhcnIuc2xpY2UoMCk7XG4gIHZhciBjb20gPSAxO1xuICBhcnJheS5zb3J0KCk7XG4gIGZvciAodmFyIGkgPSAxOyBpIDwgYXJyYXkubGVuZ3RoOyBpKyspe1xuICAgIGNvbSA9IE1hdGgubWF4KGNvbSwgc3RyQ29tbW9uKGFycmF5W2ldLCBhcnJheVtpIC0gMV0pKTtcbiAgfVxuICByZXR1cm4gY29tO1xufTtcbiIsIlwidXNlIHN0cmljdFwiO1xuXG52YXIgZ2V0VHJlZSA9IHJlcXVpcmUoJy4vZ2V0VHJlZScpO1xudmFyIG1pblVuaXEgPSByZXF1aXJlKCcuL21pblVuaXEnKTtcblxudmFyIGdyaWQgPSAxMDtcbnZhciBzY2FsZSA9IDc7XG52YXIgciA9IDE7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oZGIsIGRvY0lkLCBjYWxsYmFjaykge1xuICBmdW5jdGlvbiBkcmF3KHBhdGhzLCBkZWxldGVkLCB3aW5uZXIsIG1pblVuaXEpe1xuICAgIHZhciBtYXhYID0gZ3JpZDtcbiAgICB2YXIgbWF4WSA9IGdyaWQ7XG4gICAgdmFyIGxldmVsQ291bnQgPSBbXTsgLy8gbnVtZXIgb2Ygbm9kZXMgb24gc29tZSBsZXZlbCAocG9zKVxuXG4gICAgdmFyIG1hcCA9IHt9OyAvLyBtYXAgZnJvbSByZXYgdG8gcG9zaXRpb25cbiAgICB2YXIgbGV2ZWxDb3VudCA9IFtdO1xuXG4gICAgZnVuY3Rpb24gZHJhd1BhdGgocGF0aCkge1xuICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBwYXRoLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIHZhciByZXYgPSBwYXRoW2ldO1xuICAgICAgICB2YXIgaXNMZWFmID0gaSA9PT0gMDtcbiAgICAgICAgdmFyIHBvcyA9ICtyZXYuc3BsaXQoJy0nKVswXTtcblxuICAgICAgICBpZiAoIWxldmVsQ291bnRbcG9zXSkge1xuICAgICAgICAgIGxldmVsQ291bnRbcG9zXSA9IDE7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHggPSBsZXZlbENvdW50W3Bvc10gKiBncmlkO1xuICAgICAgICB2YXIgeSA9IHBvcyAqIGdyaWQ7XG5cbiAgICAgICAgaWYgKCFpc0xlYWYpIHtcbiAgICAgICAgICB2YXIgbmV4dFJldiA9IHBhdGhbaS0xXTtcbiAgICAgICAgICB2YXIgbmV4dFggPSBtYXBbbmV4dFJldl1bMF07XG4gICAgICAgICAgdmFyIG5leHRZID0gbWFwW25leHRSZXZdWzFdO1xuXG4gICAgICAgICAgaWYgKG1hcFtyZXZdKSB7XG4gICAgICAgICAgICB4ID0gbWFwW3Jldl1bMF07XG4gICAgICAgICAgICB5ID0gbWFwW3Jldl1bMV07XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgbGluZSh4LCB5LCBuZXh0WCwgbmV4dFkpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChtYXBbcmV2XSkge1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIG1heFggPSBNYXRoLm1heCh4LCBtYXhYKTtcbiAgICAgICAgbWF4WSA9IE1hdGgubWF4KHksIG1heFkpO1xuICAgICAgICBsZXZlbENvdW50W3Bvc10rKztcbiAgICAgICAgbm9kZSh4LCB5LCByZXYsIGlzTGVhZiwgcmV2IGluIGRlbGV0ZWQsIHJldiA9PT0gd2lubmVyLCBtaW5VbmlxKTtcbiAgICAgICAgbWFwW3Jldl0gPSBbeCwgeV07XG4gICAgICB9XG4gICAgfVxuICAgIHBhdGhzLmZvckVhY2goZHJhd1BhdGgpO1xuXG4gICAgc3ZnLnNldEF0dHJpYnV0ZSgndmlld0JveCcsICcwIDAgJyArIChtYXhYICsgZ3JpZCkgKyAnICcgKyAobWF4WSArIGdyaWQpKTtcbiAgICBzdmcuc3R5bGUud2lkdGggPSBzY2FsZSAqIChtYXhYICsgZ3JpZCkgKyAncHgnO1xuICAgIHN2Zy5zdHlsZS5oZWlnaHQgPSBzY2FsZSAqIChtYXhZICsgZ3JpZCkgKyAncHgnO1xuICAgIHJldHVybiBib3g7XG4gIH07XG5cbiAgZnVuY3Rpb24gZXJyb3IoZXJyKSB7XG4gICAgY29uc29sZS5lcnJvcihlcnIpO1xuICAgIGFsZXJ0KFwiZXJyb3Igb2NjdXJlZCwgc2VlIGNvbnNvbGVcIik7XG4gIH1cblxuICB2YXIgcHV0QWZ0ZXIgPSBmdW5jdGlvbihkb2MsIHByZXZSZXYpe1xuICAgIHZhciBuZXdEb2MgPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KGRvYykpO1xuICAgIG5ld0RvYy5fcmV2aXNpb25zID0ge1xuICAgICAgc3RhcnQ6ICtuZXdEb2MuX3Jldi5zcGxpdCgnLScpWzBdLFxuICAgICAgaWRzOiBbXG4gICAgICAgIG5ld0RvYy5fcmV2LnNwbGl0KCctJylbMV0sXG4gICAgICAgIHByZXZSZXYuc3BsaXQoJy0nKVsxXVxuICAgICAgXVxuICAgIH07XG4gICAgcmV0dXJuIGRiLnB1dChuZXdEb2MsIHtuZXdfZWRpdHM6IGZhbHNlfSk7XG4gIH07XG5cbiAgdmFyIHN2Z05TID0gXCJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2Z1wiO1xuICB2YXIgYm94ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gIGJveC5jbGFzc05hbWUgPSBcInZpc3VhbGl6ZVJldlRyZWVcIjtcbiAgdmFyIHN2ZyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnROUyhzdmdOUywgXCJzdmdcIik7XG4gIGJveC5hcHBlbmRDaGlsZChzdmcpO1xuICB2YXIgbGluZXNCb3ggPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50TlMoc3ZnTlMsIFwiZ1wiKTtcbiAgc3ZnLmFwcGVuZENoaWxkKGxpbmVzQm94KTtcbiAgdmFyIGNpcmNsZXNCb3ggPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50TlMoc3ZnTlMsIFwiZ1wiKTtcbiAgc3ZnLmFwcGVuZENoaWxkKGNpcmNsZXNCb3gpO1xuICB2YXIgdGV4dHNCb3ggPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50TlMoc3ZnTlMsIFwiZ1wiKTtcbiAgc3ZnLmFwcGVuZENoaWxkKHRleHRzQm94KTtcblxuICB2YXIgY2lyYyA9IGZ1bmN0aW9uKHgsIHksIHIsIGlzTGVhZiwgaXNEZWxldGVkLCBpc1dpbm5lcikge1xuICAgIHZhciBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnROUyhzdmdOUywgXCJjaXJjbGVcIik7XG4gICAgZWwuc2V0QXR0cmlidXRlTlMobnVsbCwgXCJjeFwiLCB4KTtcbiAgICBlbC5zZXRBdHRyaWJ1dGVOUyhudWxsLCBcImN5XCIsIHkpO1xuICAgIGVsLnNldEF0dHJpYnV0ZU5TKG51bGwsIFwiclwiLCByKTtcbiAgICBpZiAoaXNMZWFmKSB7XG4gICAgICBlbC5jbGFzc0xpc3QuYWRkKFwibGVhZlwiKTtcbiAgICB9XG4gICAgaWYgKGlzV2lubmVyKSB7XG4gICAgICBlbC5jbGFzc0xpc3QuYWRkKFwid2lubmVyXCIpO1xuICAgIH1cbiAgICBpZiAoaXNEZWxldGVkKSB7XG4gICAgICBlbC5jbGFzc0xpc3QuYWRkKFwiZGVsZXRlZFwiKTtcbiAgICB9XG4gICAgY2lyY2xlc0JveC5hcHBlbmRDaGlsZChlbCk7XG4gICAgcmV0dXJuIGVsO1xuICB9O1xuXG4gIHZhciBsaW5lID0gZnVuY3Rpb24oeDEsIHkxLCB4MiwgeTIpIHtcbiAgICB2YXIgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50TlMoc3ZnTlMsIFwibGluZVwiKTtcbiAgICBlbC5zZXRBdHRyaWJ1dGVOUyhudWxsLCBcIngxXCIsIHgxKTtcbiAgICBlbC5zZXRBdHRyaWJ1dGVOUyhudWxsLCBcInkxXCIsIHkxKTtcbiAgICBlbC5zZXRBdHRyaWJ1dGVOUyhudWxsLCBcIngyXCIsIHgyKTtcbiAgICBlbC5zZXRBdHRyaWJ1dGVOUyhudWxsLCBcInkyXCIsIHkyKTtcbiAgICBsaW5lc0JveC5hcHBlbmRDaGlsZChlbCk7XG4gICAgcmV0dXJuIGVsO1xuICB9O1xuXG4gIHZhciBmb2N1c2VkSW5wdXQ7XG4gIGZ1bmN0aW9uIGlucHV0KHRleHQpe1xuICAgIHZhciBkaXYgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgICBkaXYuY2xhc3NMaXN0LmFkZCgnaW5wdXQnKTtcbiAgICB2YXIgc3BhbiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3NwYW4nKTtcbiAgICBkaXYuYXBwZW5kQ2hpbGQoc3Bhbik7XG4gICAgc3Bhbi5hcHBlbmRDaGlsZChkb2N1bWVudC5jcmVhdGVUZXh0Tm9kZSh0ZXh0KSk7XG4gICAgdmFyIGNsaWNrZWQgPSBmYWxzZTtcbiAgICB2YXIgaW5wdXQ7XG5cbiAgICBkaXYub25kYmxjbGljayA9IGZ1bmN0aW9uKCkge1xuICAgICAgaWYoY2xpY2tlZCl7XG4gICAgICAgIGlucHV0LmZvY3VzKCk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGNsaWNrZWQgPSB0cnVlO1xuICAgICAgZGl2LnJlbW92ZUNoaWxkKHNwYW4pO1xuICAgICAgaW5wdXQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdpbnB1dCcpO1xuICAgICAgZGl2LmFwcGVuZENoaWxkKGlucHV0KTtcbiAgICAgIGlucHV0LnZhbHVlID0gdGV4dDtcbiAgICAgIGlucHV0LmZvY3VzKCk7XG5cbiAgICAgIGlucHV0Lm9ua2V5ZG93biA9IGZ1bmN0aW9uKGUpe1xuICAgICAgICBpZihlLmtleUNvZGUgPT09IDkgJiYgIWUuc2hpZnRLZXkpe1xuICAgICAgICAgIHZhciBuZXh0O1xuICAgICAgICAgIGlmKG5leHQgPSB0aGlzLnBhcmVudE5vZGUucGFyZW50Tm9kZS5uZXh0U2libGluZyl7XG4gICAgICAgICAgICBuZXh0LmZpcnN0Q2hpbGQub25kYmxjbGljaygpO1xuICAgICAgICAgICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfTtcbiAgICB9O1xuICAgIGRpdi5nZXRWYWx1ZSA9IGZ1bmN0aW9uKCkge1xuICAgICAgcmV0dXJuIGNsaWNrZWQgPyBpbnB1dC52YWx1ZSA6IHRleHQ7XG4gICAgfTtcbiAgICByZXR1cm4gZGl2O1xuICB9XG5cbiAgZnVuY3Rpb24gbm9kZSh4LCB5LCByZXYsIGlzTGVhZiwgaXNEZWxldGVkLCBpc1dpbm5lciwgc2hvcnREZXNjTGVuKXtcbiAgICB2YXIgbm9kZUVsID0gY2lyYyh4LCB5LCByLCBpc0xlYWYsIGlzRGVsZXRlZCwgaXNXaW5uZXIpO1xuICAgIHZhciBwb3MgPSByZXYuc3BsaXQoJy0nKVswXTtcbiAgICB2YXIgaWQgPSByZXYuc3BsaXQoJy0nKVsxXTtcbiAgICB2YXIgb3BlbmVkID0gZmFsc2U7XG5cbiAgICB2YXIgY2xpY2sgPSBmdW5jdGlvbigpIHtcbiAgICAgIGlmIChvcGVuZWQpIHJldHVybjtcbiAgICAgIG9wZW5lZCA9IHRydWU7XG5cbiAgICAgIHZhciBkaXYgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgICAgIGRpdi5jbGFzc0xpc3QuYWRkKFwiZWRpdG9yXCIpO1xuICAgICAgZGl2LmNsYXNzTGlzdC5hZGQoXCJib3hcIik7XG4gICAgICBkaXYuc3R5bGUubGVmdCA9IHNjYWxlICogKHggKyAzICogcikgKyBcInB4XCI7XG4gICAgICBkaXYuc3R5bGUudG9wID0gc2NhbGUgKiAoeSAtIDIpICsgXCJweFwiO1xuICAgICAgZGl2LnN0eWxlLnpJbmRleCA9IDEwMDA7XG4gICAgICBib3guYXBwZW5kQ2hpbGQoZGl2KTtcblxuICAgICAgdmFyIGNsb3NlID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIGRpdi5wYXJlbnROb2RlLnJlbW92ZUNoaWxkKGRpdik7XG4gICAgICAgIG9wZW5lZCA9IGZhbHNlO1xuICAgICAgfTtcblxuICAgICAgZGIuZ2V0KGRvY0lkLCB7cmV2OiByZXZ9KS50aGVuKGZ1bmN0aW9uKGRvYyl7XG4gICAgICAgIHZhciBkbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RsJyk7XG4gICAgICAgIHZhciBrZXlzID0gW107XG4gICAgICAgIHZhciBhZGRSb3cgPSBmdW5jdGlvbihrZXksIHZhbHVlKXtcbiAgICAgICAgICB2YXIga2V5ID0gaW5wdXQoa2V5KTtcbiAgICAgICAgICBrZXlzLnB1c2goa2V5KTtcbiAgICAgICAgICB2YXIgZHQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkdCcpO1xuICAgICAgICAgIGR0LmFwcGVuZENoaWxkKGtleSk7XG4gICAgICAgICAgZGwuYXBwZW5kQ2hpbGQoZHQpO1xuICAgICAgICAgIHZhciB2YWx1ZSA9IGlucHV0KHZhbHVlKTtcbiAgICAgICAgICBrZXkudmFsdWVJbnB1dCA9IHZhbHVlO1xuICAgICAgICAgIHZhciBkZCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RkJyk7XG4gICAgICAgICAgZGQuYXBwZW5kQ2hpbGQodmFsdWUpO1xuICAgICAgICAgIGRsLmFwcGVuZENoaWxkKGRkKTtcbiAgICAgICAgfTtcbiAgICAgICAgZm9yICh2YXIgaSBpbiBkb2MpIHtcbiAgICAgICAgICBpZiAoZG9jLmhhc093blByb3BlcnR5KGkpKSB7XG4gICAgICAgICAgICBhZGRSb3coaSwgSlNPTi5zdHJpbmdpZnkoZG9jW2ldKSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGRpdi5hcHBlbmRDaGlsZChkbCk7XG4gICAgICAgIHZhciBhZGRCdXR0b24gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdidXR0b24nKTtcbiAgICAgICAgYWRkQnV0dG9uLmFwcGVuZENoaWxkKGRvY3VtZW50LmNyZWF0ZVRleHROb2RlKCdhZGQgZmllbGQnKSk7XG4gICAgICAgIGRpdi5hcHBlbmRDaGlsZChhZGRCdXR0b24pO1xuICAgICAgICBhZGRCdXR0b24ub25jbGljayA9IGZ1bmN0aW9uKCl7XG4gICAgICAgICAgYWRkUm93KCdrZXknLCAndmFsdWUnKTtcbiAgICAgICAgfTtcbiAgICAgICAgdmFyIGNhbmNlbEJ1dHRvbiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2J1dHRvbicpO1xuICAgICAgICBjYW5jZWxCdXR0b24uYXBwZW5kQ2hpbGQoZG9jdW1lbnQuY3JlYXRlVGV4dE5vZGUoJ2NhbmNlbCcpKTtcbiAgICAgICAgZGl2LmFwcGVuZENoaWxkKGNhbmNlbEJ1dHRvbik7XG4gICAgICAgIGNhbmNlbEJ1dHRvbi5vbmNsaWNrID0gY2xvc2U7XG4gICAgICAgIHZhciBva0J1dHRvbiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2J1dHRvbicpO1xuICAgICAgICBva0J1dHRvbi5hcHBlbmRDaGlsZChkb2N1bWVudC5jcmVhdGVUZXh0Tm9kZSgnc2F2ZScpKTtcbiAgICAgICAgZGl2LmFwcGVuZENoaWxkKG9rQnV0dG9uKTtcbiAgICAgICAgb2tCdXR0b24ub25jbGljayA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIHZhciBuZXdEb2MgPSB7fTtcbiAgICAgICAgICBrZXlzLmZvckVhY2goZnVuY3Rpb24oa2V5KXtcbiAgICAgICAgICAgIHZhciB2YWx1ZSA9IGtleS52YWx1ZUlucHV0LmdldFZhbHVlKCk7XG4gICAgICAgICAgICBpZiAodmFsdWUucmVwbGFjZSgvXlxccyp8XFxzKiQvZywgJycpKXtcbiAgICAgICAgICAgICAgbmV3RG9jW2tleS5nZXRWYWx1ZSgpXSA9IEpTT04ucGFyc2Uoa2V5LnZhbHVlSW5wdXQuZ2V0VmFsdWUoKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSk7XG4gICAgICAgICAgcHV0QWZ0ZXIobmV3RG9jLCBkb2MuX3JldikudGhlbihjbG9zZSwgZXJyb3IpO1xuICAgICAgICB9O1xuICAgICAgfSwgZXJyb3IpO1xuICAgIH07XG4gICAgbm9kZUVsLm9uY2xpY2sgPSBjbGljaztcbiAgICBub2RlRWwub25tb3VzZW92ZXIgPSBmdW5jdGlvbigpIHtcbiAgICAgIHRoaXMuY2xhc3NMaXN0LmFkZChcInNlbGVjdGVkXCIpO1xuICAgICAgLy90ZXh0LnN0eWxlLmRpc3BsYXkgPSBcImJsb2NrXCI7XG4gICAgfTtcbiAgICBub2RlRWwub25tb3VzZW91dCA9IGZ1bmN0aW9uKCkge1xuICAgICAgdGhpcy5jbGFzc0xpc3QucmVtb3ZlKFwic2VsZWN0ZWRcIik7XG4gICAgICAvL3RleHQuc3R5bGUuZGlzcGxheSA9IFwibm9uZVwiO1xuICAgIH07XG5cbiAgICB2YXIgdGV4dCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICAgIC8vdGV4dC5zdHlsZS5kaXNwbGF5ID0gXCJub25lXCI7XG4gICAgdGV4dC5jbGFzc0xpc3QuYWRkKFwiYm94XCIpO1xuICAgIHRleHQuc3R5bGUubGVmdCA9IHNjYWxlICogKHggKyAxICogcikgKyBcInB4XCI7XG4gICAgdGV4dC5zdHlsZS50b3AgPSBzY2FsZSAqICh5IC0gNSkgKyBcInB4XCI7XG4gICAgdGV4dC5zaG9ydCA9IHBvcyArICctJyArIGlkLnN1YnN0cigwLCBzaG9ydERlc2NMZW4pO1xuICAgIHRleHQubG9uZyA9IHBvcyArICctJyArIGlkO1xuICAgIHRleHQuYXBwZW5kQ2hpbGQoZG9jdW1lbnQuY3JlYXRlVGV4dE5vZGUodGV4dC5zaG9ydCkpO1xuICAgIHRleHQub25tb3VzZW92ZXIgPSBmdW5jdGlvbigpIHtcbiAgICAgIHRoaXMuc3R5bGUuekluZGV4ID0gMTAwMDtcbiAgICB9O1xuICAgIHRleHQub25tb3VzZW91dCA9IGZ1bmN0aW9uKCkge1xuICAgICAgdGhpcy5zdHlsZS56SW5kZXggPSAxO1xuICAgIH07XG4gICAgdGV4dC5vbmNsaWNrID0gY2xpY2s7XG4gICAgYm94LmFwcGVuZENoaWxkKHRleHQpO1xuICB9XG5cbiAgdmFyIGZsYXR0ZW4gPSBmdW5jdGlvbiAoYXJyYXlPZkFycmF5cykge1xuICAgIHJldHVybiBBcnJheS5wcm90b3R5cGUuY29uY2F0LmFwcGx5KFtdLCBhcnJheU9mQXJyYXlzKTtcbiAgfTtcblxuICByZXR1cm4gZ2V0VHJlZShkYiwgZG9jSWQpLnRoZW4oZnVuY3Rpb24gKHRyZWUpIHtcbiAgICB2YXIgbWluVW5pcUxlbmd0aCA9IG1pblVuaXEoZmxhdHRlbih0cmVlLnBhdGhzKS5tYXAoZnVuY3Rpb24ocmV2KSB7XG4gICAgICByZXR1cm4gcmV2LnNwbGl0KCctJylbMV07XG4gICAgfSkpO1xuICAgIHJldHVybiBkcmF3KHRyZWUucGF0aHMsIHRyZWUuZGVsZXRlZCwgdHJlZS53aW5uZXIsIG1pblVuaXFMZW5ndGgpO1xuICB9KTtcbn07XG4iLCJcInVzZSBzdHJpY3RcIjtcblxudmFyIHV0aWxzID0gcmVxdWlyZSgnLi91dGlscycpO1xudmFyIG1lcmdlID0gcmVxdWlyZSgnLi9tZXJnZScpO1xudmFyIGVycm9ycyA9IHJlcXVpcmUoJy4vZGVwcy9lcnJvcnMnKTtcbnZhciBFdmVudEVtaXR0ZXIgPSByZXF1aXJlKCdldmVudHMnKS5FdmVudEVtaXR0ZXI7XG52YXIgdXBzZXJ0ID0gcmVxdWlyZSgnLi9kZXBzL3Vwc2VydCcpO1xudmFyIENoYW5nZXMgPSByZXF1aXJlKCcuL2NoYW5nZXMnKTtcbnZhciBQcm9taXNlID0gdXRpbHMuUHJvbWlzZTtcblxuLypcbiAqIEEgZ2VuZXJpYyBwb3VjaCBhZGFwdGVyXG4gKi9cblxuLy8gcmV0dXJucyBmaXJzdCBlbGVtZW50IG9mIGFyciBzYXRpc2Z5aW5nIGNhbGxiYWNrIHByZWRpY2F0ZVxuZnVuY3Rpb24gYXJyYXlGaXJzdChhcnIsIGNhbGxiYWNrKSB7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgYXJyLmxlbmd0aDsgaSsrKSB7XG4gICAgaWYgKGNhbGxiYWNrKGFycltpXSwgaSkgPT09IHRydWUpIHtcbiAgICAgIHJldHVybiBhcnJbaV07XG4gICAgfVxuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLy8gV3JhcHBlciBmb3IgZnVuY3Rpb25zIHRoYXQgY2FsbCB0aGUgYnVsa2RvY3MgYXBpIHdpdGggYSBzaW5nbGUgZG9jLFxuLy8gaWYgdGhlIGZpcnN0IHJlc3VsdCBpcyBhbiBlcnJvciwgcmV0dXJuIGFuIGVycm9yXG5mdW5jdGlvbiB5YW5rRXJyb3IoY2FsbGJhY2spIHtcbiAgcmV0dXJuIGZ1bmN0aW9uIChlcnIsIHJlc3VsdHMpIHtcbiAgICBpZiAoZXJyIHx8IChyZXN1bHRzWzBdICYmIHJlc3VsdHNbMF0uZXJyb3IpKSB7XG4gICAgICBjYWxsYmFjayhlcnIgfHwgcmVzdWx0c1swXSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNhbGxiYWNrKG51bGwsIHJlc3VsdHMubGVuZ3RoID8gcmVzdWx0c1swXSAgOiByZXN1bHRzKTtcbiAgICB9XG4gIH07XG59XG5cbi8vIGZvciBldmVyeSBub2RlIGluIGEgcmV2aXNpb24gdHJlZSBjb21wdXRlcyBpdHMgZGlzdGFuY2UgZnJvbSB0aGUgY2xvc2VzdFxuLy8gbGVhZlxuZnVuY3Rpb24gY29tcHV0ZUhlaWdodChyZXZzKSB7XG4gIHZhciBoZWlnaHQgPSB7fTtcbiAgdmFyIGVkZ2VzID0gW107XG4gIG1lcmdlLnRyYXZlcnNlUmV2VHJlZShyZXZzLCBmdW5jdGlvbiAoaXNMZWFmLCBwb3MsIGlkLCBwcm50KSB7XG4gICAgdmFyIHJldiA9IHBvcyArIFwiLVwiICsgaWQ7XG4gICAgaWYgKGlzTGVhZikge1xuICAgICAgaGVpZ2h0W3Jldl0gPSAwO1xuICAgIH1cbiAgICBpZiAocHJudCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBlZGdlcy5wdXNoKHtmcm9tOiBwcm50LCB0bzogcmV2fSk7XG4gICAgfVxuICAgIHJldHVybiByZXY7XG4gIH0pO1xuXG4gIGVkZ2VzLnJldmVyc2UoKTtcbiAgZWRnZXMuZm9yRWFjaChmdW5jdGlvbiAoZWRnZSkge1xuICAgIGlmIChoZWlnaHRbZWRnZS5mcm9tXSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBoZWlnaHRbZWRnZS5mcm9tXSA9IDEgKyBoZWlnaHRbZWRnZS50b107XG4gICAgfSBlbHNlIHtcbiAgICAgIGhlaWdodFtlZGdlLmZyb21dID0gTWF0aC5taW4oaGVpZ2h0W2VkZ2UuZnJvbV0sIDEgKyBoZWlnaHRbZWRnZS50b10pO1xuICAgIH1cbiAgfSk7XG4gIHJldHVybiBoZWlnaHQ7XG59XG5cbmZ1bmN0aW9uIGFsbERvY3NLZXlzUXVlcnkoYXBpLCBvcHRzLCBjYWxsYmFjaykge1xuICB2YXIga2V5cyA9ICAoJ2xpbWl0JyBpbiBvcHRzKSA/XG4gICAgICBvcHRzLmtleXMuc2xpY2Uob3B0cy5za2lwLCBvcHRzLmxpbWl0ICsgb3B0cy5za2lwKSA6XG4gICAgICAob3B0cy5za2lwID4gMCkgPyBvcHRzLmtleXMuc2xpY2Uob3B0cy5za2lwKSA6IG9wdHMua2V5cztcbiAgaWYgKG9wdHMuZGVzY2VuZGluZykge1xuICAgIGtleXMucmV2ZXJzZSgpO1xuICB9XG4gIGlmICgha2V5cy5sZW5ndGgpIHtcbiAgICByZXR1cm4gYXBpLl9hbGxEb2NzKHtsaW1pdDogMH0sIGNhbGxiYWNrKTtcbiAgfVxuICB2YXIgZmluYWxSZXN1bHRzID0ge1xuICAgIG9mZnNldDogb3B0cy5za2lwXG4gIH07XG4gIHJldHVybiBQcm9taXNlLmFsbChrZXlzLm1hcChmdW5jdGlvbiAoa2V5KSB7XG4gICAgdmFyIHN1Yk9wdHMgPSB1dGlscy5leHRlbmQodHJ1ZSwge2tleToga2V5LCBkZWxldGVkOiAnb2snfSwgb3B0cyk7XG4gICAgWydsaW1pdCcsICdza2lwJywgJ2tleXMnXS5mb3JFYWNoKGZ1bmN0aW9uIChvcHRLZXkpIHtcbiAgICAgIGRlbGV0ZSBzdWJPcHRzW29wdEtleV07XG4gICAgfSk7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uIChyZXNvbHZlLCByZWplY3QpIHtcbiAgICAgIGFwaS5fYWxsRG9jcyhzdWJPcHRzLCBmdW5jdGlvbiAoZXJyLCByZXMpIHtcbiAgICAgICAgaWYgKGVycikge1xuICAgICAgICAgIHJldHVybiByZWplY3QoZXJyKTtcbiAgICAgICAgfVxuICAgICAgICBmaW5hbFJlc3VsdHMudG90YWxfcm93cyA9IHJlcy50b3RhbF9yb3dzO1xuICAgICAgICByZXNvbHZlKHJlcy5yb3dzWzBdIHx8IHtrZXk6IGtleSwgZXJyb3I6ICdub3RfZm91bmQnfSk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSkpLnRoZW4oZnVuY3Rpb24gKHJlc3VsdHMpIHtcbiAgICBmaW5hbFJlc3VsdHMucm93cyA9IHJlc3VsdHM7XG4gICAgcmV0dXJuIGZpbmFsUmVzdWx0cztcbiAgfSk7XG59XG5cbnV0aWxzLmluaGVyaXRzKEFic3RyYWN0UG91Y2hEQiwgRXZlbnRFbWl0dGVyKTtcbm1vZHVsZS5leHBvcnRzID0gQWJzdHJhY3RQb3VjaERCO1xuXG5mdW5jdGlvbiBBYnN0cmFjdFBvdWNoREIoKSB7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgRXZlbnRFbWl0dGVyLmNhbGwodGhpcyk7XG5cbiAgdmFyIGxpc3RlbmVycyA9IDAsIGNoYW5nZXM7XG4gIHZhciBldmVudE5hbWVzID0gWydjaGFuZ2UnLCAnZGVsZXRlJywgJ2NyZWF0ZScsICd1cGRhdGUnXTtcbiAgdGhpcy5vbignbmV3TGlzdGVuZXInLCBmdW5jdGlvbiAoZXZlbnROYW1lKSB7XG4gICAgaWYgKH5ldmVudE5hbWVzLmluZGV4T2YoZXZlbnROYW1lKSkge1xuICAgICAgaWYgKGxpc3RlbmVycykge1xuICAgICAgICBsaXN0ZW5lcnMrKztcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbGlzdGVuZXJzKys7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdmFyIGxhc3RDaGFuZ2UgPSAwO1xuICAgIGNoYW5nZXMgPSB0aGlzLmNoYW5nZXMoe1xuICAgICAgY29uZmxpY3RzOiB0cnVlLFxuICAgICAgaW5jbHVkZV9kb2NzOiB0cnVlLFxuICAgICAgY29udGludW91czogdHJ1ZSxcbiAgICAgIHNpbmNlOiAnbm93JyxcbiAgICAgIG9uQ2hhbmdlOiBmdW5jdGlvbiAoY2hhbmdlKSB7XG4gICAgICAgIGlmIChjaGFuZ2Uuc2VxIDw9IGxhc3RDaGFuZ2UpIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgbGFzdENoYW5nZSA9IGNoYW5nZS5zZXE7XG4gICAgICAgIHNlbGYuZW1pdCgnY2hhbmdlJywgY2hhbmdlKTtcbiAgICAgICAgaWYgKGNoYW5nZS5kb2MuX2RlbGV0ZWQpIHtcbiAgICAgICAgICBzZWxmLmVtaXQoJ2RlbGV0ZScsIGNoYW5nZSk7XG4gICAgICAgIH0gZWxzZSBpZiAoY2hhbmdlLmRvYy5fcmV2LnNwbGl0KCctJylbMF0gPT09ICcxJykge1xuICAgICAgICAgIHNlbGYuZW1pdCgnY3JlYXRlJywgY2hhbmdlKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBzZWxmLmVtaXQoJ3VwZGF0ZScsIGNoYW5nZSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KTtcbiAgfSk7XG4gIHRoaXMub24oJ3JlbW92ZUxpc3RlbmVyJywgZnVuY3Rpb24gKGV2ZW50TmFtZSkge1xuICAgIGlmICh+ZXZlbnROYW1lcy5pbmRleE9mKGV2ZW50TmFtZSkpIHtcbiAgICAgIGxpc3RlbmVycy0tO1xuICAgICAgaWYgKGxpc3RlbmVycykge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY2hhbmdlcy5jYW5jZWwoKTtcbiAgfSk7XG59XG5cbkFic3RyYWN0UG91Y2hEQi5wcm90b3R5cGUucG9zdCA9XG4gIHV0aWxzLmFkYXB0ZXJGdW4oJ3Bvc3QnLCBmdW5jdGlvbiAoZG9jLCBvcHRzLCBjYWxsYmFjaykge1xuICBpZiAodHlwZW9mIG9wdHMgPT09ICdmdW5jdGlvbicpIHtcbiAgICBjYWxsYmFjayA9IG9wdHM7XG4gICAgb3B0cyA9IHt9O1xuICB9XG4gIGlmICh0eXBlb2YgZG9jICE9PSAnb2JqZWN0JyB8fCBBcnJheS5pc0FycmF5KGRvYykpIHtcbiAgICByZXR1cm4gY2FsbGJhY2soZXJyb3JzLmVycm9yKGVycm9ycy5OT1RfQU5fT0JKRUNUKSk7XG4gIH1cbiAgdGhpcy5idWxrRG9jcyh7ZG9jczogW2RvY119LCBvcHRzLCB5YW5rRXJyb3IoY2FsbGJhY2spKTtcbn0pO1xuXG5BYnN0cmFjdFBvdWNoREIucHJvdG90eXBlLnB1dCA9XG4gIHV0aWxzLmFkYXB0ZXJGdW4oJ3B1dCcsIHV0aWxzLmdldEFyZ3VtZW50cyhmdW5jdGlvbiAoYXJncykge1xuICB2YXIgdGVtcCwgdGVtcHR5cGUsIG9wdHMsIGNhbGxiYWNrO1xuICB2YXIgZG9jID0gYXJncy5zaGlmdCgpO1xuICB2YXIgaWQgPSAnX2lkJyBpbiBkb2M7XG4gIGlmICh0eXBlb2YgZG9jICE9PSAnb2JqZWN0JyB8fCBBcnJheS5pc0FycmF5KGRvYykpIHtcbiAgICBjYWxsYmFjayA9IGFyZ3MucG9wKCk7XG4gICAgcmV0dXJuIGNhbGxiYWNrKGVycm9ycy5lcnJvcihlcnJvcnMuTk9UX0FOX09CSkVDVCkpO1xuICB9XG4gIGRvYyA9IHV0aWxzLmNsb25lKGRvYyk7XG4gIHdoaWxlICh0cnVlKSB7XG4gICAgdGVtcCA9IGFyZ3Muc2hpZnQoKTtcbiAgICB0ZW1wdHlwZSA9IHR5cGVvZiB0ZW1wO1xuICAgIGlmICh0ZW1wdHlwZSA9PT0gXCJzdHJpbmdcIiAmJiAhaWQpIHtcbiAgICAgIGRvYy5faWQgPSB0ZW1wO1xuICAgICAgaWQgPSB0cnVlO1xuICAgIH0gZWxzZSBpZiAodGVtcHR5cGUgPT09IFwic3RyaW5nXCIgJiYgaWQgJiYgISgnX3JldicgaW4gZG9jKSkge1xuICAgICAgZG9jLl9yZXYgPSB0ZW1wO1xuICAgIH0gZWxzZSBpZiAodGVtcHR5cGUgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgIG9wdHMgPSB0ZW1wO1xuICAgIH0gZWxzZSBpZiAodGVtcHR5cGUgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgY2FsbGJhY2sgPSB0ZW1wO1xuICAgIH1cbiAgICBpZiAoIWFyZ3MubGVuZ3RoKSB7XG4gICAgICBicmVhaztcbiAgICB9XG4gIH1cbiAgb3B0cyA9IG9wdHMgfHwge307XG4gIHZhciBlcnJvciA9IHV0aWxzLmludmFsaWRJZEVycm9yKGRvYy5faWQpO1xuICBpZiAoZXJyb3IpIHtcbiAgICByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICB9XG4gIGlmICh1dGlscy5pc0xvY2FsSWQoZG9jLl9pZCkgJiYgdHlwZW9mIHRoaXMuX3B1dExvY2FsID09PSAnZnVuY3Rpb24nKSB7XG4gICAgaWYgKGRvYy5fZGVsZXRlZCkge1xuICAgICAgcmV0dXJuIHRoaXMuX3JlbW92ZUxvY2FsKGRvYywgY2FsbGJhY2spO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gdGhpcy5fcHV0TG9jYWwoZG9jLCBjYWxsYmFjayk7XG4gICAgfVxuICB9XG4gIHRoaXMuYnVsa0RvY3Moe2RvY3M6IFtkb2NdfSwgb3B0cywgeWFua0Vycm9yKGNhbGxiYWNrKSk7XG59KSk7XG5cbkFic3RyYWN0UG91Y2hEQi5wcm90b3R5cGUucHV0QXR0YWNobWVudCA9XG4gIHV0aWxzLmFkYXB0ZXJGdW4oJ3B1dEF0dGFjaG1lbnQnLCBmdW5jdGlvbiAoZG9jSWQsIGF0dGFjaG1lbnRJZCwgcmV2LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJsb2IsIHR5cGUsIGNhbGxiYWNrKSB7XG4gIHZhciBhcGkgPSB0aGlzO1xuICBpZiAodHlwZW9mIHR5cGUgPT09ICdmdW5jdGlvbicpIHtcbiAgICBjYWxsYmFjayA9IHR5cGU7XG4gICAgdHlwZSA9IGJsb2I7XG4gICAgYmxvYiA9IHJldjtcbiAgICByZXYgPSBudWxsO1xuICB9XG4gIGlmICh0eXBlb2YgdHlwZSA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICB0eXBlID0gYmxvYjtcbiAgICBibG9iID0gcmV2O1xuICAgIHJldiA9IG51bGw7XG4gIH1cblxuICBmdW5jdGlvbiBjcmVhdGVBdHRhY2htZW50KGRvYykge1xuICAgIGRvYy5fYXR0YWNobWVudHMgPSBkb2MuX2F0dGFjaG1lbnRzIHx8IHt9O1xuICAgIGRvYy5fYXR0YWNobWVudHNbYXR0YWNobWVudElkXSA9IHtcbiAgICAgIGNvbnRlbnRfdHlwZTogdHlwZSxcbiAgICAgIGRhdGE6IGJsb2JcbiAgICB9O1xuICAgIHJldHVybiBhcGkucHV0KGRvYyk7XG4gIH1cblxuICByZXR1cm4gYXBpLmdldChkb2NJZCkudGhlbihmdW5jdGlvbiAoZG9jKSB7XG4gICAgaWYgKGRvYy5fcmV2ICE9PSByZXYpIHtcbiAgICAgIHRocm93IGVycm9ycy5lcnJvcihlcnJvcnMuUkVWX0NPTkZMSUNUKTtcbiAgICB9XG5cbiAgICByZXR1cm4gY3JlYXRlQXR0YWNobWVudChkb2MpO1xuICB9LCBmdW5jdGlvbiAoZXJyKSB7XG4gICAgIC8vIGNyZWF0ZSBuZXcgZG9jXG4gICAgaWYgKGVyci5yZWFzb24gPT09IGVycm9ycy5NSVNTSU5HX0RPQy5tZXNzYWdlKSB7XG4gICAgICByZXR1cm4gY3JlYXRlQXR0YWNobWVudCh7X2lkOiBkb2NJZH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBlcnI7XG4gICAgfVxuICB9KTtcbn0pO1xuXG5BYnN0cmFjdFBvdWNoREIucHJvdG90eXBlLnJlbW92ZUF0dGFjaG1lbnQgPVxuICB1dGlscy5hZGFwdGVyRnVuKCdyZW1vdmVBdHRhY2htZW50JywgZnVuY3Rpb24gKGRvY0lkLCBhdHRhY2htZW50SWQsIHJldixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjYWxsYmFjaykge1xuICB2YXIgc2VsZiA9IHRoaXM7XG4gIHNlbGYuZ2V0KGRvY0lkLCBmdW5jdGlvbiAoZXJyLCBvYmopIHtcbiAgICBpZiAoZXJyKSB7XG4gICAgICBjYWxsYmFjayhlcnIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAob2JqLl9yZXYgIT09IHJldikge1xuICAgICAgY2FsbGJhY2soZXJyb3JzLmVycm9yKGVycm9ycy5SRVZfQ09ORkxJQ1QpKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKCFvYmouX2F0dGFjaG1lbnRzKSB7XG4gICAgICByZXR1cm4gY2FsbGJhY2soKTtcbiAgICB9XG4gICAgZGVsZXRlIG9iai5fYXR0YWNobWVudHNbYXR0YWNobWVudElkXTtcbiAgICBpZiAoT2JqZWN0LmtleXMob2JqLl9hdHRhY2htZW50cykubGVuZ3RoID09PSAwKSB7XG4gICAgICBkZWxldGUgb2JqLl9hdHRhY2htZW50cztcbiAgICB9XG4gICAgc2VsZi5wdXQob2JqLCBjYWxsYmFjayk7XG4gIH0pO1xufSk7XG5cbkFic3RyYWN0UG91Y2hEQi5wcm90b3R5cGUucmVtb3ZlID1cbiAgdXRpbHMuYWRhcHRlckZ1bigncmVtb3ZlJywgZnVuY3Rpb24gKGRvY09ySWQsIG9wdHNPclJldiwgb3B0cywgY2FsbGJhY2spIHtcbiAgdmFyIGRvYztcbiAgaWYgKHR5cGVvZiBvcHRzT3JSZXYgPT09ICdzdHJpbmcnKSB7XG4gICAgLy8gaWQsIHJldiwgb3B0cywgY2FsbGJhY2sgc3R5bGVcbiAgICBkb2MgPSB7XG4gICAgICBfaWQ6IGRvY09ySWQsXG4gICAgICBfcmV2OiBvcHRzT3JSZXZcbiAgICB9O1xuICAgIGlmICh0eXBlb2Ygb3B0cyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgY2FsbGJhY2sgPSBvcHRzO1xuICAgICAgb3B0cyA9IHt9O1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICAvLyBkb2MsIG9wdHMsIGNhbGxiYWNrIHN0eWxlXG4gICAgZG9jID0gZG9jT3JJZDtcbiAgICBpZiAodHlwZW9mIG9wdHNPclJldiA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgY2FsbGJhY2sgPSBvcHRzT3JSZXY7XG4gICAgICBvcHRzID0ge307XG4gICAgfSBlbHNlIHtcbiAgICAgIGNhbGxiYWNrID0gb3B0cztcbiAgICAgIG9wdHMgPSBvcHRzT3JSZXY7XG4gICAgfVxuICB9XG4gIG9wdHMgPSB1dGlscy5jbG9uZShvcHRzIHx8IHt9KTtcbiAgb3B0cy53YXNfZGVsZXRlID0gdHJ1ZTtcbiAgdmFyIG5ld0RvYyA9IHtfaWQ6IGRvYy5faWQsIF9yZXY6IChkb2MuX3JldiB8fCBvcHRzLnJldil9O1xuICBuZXdEb2MuX2RlbGV0ZWQgPSB0cnVlO1xuICBpZiAodXRpbHMuaXNMb2NhbElkKG5ld0RvYy5faWQpICYmIHR5cGVvZiB0aGlzLl9yZW1vdmVMb2NhbCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIHJldHVybiB0aGlzLl9yZW1vdmVMb2NhbChkb2MsIGNhbGxiYWNrKTtcbiAgfVxuICB0aGlzLmJ1bGtEb2NzKHtkb2NzOiBbbmV3RG9jXX0sIG9wdHMsIHlhbmtFcnJvcihjYWxsYmFjaykpO1xufSk7XG5cbkFic3RyYWN0UG91Y2hEQi5wcm90b3R5cGUucmV2c0RpZmYgPVxuICB1dGlscy5hZGFwdGVyRnVuKCdyZXZzRGlmZicsIGZ1bmN0aW9uIChyZXEsIG9wdHMsIGNhbGxiYWNrKSB7XG4gIGlmICh0eXBlb2Ygb3B0cyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIGNhbGxiYWNrID0gb3B0cztcbiAgICBvcHRzID0ge307XG4gIH1cbiAgb3B0cyA9IHV0aWxzLmNsb25lKG9wdHMpO1xuICB2YXIgaWRzID0gT2JqZWN0LmtleXMocmVxKTtcblxuICBpZiAoIWlkcy5sZW5ndGgpIHtcbiAgICByZXR1cm4gY2FsbGJhY2sobnVsbCwge30pO1xuICB9XG5cbiAgdmFyIGNvdW50ID0gMDtcbiAgdmFyIG1pc3NpbmcgPSBuZXcgdXRpbHMuTWFwKCk7XG5cbiAgZnVuY3Rpb24gYWRkVG9NaXNzaW5nKGlkLCByZXZJZCkge1xuICAgIGlmICghbWlzc2luZy5oYXMoaWQpKSB7XG4gICAgICBtaXNzaW5nLnNldChpZCwge21pc3Npbmc6IFtdfSk7XG4gICAgfVxuICAgIG1pc3NpbmcuZ2V0KGlkKS5taXNzaW5nLnB1c2gocmV2SWQpO1xuICB9XG5cbiAgZnVuY3Rpb24gcHJvY2Vzc0RvYyhpZCwgcmV2X3RyZWUpIHtcbiAgICAvLyBJcyB0aGlzIGZhc3QgZW5vdWdoPyBNYXliZSB3ZSBzaG91bGQgc3dpdGNoIHRvIGEgc2V0IHNpbXVsYXRlZCBieSBhIG1hcFxuICAgIHZhciBtaXNzaW5nRm9ySWQgPSByZXFbaWRdLnNsaWNlKDApO1xuICAgIG1lcmdlLnRyYXZlcnNlUmV2VHJlZShyZXZfdHJlZSwgZnVuY3Rpb24gKGlzTGVhZiwgcG9zLCByZXZIYXNoLCBjdHgsXG4gICAgICBvcHRzKSB7XG4gICAgICAgIHZhciByZXYgPSBwb3MgKyAnLScgKyByZXZIYXNoO1xuICAgICAgICB2YXIgaWR4ID0gbWlzc2luZ0ZvcklkLmluZGV4T2YocmV2KTtcbiAgICAgICAgaWYgKGlkeCA9PT0gLTEpIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBtaXNzaW5nRm9ySWQuc3BsaWNlKGlkeCwgMSk7XG4gICAgICAgIGlmIChvcHRzLnN0YXR1cyAhPT0gJ2F2YWlsYWJsZScpIHtcbiAgICAgICAgICBhZGRUb01pc3NpbmcoaWQsIHJldik7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgLy8gVHJhdmVyc2luZyB0aGUgdHJlZSBpcyBzeW5jaHJvbm91cywgc28gbm93IGBtaXNzaW5nRm9ySWRgIGNvbnRhaW5zXG4gICAgLy8gcmV2aXNpb25zIHRoYXQgd2VyZSBub3QgZm91bmQgaW4gdGhlIHRyZWVcbiAgICBtaXNzaW5nRm9ySWQuZm9yRWFjaChmdW5jdGlvbiAocmV2KSB7XG4gICAgICBhZGRUb01pc3NpbmcoaWQsIHJldik7XG4gICAgfSk7XG4gIH1cblxuICBpZHMubWFwKGZ1bmN0aW9uIChpZCkge1xuICAgIHRoaXMuX2dldFJldmlzaW9uVHJlZShpZCwgZnVuY3Rpb24gKGVyciwgcmV2X3RyZWUpIHtcbiAgICAgIGlmIChlcnIgJiYgZXJyLnN0YXR1cyA9PT0gNDA0ICYmIGVyci5tZXNzYWdlID09PSAnbWlzc2luZycpIHtcbiAgICAgICAgbWlzc2luZy5zZXQoaWQsIHttaXNzaW5nOiByZXFbaWRdfSk7XG4gICAgICB9IGVsc2UgaWYgKGVycikge1xuICAgICAgICByZXR1cm4gY2FsbGJhY2soZXJyKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHByb2Nlc3NEb2MoaWQsIHJldl90cmVlKTtcbiAgICAgIH1cblxuICAgICAgaWYgKCsrY291bnQgPT09IGlkcy5sZW5ndGgpIHtcbiAgICAgICAgLy8gY29udmVydCBMYXp5TWFwIHRvIG9iamVjdFxuICAgICAgICB2YXIgbWlzc2luZ09iaiA9IHt9O1xuICAgICAgICBtaXNzaW5nLmZvckVhY2goZnVuY3Rpb24gKHZhbHVlLCBrZXkpIHtcbiAgICAgICAgICBtaXNzaW5nT2JqW2tleV0gPSB2YWx1ZTtcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiBjYWxsYmFjayhudWxsLCBtaXNzaW5nT2JqKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfSwgdGhpcyk7XG59KTtcblxuLy8gY29tcGFjdCBvbmUgZG9jdW1lbnQgYW5kIGZpcmUgY2FsbGJhY2tcbi8vIGJ5IGNvbXBhY3Rpbmcgd2UgbWVhbiByZW1vdmluZyBhbGwgcmV2aXNpb25zIHdoaWNoXG4vLyBhcmUgZnVydGhlciBmcm9tIHRoZSBsZWFmIGluIHJldmlzaW9uIHRyZWUgdGhhbiBtYXhfaGVpZ2h0XG5BYnN0cmFjdFBvdWNoREIucHJvdG90eXBlLmNvbXBhY3REb2N1bWVudCA9XG4gIHV0aWxzLmFkYXB0ZXJGdW4oJ2NvbXBhY3REb2N1bWVudCcsIGZ1bmN0aW9uIChkb2NJZCwgbWF4SGVpZ2h0LCBjYWxsYmFjaykge1xuICB2YXIgc2VsZiA9IHRoaXM7XG4gIHRoaXMuX2dldFJldmlzaW9uVHJlZShkb2NJZCwgZnVuY3Rpb24gKGVyciwgcmV2VHJlZSkge1xuICAgIGlmIChlcnIpIHtcbiAgICAgIHJldHVybiBjYWxsYmFjayhlcnIpO1xuICAgIH1cbiAgICB2YXIgaGVpZ2h0ID0gY29tcHV0ZUhlaWdodChyZXZUcmVlKTtcbiAgICB2YXIgY2FuZGlkYXRlcyA9IFtdO1xuICAgIHZhciByZXZzID0gW107XG4gICAgT2JqZWN0LmtleXMoaGVpZ2h0KS5mb3JFYWNoKGZ1bmN0aW9uIChyZXYpIHtcbiAgICAgIGlmIChoZWlnaHRbcmV2XSA+IG1heEhlaWdodCkge1xuICAgICAgICBjYW5kaWRhdGVzLnB1c2gocmV2KTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIG1lcmdlLnRyYXZlcnNlUmV2VHJlZShyZXZUcmVlLCBmdW5jdGlvbiAoaXNMZWFmLCBwb3MsIHJldkhhc2gsIGN0eCwgb3B0cykge1xuICAgICAgdmFyIHJldiA9IHBvcyArICctJyArIHJldkhhc2g7XG4gICAgICBpZiAob3B0cy5zdGF0dXMgPT09ICdhdmFpbGFibGUnICYmIGNhbmRpZGF0ZXMuaW5kZXhPZihyZXYpICE9PSAtMSkge1xuICAgICAgICByZXZzLnB1c2gocmV2KTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICBzZWxmLl9kb0NvbXBhY3Rpb24oZG9jSWQsIHJldnMsIGNhbGxiYWNrKTtcbiAgfSk7XG59KTtcblxuLy8gY29tcGFjdCB0aGUgd2hvbGUgZGF0YWJhc2UgdXNpbmcgc2luZ2xlIGRvY3VtZW50XG4vLyBjb21wYWN0aW9uXG5BYnN0cmFjdFBvdWNoREIucHJvdG90eXBlLmNvbXBhY3QgPVxuICB1dGlscy5hZGFwdGVyRnVuKCdjb21wYWN0JywgZnVuY3Rpb24gKG9wdHMsIGNhbGxiYWNrKSB7XG4gIGlmICh0eXBlb2Ygb3B0cyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIGNhbGxiYWNrID0gb3B0cztcbiAgICBvcHRzID0ge307XG4gIH1cbiAgdmFyIHNlbGYgPSB0aGlzO1xuXG4gIG9wdHMgPSB1dGlscy5jbG9uZShvcHRzIHx8IHt9KTtcblxuICBzZWxmLmdldCgnX2xvY2FsL2NvbXBhY3Rpb24nKVtcImNhdGNoXCJdKGZ1bmN0aW9uICgpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH0pLnRoZW4oZnVuY3Rpb24gKGRvYykge1xuICAgIGlmICh0eXBlb2Ygc2VsZi5fY29tcGFjdCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgaWYgKGRvYyAmJiBkb2MubGFzdF9zZXEpIHtcbiAgICAgICAgb3B0cy5sYXN0X3NlcSA9IGRvYy5sYXN0X3NlcTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBzZWxmLl9jb21wYWN0KG9wdHMsIGNhbGxiYWNrKTtcbiAgICB9XG5cbiAgfSk7XG59KTtcbkFic3RyYWN0UG91Y2hEQi5wcm90b3R5cGUuX2NvbXBhY3QgPSBmdW5jdGlvbiAob3B0cywgY2FsbGJhY2spIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICB2YXIgY2hhbmdlc09wdHMgPSB7XG4gICAgcmV0dXJuRG9jczogZmFsc2UsXG4gICAgbGFzdF9zZXE6IG9wdHMubGFzdF9zZXEgfHwgMFxuICB9O1xuICB2YXIgcHJvbWlzZXMgPSBbXTtcblxuICBmdW5jdGlvbiBvbkNoYW5nZShyb3cpIHtcbiAgICBwcm9taXNlcy5wdXNoKHNlbGYuY29tcGFjdERvY3VtZW50KHJvdy5pZCwgMCkpO1xuICB9XG4gIGZ1bmN0aW9uIG9uQ29tcGxldGUocmVzcCkge1xuICAgIHZhciBsYXN0U2VxID0gcmVzcC5sYXN0X3NlcTtcbiAgICBQcm9taXNlLmFsbChwcm9taXNlcykudGhlbihmdW5jdGlvbiAoKSB7XG4gICAgICByZXR1cm4gdXBzZXJ0KHNlbGYsICdfbG9jYWwvY29tcGFjdGlvbicsIGZ1bmN0aW9uIGRlbHRhRnVuYyhkb2MpIHtcbiAgICAgICAgaWYgKCFkb2MubGFzdF9zZXEgfHwgZG9jLmxhc3Rfc2VxIDwgbGFzdFNlcSkge1xuICAgICAgICAgIGRvYy5sYXN0X3NlcSA9IGxhc3RTZXE7XG4gICAgICAgICAgcmV0dXJuIGRvYztcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gZmFsc2U7IC8vIHNvbWVib2R5IGVsc2UgZ290IGhlcmUgZmlyc3QsIGRvbid0IHVwZGF0ZVxuICAgICAgfSk7XG4gICAgfSkudGhlbihmdW5jdGlvbiAoKSB7XG4gICAgICBjYWxsYmFjayhudWxsLCB7b2s6IHRydWV9KTtcbiAgICB9KVtcImNhdGNoXCJdKGNhbGxiYWNrKTtcbiAgfVxuICBzZWxmLmNoYW5nZXMoY2hhbmdlc09wdHMpXG4gICAgLm9uKCdjaGFuZ2UnLCBvbkNoYW5nZSlcbiAgICAub24oJ2NvbXBsZXRlJywgb25Db21wbGV0ZSlcbiAgICAub24oJ2Vycm9yJywgY2FsbGJhY2spO1xufTtcbi8qIEJlZ2luIGFwaSB3cmFwcGVycy4gU3BlY2lmaWMgZnVuY3Rpb25hbGl0eSB0byBzdG9yYWdlIGJlbG9uZ3MgaW4gdGhlIFxuICAgX1ttZXRob2RdICovXG5BYnN0cmFjdFBvdWNoREIucHJvdG90eXBlLmdldCA9XG4gIHV0aWxzLmFkYXB0ZXJGdW4oJ2dldCcsIGZ1bmN0aW9uIChpZCwgb3B0cywgY2FsbGJhY2spIHtcbiAgaWYgKHR5cGVvZiBvcHRzID09PSAnZnVuY3Rpb24nKSB7XG4gICAgY2FsbGJhY2sgPSBvcHRzO1xuICAgIG9wdHMgPSB7fTtcbiAgfVxuICBpZiAodHlwZW9mIGlkICE9PSAnc3RyaW5nJykge1xuICAgIHJldHVybiBjYWxsYmFjayhlcnJvcnMuZXJyb3IoZXJyb3JzLklOVkFMSURfSUQpKTtcbiAgfVxuICBpZiAodXRpbHMuaXNMb2NhbElkKGlkKSAmJiB0eXBlb2YgdGhpcy5fZ2V0TG9jYWwgPT09ICdmdW5jdGlvbicpIHtcbiAgICByZXR1cm4gdGhpcy5fZ2V0TG9jYWwoaWQsIGNhbGxiYWNrKTtcbiAgfVxuICB2YXIgbGVhdmVzID0gW10sIHNlbGYgPSB0aGlzO1xuXG4gIGZ1bmN0aW9uIGZpbmlzaE9wZW5SZXZzKCkge1xuICAgIHZhciByZXN1bHQgPSBbXTtcbiAgICB2YXIgY291bnQgPSBsZWF2ZXMubGVuZ3RoO1xuICAgIGlmICghY291bnQpIHtcbiAgICAgIHJldHVybiBjYWxsYmFjayhudWxsLCByZXN1bHQpO1xuICAgIH1cbiAgICAvLyBvcmRlciB3aXRoIG9wZW5fcmV2cyBpcyB1bnNwZWNpZmllZFxuICAgIGxlYXZlcy5mb3JFYWNoKGZ1bmN0aW9uIChsZWFmKSB7XG4gICAgICBzZWxmLmdldChpZCwge1xuICAgICAgICByZXY6IGxlYWYsXG4gICAgICAgIHJldnM6IG9wdHMucmV2cyxcbiAgICAgICAgYXR0YWNobWVudHM6IG9wdHMuYXR0YWNobWVudHNcbiAgICAgIH0sIGZ1bmN0aW9uIChlcnIsIGRvYykge1xuICAgICAgICBpZiAoIWVycikge1xuICAgICAgICAgIHJlc3VsdC5wdXNoKHtvazogZG9jfSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmVzdWx0LnB1c2goe21pc3Npbmc6IGxlYWZ9KTtcbiAgICAgICAgfVxuICAgICAgICBjb3VudC0tO1xuICAgICAgICBpZiAoIWNvdW50KSB7XG4gICAgICAgICAgY2FsbGJhY2sobnVsbCwgcmVzdWx0KTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBpZiAob3B0cy5vcGVuX3JldnMpIHtcbiAgICBpZiAob3B0cy5vcGVuX3JldnMgPT09IFwiYWxsXCIpIHtcbiAgICAgIHRoaXMuX2dldFJldmlzaW9uVHJlZShpZCwgZnVuY3Rpb24gKGVyciwgcmV2X3RyZWUpIHtcbiAgICAgICAgaWYgKGVycikge1xuICAgICAgICAgIHJldHVybiBjYWxsYmFjayhlcnIpO1xuICAgICAgICB9XG4gICAgICAgIGxlYXZlcyA9IG1lcmdlLmNvbGxlY3RMZWF2ZXMocmV2X3RyZWUpLm1hcChmdW5jdGlvbiAobGVhZikge1xuICAgICAgICAgIHJldHVybiBsZWFmLnJldjtcbiAgICAgICAgfSk7XG4gICAgICAgIGZpbmlzaE9wZW5SZXZzKCk7XG4gICAgICB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKEFycmF5LmlzQXJyYXkob3B0cy5vcGVuX3JldnMpKSB7XG4gICAgICAgIGxlYXZlcyA9IG9wdHMub3Blbl9yZXZzO1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGxlYXZlcy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgIHZhciBsID0gbGVhdmVzW2ldO1xuICAgICAgICAgIC8vIGxvb2tzIGxpa2UgaXQncyB0aGUgb25seSB0aGluZyBjb3VjaGRiIGNoZWNrc1xuICAgICAgICAgIGlmICghKHR5cGVvZihsKSA9PT0gXCJzdHJpbmdcIiAmJiAvXlxcZCstLy50ZXN0KGwpKSkge1xuICAgICAgICAgICAgcmV0dXJuIGNhbGxiYWNrKGVycm9ycy5lcnJvcihlcnJvcnMuSU5WQUxJRF9SRVYpKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgZmluaXNoT3BlblJldnMoKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiBjYWxsYmFjayhlcnJvcnMuZXJyb3IoZXJyb3JzLlVOS05PV05fRVJST1IsXG4gICAgICAgICAgJ2Z1bmN0aW9uX2NsYXVzZScpKTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuOyAvLyBvcGVuX3JldnMgZG9lcyBub3QgbGlrZSBvdGhlciBvcHRpb25zXG4gIH1cblxuICByZXR1cm4gdGhpcy5fZ2V0KGlkLCBvcHRzLCBmdW5jdGlvbiAoZXJyLCByZXN1bHQpIHtcbiAgICBvcHRzID0gdXRpbHMuY2xvbmUob3B0cyk7XG4gICAgaWYgKGVycikge1xuICAgICAgcmV0dXJuIGNhbGxiYWNrKGVycik7XG4gICAgfVxuXG4gICAgdmFyIGRvYyA9IHJlc3VsdC5kb2M7XG4gICAgdmFyIG1ldGFkYXRhID0gcmVzdWx0Lm1ldGFkYXRhO1xuICAgIHZhciBjdHggPSByZXN1bHQuY3R4O1xuXG4gICAgaWYgKG9wdHMuY29uZmxpY3RzKSB7XG4gICAgICB2YXIgY29uZmxpY3RzID0gbWVyZ2UuY29sbGVjdENvbmZsaWN0cyhtZXRhZGF0YSk7XG4gICAgICBpZiAoY29uZmxpY3RzLmxlbmd0aCkge1xuICAgICAgICBkb2MuX2NvbmZsaWN0cyA9IGNvbmZsaWN0cztcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAodXRpbHMuaXNEZWxldGVkKG1ldGFkYXRhLCBkb2MuX3JldikpIHtcbiAgICAgIGRvYy5fZGVsZXRlZCA9IHRydWU7XG4gICAgfVxuXG4gICAgaWYgKG9wdHMucmV2cyB8fCBvcHRzLnJldnNfaW5mbykge1xuICAgICAgdmFyIHBhdGhzID0gbWVyZ2Uucm9vdFRvTGVhZihtZXRhZGF0YS5yZXZfdHJlZSk7XG4gICAgICB2YXIgcGF0aCA9IGFycmF5Rmlyc3QocGF0aHMsIGZ1bmN0aW9uIChhcnIpIHtcbiAgICAgICAgcmV0dXJuIGFyci5pZHMubWFwKGZ1bmN0aW9uICh4KSB7IHJldHVybiB4LmlkOyB9KVxuICAgICAgICAgIC5pbmRleE9mKGRvYy5fcmV2LnNwbGl0KCctJylbMV0pICE9PSAtMTtcbiAgICAgIH0pO1xuXG4gICAgICB2YXIgaW5kZXhPZlJldiA9IHBhdGguaWRzLm1hcChmdW5jdGlvbiAoeCkge3JldHVybiB4LmlkOyB9KVxuICAgICAgICAuaW5kZXhPZihkb2MuX3Jldi5zcGxpdCgnLScpWzFdKSArIDE7XG4gICAgICB2YXIgaG93TWFueSA9IHBhdGguaWRzLmxlbmd0aCAtIGluZGV4T2ZSZXY7XG4gICAgICBwYXRoLmlkcy5zcGxpY2UoaW5kZXhPZlJldiwgaG93TWFueSk7XG4gICAgICBwYXRoLmlkcy5yZXZlcnNlKCk7XG5cbiAgICAgIGlmIChvcHRzLnJldnMpIHtcbiAgICAgICAgZG9jLl9yZXZpc2lvbnMgPSB7XG4gICAgICAgICAgc3RhcnQ6IChwYXRoLnBvcyArIHBhdGguaWRzLmxlbmd0aCkgLSAxLFxuICAgICAgICAgIGlkczogcGF0aC5pZHMubWFwKGZ1bmN0aW9uIChyZXYpIHtcbiAgICAgICAgICAgIHJldHVybiByZXYuaWQ7XG4gICAgICAgICAgfSlcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICAgIGlmIChvcHRzLnJldnNfaW5mbykge1xuICAgICAgICB2YXIgcG9zID0gIHBhdGgucG9zICsgcGF0aC5pZHMubGVuZ3RoO1xuICAgICAgICBkb2MuX3JldnNfaW5mbyA9IHBhdGguaWRzLm1hcChmdW5jdGlvbiAocmV2KSB7XG4gICAgICAgICAgcG9zLS07XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHJldjogcG9zICsgJy0nICsgcmV2LmlkLFxuICAgICAgICAgICAgc3RhdHVzOiByZXYub3B0cy5zdGF0dXNcbiAgICAgICAgICB9O1xuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAob3B0cy5sb2NhbF9zZXEpIHtcbiAgICAgIHV0aWxzLmluZm8oJ1RoZSBcImxvY2FsX3NlcVwiIG9wdGlvbiBpcyBkZXByZWNhdGVkIGFuZCB3aWxsIGJlIHJlbW92ZWQnKTtcbiAgICAgIGRvYy5fbG9jYWxfc2VxID0gcmVzdWx0Lm1ldGFkYXRhLnNlcTtcbiAgICB9XG5cbiAgICBpZiAob3B0cy5hdHRhY2htZW50cyAmJiBkb2MuX2F0dGFjaG1lbnRzKSB7XG4gICAgICB2YXIgYXR0YWNobWVudHMgPSBkb2MuX2F0dGFjaG1lbnRzO1xuICAgICAgdmFyIGNvdW50ID0gT2JqZWN0LmtleXMoYXR0YWNobWVudHMpLmxlbmd0aDtcbiAgICAgIGlmIChjb3VudCA9PT0gMCkge1xuICAgICAgICByZXR1cm4gY2FsbGJhY2sobnVsbCwgZG9jKTtcbiAgICAgIH1cbiAgICAgIE9iamVjdC5rZXlzKGF0dGFjaG1lbnRzKS5mb3JFYWNoKGZ1bmN0aW9uIChrZXkpIHtcbiAgICAgICAgdGhpcy5fZ2V0QXR0YWNobWVudChhdHRhY2htZW50c1trZXldLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHtlbmNvZGU6IHRydWUsIGN0eDogY3R4fSwgZnVuY3Rpb24gKGVyciwgZGF0YSkge1xuICAgICAgICAgIHZhciBhdHQgPSBkb2MuX2F0dGFjaG1lbnRzW2tleV07XG4gICAgICAgICAgYXR0LmRhdGEgPSBkYXRhO1xuICAgICAgICAgIGRlbGV0ZSBhdHQuc3R1YjtcbiAgICAgICAgICBkZWxldGUgYXR0Lmxlbmd0aDtcbiAgICAgICAgICBpZiAoIS0tY291bnQpIHtcbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRvYyk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH0sIHNlbGYpO1xuICAgIH0gZWxzZSB7XG4gICAgICBpZiAoZG9jLl9hdHRhY2htZW50cykge1xuICAgICAgICBmb3IgKHZhciBrZXkgaW4gZG9jLl9hdHRhY2htZW50cykge1xuICAgICAgICAgIGlmIChkb2MuX2F0dGFjaG1lbnRzLmhhc093blByb3BlcnR5KGtleSkpIHtcbiAgICAgICAgICAgIGRvYy5fYXR0YWNobWVudHNba2V5XS5zdHViID0gdHJ1ZTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGNhbGxiYWNrKG51bGwsIGRvYyk7XG4gICAgfVxuICB9KTtcbn0pO1xuXG5BYnN0cmFjdFBvdWNoREIucHJvdG90eXBlLmdldEF0dGFjaG1lbnQgPVxuICB1dGlscy5hZGFwdGVyRnVuKCdnZXRBdHRhY2htZW50JywgZnVuY3Rpb24gKGRvY0lkLCBhdHRhY2htZW50SWQsIG9wdHMsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2FsbGJhY2spIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICBpZiAob3B0cyBpbnN0YW5jZW9mIEZ1bmN0aW9uKSB7XG4gICAgY2FsbGJhY2sgPSBvcHRzO1xuICAgIG9wdHMgPSB7fTtcbiAgfVxuICBvcHRzID0gdXRpbHMuY2xvbmUob3B0cyk7XG4gIHRoaXMuX2dldChkb2NJZCwgb3B0cywgZnVuY3Rpb24gKGVyciwgcmVzKSB7XG4gICAgaWYgKGVycikge1xuICAgICAgcmV0dXJuIGNhbGxiYWNrKGVycik7XG4gICAgfVxuICAgIGlmIChyZXMuZG9jLl9hdHRhY2htZW50cyAmJiByZXMuZG9jLl9hdHRhY2htZW50c1thdHRhY2htZW50SWRdKSB7XG4gICAgICBvcHRzLmN0eCA9IHJlcy5jdHg7XG4gICAgICBzZWxmLl9nZXRBdHRhY2htZW50KHJlcy5kb2MuX2F0dGFjaG1lbnRzW2F0dGFjaG1lbnRJZF0sIG9wdHMsIGNhbGxiYWNrKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIGNhbGxiYWNrKGVycm9ycy5lcnJvcihlcnJvcnMuTUlTU0lOR19ET0MpKTtcbiAgICB9XG4gIH0pO1xufSk7XG5cbkFic3RyYWN0UG91Y2hEQi5wcm90b3R5cGUuYWxsRG9jcyA9XG4gIHV0aWxzLmFkYXB0ZXJGdW4oJ2FsbERvY3MnLCBmdW5jdGlvbiAob3B0cywgY2FsbGJhY2spIHtcbiAgaWYgKHR5cGVvZiBvcHRzID09PSAnZnVuY3Rpb24nKSB7XG4gICAgY2FsbGJhY2sgPSBvcHRzO1xuICAgIG9wdHMgPSB7fTtcbiAgfVxuICBvcHRzID0gdXRpbHMuY2xvbmUob3B0cyk7XG4gIG9wdHMuc2tpcCA9IHR5cGVvZiBvcHRzLnNraXAgIT09ICd1bmRlZmluZWQnID8gb3B0cy5za2lwIDogMDtcbiAgaWYgKCdrZXlzJyBpbiBvcHRzKSB7XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KG9wdHMua2V5cykpIHtcbiAgICAgIHJldHVybiBjYWxsYmFjayhuZXcgVHlwZUVycm9yKCdvcHRpb25zLmtleXMgbXVzdCBiZSBhbiBhcnJheScpKTtcbiAgICB9XG4gICAgdmFyIGluY29tcGF0aWJsZU9wdCA9XG4gICAgICBbJ3N0YXJ0a2V5JywgJ2VuZGtleScsICdrZXknXS5maWx0ZXIoZnVuY3Rpb24gKGluY29tcGF0aWJsZU9wdCkge1xuICAgICAgcmV0dXJuIGluY29tcGF0aWJsZU9wdCBpbiBvcHRzO1xuICAgIH0pWzBdO1xuICAgIGlmIChpbmNvbXBhdGlibGVPcHQpIHtcbiAgICAgIGNhbGxiYWNrKGVycm9ycy5lcnJvcihlcnJvcnMuUVVFUllfUEFSU0VfRVJST1IsXG4gICAgICAgICdRdWVyeSBwYXJhbWV0ZXIgYCcgKyBpbmNvbXBhdGlibGVPcHQgK1xuICAgICAgICAnYCBpcyBub3QgY29tcGF0aWJsZSB3aXRoIG11bHRpLWdldCdcbiAgICAgICkpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAodGhpcy50eXBlKCkgIT09ICdodHRwJykge1xuICAgICAgcmV0dXJuIGFsbERvY3NLZXlzUXVlcnkodGhpcywgb3B0cywgY2FsbGJhY2spO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiB0aGlzLl9hbGxEb2NzKG9wdHMsIGNhbGxiYWNrKTtcbn0pO1xuXG5BYnN0cmFjdFBvdWNoREIucHJvdG90eXBlLmNoYW5nZXMgPSBmdW5jdGlvbiAob3B0cywgY2FsbGJhY2spIHtcbiAgaWYgKHR5cGVvZiBvcHRzID09PSAnZnVuY3Rpb24nKSB7XG4gICAgY2FsbGJhY2sgPSBvcHRzO1xuICAgIG9wdHMgPSB7fTtcbiAgfVxuICByZXR1cm4gbmV3IENoYW5nZXModGhpcywgb3B0cywgY2FsbGJhY2spO1xufTtcblxuQWJzdHJhY3RQb3VjaERCLnByb3RvdHlwZS5jbG9zZSA9XG4gIHV0aWxzLmFkYXB0ZXJGdW4oJ2Nsb3NlJywgZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gIHRoaXMuX2Nsb3NlZCA9IHRydWU7XG4gIHJldHVybiB0aGlzLl9jbG9zZShjYWxsYmFjayk7XG59KTtcblxuQWJzdHJhY3RQb3VjaERCLnByb3RvdHlwZS5pbmZvID0gdXRpbHMuYWRhcHRlckZ1bignaW5mbycsIGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICB2YXIgc2VsZiA9IHRoaXM7XG4gIHRoaXMuX2luZm8oZnVuY3Rpb24gKGVyciwgaW5mbykge1xuICAgIGlmIChlcnIpIHtcbiAgICAgIHJldHVybiBjYWxsYmFjayhlcnIpO1xuICAgIH1cbiAgICAvLyBhc3N1bWUgd2Uga25vdyBiZXR0ZXIgdGhhbiB0aGUgYWRhcHRlciwgdW5sZXNzIGl0IGluZm9ybXMgdXNcbiAgICBpbmZvLmRiX25hbWUgPSBpbmZvLmRiX25hbWUgfHwgc2VsZi5fZGJfbmFtZTtcbiAgICBpbmZvLmF1dG9fY29tcGFjdGlvbiA9ICEhKHNlbGYuYXV0b19jb21wYWN0aW9uICYmIHNlbGYudHlwZSgpICE9PSAnaHR0cCcpO1xuICAgIGNhbGxiYWNrKG51bGwsIGluZm8pO1xuICB9KTtcbn0pO1xuXG5BYnN0cmFjdFBvdWNoREIucHJvdG90eXBlLmlkID0gdXRpbHMuYWRhcHRlckZ1bignaWQnLCBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgcmV0dXJuIHRoaXMuX2lkKGNhbGxiYWNrKTtcbn0pO1xuXG5BYnN0cmFjdFBvdWNoREIucHJvdG90eXBlLnR5cGUgPSBmdW5jdGlvbiAoKSB7XG4gIHJldHVybiAodHlwZW9mIHRoaXMuX3R5cGUgPT09ICdmdW5jdGlvbicpID8gdGhpcy5fdHlwZSgpIDogdGhpcy5hZGFwdGVyO1xufTtcblxuQWJzdHJhY3RQb3VjaERCLnByb3RvdHlwZS5idWxrRG9jcyA9XG4gIHV0aWxzLmFkYXB0ZXJGdW4oJ2J1bGtEb2NzJywgZnVuY3Rpb24gKHJlcSwgb3B0cywgY2FsbGJhY2spIHtcbiAgaWYgKHR5cGVvZiBvcHRzID09PSAnZnVuY3Rpb24nKSB7XG4gICAgY2FsbGJhY2sgPSBvcHRzO1xuICAgIG9wdHMgPSB7fTtcbiAgfVxuXG4gIG9wdHMgPSB1dGlscy5jbG9uZShvcHRzKTtcblxuICBpZiAoQXJyYXkuaXNBcnJheShyZXEpKSB7XG4gICAgcmVxID0ge1xuICAgICAgZG9jczogcmVxXG4gICAgfTtcbiAgfVxuXG4gIGlmICghcmVxIHx8ICFyZXEuZG9jcyB8fCAhQXJyYXkuaXNBcnJheShyZXEuZG9jcykpIHtcbiAgICByZXR1cm4gY2FsbGJhY2soZXJyb3JzLmVycm9yKGVycm9ycy5NSVNTSU5HX0JVTEtfRE9DUykpO1xuICB9XG5cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCByZXEuZG9jcy5sZW5ndGg7ICsraSkge1xuICAgIGlmICh0eXBlb2YgcmVxLmRvY3NbaV0gIT09ICdvYmplY3QnIHx8IEFycmF5LmlzQXJyYXkocmVxLmRvY3NbaV0pKSB7XG4gICAgICByZXR1cm4gY2FsbGJhY2soZXJyb3JzLmVycm9yKGVycm9ycy5OT1RfQU5fT0JKRUNUKSk7XG4gICAgfVxuICB9XG5cbiAgcmVxID0gdXRpbHMuY2xvbmUocmVxKTtcbiAgaWYgKCEoJ25ld19lZGl0cycgaW4gb3B0cykpIHtcbiAgICBpZiAoJ25ld19lZGl0cycgaW4gcmVxKSB7XG4gICAgICBvcHRzLm5ld19lZGl0cyA9IHJlcS5uZXdfZWRpdHM7XG4gICAgfSBlbHNlIHtcbiAgICAgIG9wdHMubmV3X2VkaXRzID0gdHJ1ZTtcbiAgICB9XG4gIH1cblxuICBpZiAoIW9wdHMubmV3X2VkaXRzICYmIHRoaXMudHlwZSgpICE9PSAnaHR0cCcpIHtcbiAgICAvLyBlbnN1cmUgcmV2aXNpb25zIG9mIHRoZSBzYW1lIGRvYyBhcmUgc29ydGVkLCBzbyB0aGF0XG4gICAgLy8gdGhlIGxvY2FsIGFkYXB0ZXIgcHJvY2Vzc2VzIHRoZW0gY29ycmVjdGx5ICgjMjkzNSlcbiAgICByZXEuZG9jcy5zb3J0KGZ1bmN0aW9uIChhLCBiKSB7XG4gICAgICB2YXIgaWRDb21wYXJlID0gdXRpbHMuY29tcGFyZShhLl9pZCwgYi5faWQpO1xuICAgICAgaWYgKGlkQ29tcGFyZSAhPT0gMCkge1xuICAgICAgICByZXR1cm4gaWRDb21wYXJlO1xuICAgICAgfVxuICAgICAgdmFyIGFTdGFydCA9IGEuX3JldmlzaW9ucyA/IGEuX3JldmlzaW9ucy5zdGFydCA6IDA7XG4gICAgICB2YXIgYlN0YXJ0ID0gYi5fcmV2aXNpb25zID8gYi5fcmV2aXNpb25zLnN0YXJ0IDogMDtcbiAgICAgIHJldHVybiB1dGlscy5jb21wYXJlKGFTdGFydCwgYlN0YXJ0KTtcbiAgICB9KTtcbiAgfVxuXG4gIHJlcS5kb2NzLmZvckVhY2goZnVuY3Rpb24gKGRvYykge1xuICAgIGlmIChkb2MuX2RlbGV0ZWQpIHtcbiAgICAgIGRlbGV0ZSBkb2MuX2F0dGFjaG1lbnRzOyAvLyBpZ25vcmUgYXR0cyBmb3IgZGVsZXRlZCBkb2NzXG4gICAgfVxuICB9KTtcblxuICByZXR1cm4gdGhpcy5fYnVsa0RvY3MocmVxLCBvcHRzLCBmdW5jdGlvbiAoZXJyLCByZXMpIHtcbiAgICBpZiAoZXJyKSB7XG4gICAgICByZXR1cm4gY2FsbGJhY2soZXJyKTtcbiAgICB9XG4gICAgaWYgKCFvcHRzLm5ld19lZGl0cykge1xuICAgICAgLy8gdGhpcyBpcyB3aGF0IGNvdWNoIGRvZXMgd2hlbiBuZXdfZWRpdHMgaXMgZmFsc2VcbiAgICAgIHJlcyA9IHJlcy5maWx0ZXIoZnVuY3Rpb24gKHgpIHtcbiAgICAgICAgcmV0dXJuIHguZXJyb3I7XG4gICAgICB9KTtcbiAgICB9XG4gICAgY2FsbGJhY2sobnVsbCwgcmVzKTtcbiAgfSk7XG59KTtcblxuQWJzdHJhY3RQb3VjaERCLnByb3RvdHlwZS5yZWdpc3RlckRlcGVuZGVudERhdGFiYXNlID1cbiAgdXRpbHMuYWRhcHRlckZ1bigncmVnaXN0ZXJEZXBlbmRlbnREYXRhYmFzZScsIGZ1bmN0aW9uIChkZXBlbmRlbnREYixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjYWxsYmFjaykge1xuICB2YXIgZGVwREIgPSBuZXcgdGhpcy5jb25zdHJ1Y3RvcihkZXBlbmRlbnREYiwgdGhpcy5fX29wdHMgfHwge30pO1xuXG4gIGZ1bmN0aW9uIGRpZmZGdW4oZG9jKSB7XG4gICAgZG9jLmRlcGVuZGVudERicyA9IGRvYy5kZXBlbmRlbnREYnMgfHwge307XG4gICAgaWYgKGRvYy5kZXBlbmRlbnREYnNbZGVwZW5kZW50RGJdKSB7XG4gICAgICByZXR1cm4gZmFsc2U7IC8vIG5vIHVwZGF0ZSByZXF1aXJlZFxuICAgIH1cbiAgICBkb2MuZGVwZW5kZW50RGJzW2RlcGVuZGVudERiXSA9IHRydWU7XG4gICAgcmV0dXJuIGRvYztcbiAgfVxuICB1cHNlcnQodGhpcywgJ19sb2NhbC9fcG91Y2hfZGVwZW5kZW50RGJzJywgZGlmZkZ1biwgZnVuY3Rpb24gKGVycikge1xuICAgIGlmIChlcnIpIHtcbiAgICAgIHJldHVybiBjYWxsYmFjayhlcnIpO1xuICAgIH1cbiAgICByZXR1cm4gY2FsbGJhY2sobnVsbCwge2RiOiBkZXBEQn0pO1xuICB9KTtcbn0pO1xuIiwiXCJ1c2Ugc3RyaWN0XCI7XG5cbnZhciBDSEFOR0VTX0JBVENIX1NJWkUgPSAyNTtcblxuLy8gYWNjb3JkaW5nIHRvIGh0dHA6Ly9zdGFja292ZXJmbG93LmNvbS9hLzQxNzE4NC82ODA3NDIsXG4vLyB0aGUgZGUgZmFjdG9yIFVSTCBsZW5ndGggbGltaXQgaXMgMjAwMCBjaGFyYWN0ZXJzLlxuLy8gYnV0IHNpbmNlIG1vc3Qgb2Ygb3VyIG1lYXN1cmVtZW50cyBkb24ndCB0YWtlIHRoZSBmdWxsXG4vLyBVUkwgaW50byBhY2NvdW50LCB3ZSBmdWRnZSBpdCBhIGJpdC5cbi8vIFRPRE86IHdlIGNvdWxkIG1lYXN1cmUgdGhlIGZ1bGwgVVJMIHRvIGVuZm9yY2UgZXhhY3RseSAyMDAwIGNoYXJzXG52YXIgTUFYX1VSTF9MRU5HVEggPSAxODAwO1xuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuLi8uLi91dGlscycpO1xudmFyIGVycm9ycyA9IHJlcXVpcmUoJy4uLy4uL2RlcHMvZXJyb3JzJyk7XG52YXIgbG9nID0gcmVxdWlyZSgnZGVidWcnKSgncG91Y2hkYjpodHRwJyk7XG52YXIgaXNCcm93c2VyID0gdHlwZW9mIHByb2Nlc3MgPT09ICd1bmRlZmluZWQnIHx8IHByb2Nlc3MuYnJvd3NlcjtcbnZhciBidWZmZXIgPSByZXF1aXJlKCcuLi8uLi9kZXBzL2J1ZmZlcicpO1xuXG5mdW5jdGlvbiBlbmNvZGVEb2NJZChpZCkge1xuICBpZiAoL15fZGVzaWduLy50ZXN0KGlkKSkge1xuICAgIHJldHVybiAnX2Rlc2lnbi8nICsgZW5jb2RlVVJJQ29tcG9uZW50KGlkLnNsaWNlKDgpKTtcbiAgfVxuICBpZiAoL15fbG9jYWwvLnRlc3QoaWQpKSB7XG4gICAgcmV0dXJuICdfbG9jYWwvJyArIGVuY29kZVVSSUNvbXBvbmVudChpZC5zbGljZSg3KSk7XG4gIH1cbiAgcmV0dXJuIGVuY29kZVVSSUNvbXBvbmVudChpZCk7XG59XG5cbmZ1bmN0aW9uIHByZXByb2Nlc3NBdHRhY2htZW50cyhkb2MpIHtcbiAgaWYgKCFkb2MuX2F0dGFjaG1lbnRzIHx8ICFPYmplY3Qua2V5cyhkb2MuX2F0dGFjaG1lbnRzKSkge1xuICAgIHJldHVybiB1dGlscy5Qcm9taXNlLnJlc29sdmUoKTtcbiAgfVxuXG4gIHJldHVybiB1dGlscy5Qcm9taXNlLmFsbChPYmplY3Qua2V5cyhkb2MuX2F0dGFjaG1lbnRzKS5tYXAoZnVuY3Rpb24gKGtleSkge1xuICAgIHZhciBhdHRhY2htZW50ID0gZG9jLl9hdHRhY2htZW50c1trZXldO1xuICAgIGlmIChhdHRhY2htZW50LmRhdGEgJiYgdHlwZW9mIGF0dGFjaG1lbnQuZGF0YSAhPT0gJ3N0cmluZycpIHtcbiAgICAgIGlmIChpc0Jyb3dzZXIpIHtcbiAgICAgICAgcmV0dXJuIG5ldyB1dGlscy5Qcm9taXNlKGZ1bmN0aW9uIChyZXNvbHZlKSB7XG4gICAgICAgICAgdXRpbHMucmVhZEFzQmluYXJ5U3RyaW5nKGF0dGFjaG1lbnQuZGF0YSwgZnVuY3Rpb24gKGJpbmFyeSkge1xuICAgICAgICAgICAgYXR0YWNobWVudC5kYXRhID0gdXRpbHMuYnRvYShiaW5hcnkpO1xuICAgICAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGF0dGFjaG1lbnQuZGF0YSA9IGF0dGFjaG1lbnQuZGF0YS50b1N0cmluZygnYmFzZTY0Jyk7XG4gICAgICB9XG4gICAgfVxuICB9KSk7XG59XG5cbi8vIEdldCBhbGwgdGhlIGluZm9ybWF0aW9uIHlvdSBwb3NzaWJseSBjYW4gYWJvdXQgdGhlIFVSSSBnaXZlbiBieSBuYW1lIGFuZFxuLy8gcmV0dXJuIGl0IGFzIGEgc3VpdGFibGUgb2JqZWN0LlxuZnVuY3Rpb24gZ2V0SG9zdChuYW1lLCBvcHRzKSB7XG4gIC8vIElmIHRoZSBnaXZlbiBuYW1lIGNvbnRhaW5zIFwiaHR0cDpcIlxuICBpZiAoL2h0dHAocz8pOi8udGVzdChuYW1lKSkge1xuICAgIC8vIFByYXNlIHRoZSBVUkkgaW50byBhbGwgaXRzIGxpdHRsZSBiaXRzXG4gICAgdmFyIHVyaSA9IHV0aWxzLnBhcnNlVXJpKG5hbWUpO1xuXG4gICAgLy8gU3RvcmUgdGhlIGZhY3QgdGhhdCBpdCBpcyBhIHJlbW90ZSBVUklcbiAgICB1cmkucmVtb3RlID0gdHJ1ZTtcblxuICAgIC8vIFN0b3JlIHRoZSB1c2VyIGFuZCBwYXNzd29yZCBhcyBhIHNlcGFyYXRlIGF1dGggb2JqZWN0XG4gICAgaWYgKHVyaS51c2VyIHx8IHVyaS5wYXNzd29yZCkge1xuICAgICAgdXJpLmF1dGggPSB7dXNlcm5hbWU6IHVyaS51c2VyLCBwYXNzd29yZDogdXJpLnBhc3N3b3JkfTtcbiAgICB9XG5cbiAgICAvLyBTcGxpdCB0aGUgcGF0aCBwYXJ0IG9mIHRoZSBVUkkgaW50byBwYXJ0cyB1c2luZyAnLycgYXMgdGhlIGRlbGltaXRlclxuICAgIC8vIGFmdGVyIHJlbW92aW5nIGFueSBsZWFkaW5nICcvJyBhbmQgYW55IHRyYWlsaW5nICcvJ1xuICAgIHZhciBwYXJ0cyA9IHVyaS5wYXRoLnJlcGxhY2UoLyheXFwvfFxcLyQpL2csICcnKS5zcGxpdCgnLycpO1xuXG4gICAgLy8gU3RvcmUgdGhlIGZpcnN0IHBhcnQgYXMgdGhlIGRhdGFiYXNlIG5hbWUgYW5kIHJlbW92ZSBpdCBmcm9tIHRoZSBwYXJ0c1xuICAgIC8vIGFycmF5XG4gICAgdXJpLmRiID0gcGFydHMucG9wKCk7XG5cbiAgICAvLyBSZXN0b3JlIHRoZSBwYXRoIGJ5IGpvaW5pbmcgYWxsIHRoZSByZW1haW5pbmcgcGFydHMgKGFsbCB0aGUgcGFydHNcbiAgICAvLyBleGNlcHQgZm9yIHRoZSBkYXRhYmFzZSBuYW1lKSB3aXRoICcvJ3NcbiAgICB1cmkucGF0aCA9IHBhcnRzLmpvaW4oJy8nKTtcbiAgICBvcHRzID0gb3B0cyB8fCB7fTtcbiAgICBvcHRzID0gdXRpbHMuY2xvbmUob3B0cyk7XG4gICAgdXJpLmhlYWRlcnMgPSBvcHRzLmhlYWRlcnMgfHwgKG9wdHMuYWpheCAmJiBvcHRzLmFqYXguaGVhZGVycykgfHwge307XG5cbiAgICBpZiAob3B0cy5hdXRoIHx8IHVyaS5hdXRoKSB7XG4gICAgICB2YXIgbkF1dGggPSBvcHRzLmF1dGggfHwgdXJpLmF1dGg7XG4gICAgICB2YXIgdG9rZW4gPSB1dGlscy5idG9hKG5BdXRoLnVzZXJuYW1lICsgJzonICsgbkF1dGgucGFzc3dvcmQpO1xuICAgICAgdXJpLmhlYWRlcnMuQXV0aG9yaXphdGlvbiA9ICdCYXNpYyAnICsgdG9rZW47XG4gICAgfVxuXG4gICAgaWYgKG9wdHMuaGVhZGVycykge1xuICAgICAgdXJpLmhlYWRlcnMgPSBvcHRzLmhlYWRlcnM7XG4gICAgfVxuXG4gICAgcmV0dXJuIHVyaTtcbiAgfVxuXG4gIC8vIElmIHRoZSBnaXZlbiBuYW1lIGRvZXMgbm90IGNvbnRhaW4gJ2h0dHA6JyB0aGVuIHJldHVybiBhIHZlcnkgYmFzaWMgb2JqZWN0XG4gIC8vIHdpdGggbm8gaG9zdCwgdGhlIGN1cnJlbnQgcGF0aCwgdGhlIGdpdmVuIG5hbWUgYXMgdGhlIGRhdGFiYXNlIG5hbWUgYW5kIG5vXG4gIC8vIHVzZXJuYW1lL3Bhc3N3b3JkXG4gIHJldHVybiB7aG9zdDogJycsIHBhdGg6ICcvJywgZGI6IG5hbWUsIGF1dGg6IGZhbHNlfTtcbn1cblxuLy8gR2VuZXJhdGUgYSBVUkwgd2l0aCB0aGUgaG9zdCBkYXRhIGdpdmVuIGJ5IG9wdHMgYW5kIHRoZSBnaXZlbiBwYXRoXG5mdW5jdGlvbiBnZW5EQlVybChvcHRzLCBwYXRoKSB7XG4gIHJldHVybiBnZW5Vcmwob3B0cywgb3B0cy5kYiArICcvJyArIHBhdGgpO1xufVxuXG4vLyBHZW5lcmF0ZSBhIFVSTCB3aXRoIHRoZSBob3N0IGRhdGEgZ2l2ZW4gYnkgb3B0cyBhbmQgdGhlIGdpdmVuIHBhdGhcbmZ1bmN0aW9uIGdlblVybChvcHRzLCBwYXRoKSB7XG4gIGlmIChvcHRzLnJlbW90ZSkge1xuICAgIC8vIElmIHRoZSBob3N0IGFscmVhZHkgaGFzIGEgcGF0aCwgdGhlbiB3ZSBuZWVkIHRvIGhhdmUgYSBwYXRoIGRlbGltaXRlclxuICAgIC8vIE90aGVyd2lzZSwgdGhlIHBhdGggZGVsaW1pdGVyIGlzIHRoZSBlbXB0eSBzdHJpbmdcbiAgICB2YXIgcGF0aERlbCA9ICFvcHRzLnBhdGggPyAnJyA6ICcvJztcblxuICAgIC8vIElmIHRoZSBob3N0IGFscmVhZHkgaGFzIGEgcGF0aCwgdGhlbiB3ZSBuZWVkIHRvIGhhdmUgYSBwYXRoIGRlbGltaXRlclxuICAgIC8vIE90aGVyd2lzZSwgdGhlIHBhdGggZGVsaW1pdGVyIGlzIHRoZSBlbXB0eSBzdHJpbmdcbiAgICByZXR1cm4gb3B0cy5wcm90b2NvbCArICc6Ly8nICsgb3B0cy5ob3N0ICsgJzonICsgb3B0cy5wb3J0ICsgJy8nICtcbiAgICAgICAgICAgb3B0cy5wYXRoICsgcGF0aERlbCArIHBhdGg7XG4gIH1cblxuICByZXR1cm4gJy8nICsgcGF0aDtcbn1cblxuLy8gSW1wbGVtZW50cyB0aGUgUG91Y2hEQiBBUEkgZm9yIGRlYWxpbmcgd2l0aCBDb3VjaERCIGluc3RhbmNlcyBvdmVyIEhUVFBcbmZ1bmN0aW9uIEh0dHBQb3VjaChvcHRzLCBjYWxsYmFjaykge1xuICAvLyBUaGUgZnVuY3Rpb25zIHRoYXQgd2lsbCBiZSBwdWJsaWNseSBhdmFpbGFibGUgZm9yIEh0dHBQb3VjaFxuICB2YXIgYXBpID0gdGhpcztcbiAgYXBpLmdldEhvc3QgPSBvcHRzLmdldEhvc3QgPyBvcHRzLmdldEhvc3QgOiBnZXRIb3N0O1xuXG4gIC8vIFBhcnNlIHRoZSBVUkkgZ2l2ZW4gYnkgb3B0cy5uYW1lIGludG8gYW4gZWFzeS10by11c2Ugb2JqZWN0XG4gIHZhciBob3N0ID0gYXBpLmdldEhvc3Qob3B0cy5uYW1lLCBvcHRzKTtcblxuICAvLyBHZW5lcmF0ZSB0aGUgZGF0YWJhc2UgVVJMIGJhc2VkIG9uIHRoZSBob3N0XG4gIHZhciBkYlVybCA9IGdlbkRCVXJsKGhvc3QsICcnKTtcblxuICBhcGkuZ2V0VXJsID0gZnVuY3Rpb24gKCkge3JldHVybiBkYlVybDsgfTtcbiAgYXBpLmdldEhlYWRlcnMgPSBmdW5jdGlvbiAoKSB7cmV0dXJuIHV0aWxzLmNsb25lKGhvc3QuaGVhZGVycyk7IH07XG5cbiAgdmFyIGFqYXhPcHRzID0gb3B0cy5hamF4IHx8IHt9O1xuICBvcHRzID0gdXRpbHMuY2xvbmUob3B0cyk7XG4gIGZ1bmN0aW9uIGFqYXgob3B0aW9ucywgY2FsbGJhY2spIHtcbiAgICB2YXIgcmVxT3B0cyA9IHV0aWxzLmV4dGVuZCh0cnVlLCB1dGlscy5jbG9uZShhamF4T3B0cyksIG9wdGlvbnMpO1xuICAgIGxvZyhyZXFPcHRzLm1ldGhvZCArICcgJyArIHJlcU9wdHMudXJsKTtcbiAgICByZXR1cm4gdXRpbHMuYWpheChyZXFPcHRzLCBjYWxsYmFjayk7XG4gIH1cblxuICAvLyBDcmVhdGUgYSBuZXcgQ291Y2hEQiBkYXRhYmFzZSBiYXNlZCBvbiB0aGUgZ2l2ZW4gb3B0c1xuICB2YXIgY3JlYXRlREIgPSBmdW5jdGlvbiAoKSB7XG4gICAgYWpheCh7aGVhZGVyczogaG9zdC5oZWFkZXJzLCBtZXRob2Q6ICdQVVQnLCB1cmw6IGRiVXJsfSwgZnVuY3Rpb24gKGVycikge1xuICAgICAgLy8gSWYgd2UgZ2V0IGFuIFwiVW5hdXRob3JpemVkXCIgZXJyb3JcbiAgICAgIGlmIChlcnIgJiYgZXJyLnN0YXR1cyA9PT0gNDAxKSB7XG4gICAgICAgIC8vIFRlc3QgaWYgdGhlIGRhdGFiYXNlIGFscmVhZHkgZXhpc3RzXG4gICAgICAgIGFqYXgoe2hlYWRlcnM6IGhvc3QuaGVhZGVycywgbWV0aG9kOiAnSEVBRCcsIHVybDogZGJVcmx9LFxuICAgICAgICAgICAgIGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgICAgICAvLyBJZiB0aGVyZSBpcyBzdGlsbCBhbiBlcnJvclxuICAgICAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgICAgIC8vIEdpdmUgdGhlIGVycm9yIHRvIHRoZSBjYWxsYmFjayB0byBkZWFsIHdpdGhcbiAgICAgICAgICAgIGNhbGxiYWNrKGVycik7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIENvbnRpbnVlIGFzIGlmIHRoZXJlIGhhZCBiZWVuIG5vIGVycm9yc1xuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgYXBpKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICAvLyBJZiB0aGVyZSB3ZXJlIG5vIGVycnJvcyBvciBpZiB0aGUgb25seSBlcnJvciBpcyBcIlByZWNvbmRpdGlvbiBGYWlsZWRcIlxuICAgICAgICAvLyAobm90ZTogXCJQcmVjb25kaXRpb24gRmFpbGVkXCIgb2NjdXJzIHdoZW4gd2UgdHJ5IHRvIGNyZWF0ZSBhIGRhdGFiYXNlXG4gICAgICAgIC8vIHRoYXQgYWxyZWFkeSBleGlzdHMpXG4gICAgICB9IGVsc2UgaWYgKCFlcnIgfHwgZXJyLnN0YXR1cyA9PT0gNDEyKSB7XG4gICAgICAgIC8vIENvbnRpbnVlIGFzIGlmIHRoZXJlIGhhZCBiZWVuIG5vIGVycm9yc1xuICAgICAgICBjYWxsYmFjayhudWxsLCBhcGkpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY2FsbGJhY2soZXJyKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfTtcblxuICBpZiAoIW9wdHMuc2tpcFNldHVwKSB7XG4gICAgYWpheCh7aGVhZGVyczogaG9zdC5oZWFkZXJzLCBtZXRob2Q6ICdHRVQnLCB1cmw6IGRiVXJsfSwgZnVuY3Rpb24gKGVycikge1xuICAgICAgLy9jaGVjayBpZiB0aGUgZGIgZXhpc3RzXG4gICAgICBpZiAoZXJyKSB7XG4gICAgICAgIGlmIChlcnIuc3RhdHVzID09PSA0MDQpIHtcbiAgICAgICAgICB1dGlscy5leHBsYWluNDA0KFxuICAgICAgICAgICAgJ1BvdWNoREIgaXMganVzdCBkZXRlY3RpbmcgaWYgdGhlIHJlbW90ZSBEQiBleGlzdHMuJyk7XG4gICAgICAgICAgLy9pZiBpdCBkb2Vzbid0LCBjcmVhdGUgaXRcbiAgICAgICAgICBjcmVhdGVEQigpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNhbGxiYWNrKGVycik7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vZ28gZG8gc3R1ZmYgd2l0aCB0aGUgZGJcbiAgICAgICAgY2FsbGJhY2sobnVsbCwgYXBpKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIGFwaS50eXBlID0gZnVuY3Rpb24gKCkge1xuICAgIHJldHVybiAnaHR0cCc7XG4gIH07XG5cbiAgYXBpLmlkID0gdXRpbHMuYWRhcHRlckZ1bignaWQnLCBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICBhamF4KHtcbiAgICAgIGhlYWRlcnM6IGhvc3QuaGVhZGVycyxcbiAgICAgIG1ldGhvZDogJ0dFVCcsXG4gICAgICB1cmw6IGdlblVybChob3N0LCAnJylcbiAgICB9LCBmdW5jdGlvbiAoZXJyLCByZXN1bHQpIHtcbiAgICAgIHZhciB1dWlkID0gKHJlc3VsdCAmJiByZXN1bHQudXVpZCkgP1xuICAgICAgICByZXN1bHQudXVpZCArIGhvc3QuZGIgOiBnZW5EQlVybChob3N0LCAnJyk7XG4gICAgICBjYWxsYmFjayhudWxsLCB1dWlkKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgYXBpLnJlcXVlc3QgPSB1dGlscy5hZGFwdGVyRnVuKCdyZXF1ZXN0JywgZnVuY3Rpb24gKG9wdGlvbnMsIGNhbGxiYWNrKSB7XG4gICAgb3B0aW9ucy5oZWFkZXJzID0gaG9zdC5oZWFkZXJzO1xuICAgIG9wdGlvbnMudXJsID0gZ2VuREJVcmwoaG9zdCwgb3B0aW9ucy51cmwpO1xuICAgIGFqYXgob3B0aW9ucywgY2FsbGJhY2spO1xuICB9KTtcblxuICAvLyBTZW5kcyBhIFBPU1QgcmVxdWVzdCB0byB0aGUgaG9zdCBjYWxsaW5nIHRoZSBjb3VjaGRiIF9jb21wYWN0IGZ1bmN0aW9uXG4gIC8vICAgIHZlcnNpb246IFRoZSB2ZXJzaW9uIG9mIENvdWNoREIgaXQgaXMgcnVubmluZ1xuICBhcGkuY29tcGFjdCA9IHV0aWxzLmFkYXB0ZXJGdW4oJ2NvbXBhY3QnLCBmdW5jdGlvbiAob3B0cywgY2FsbGJhY2spIHtcbiAgICBpZiAodHlwZW9mIG9wdHMgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIGNhbGxiYWNrID0gb3B0cztcbiAgICAgIG9wdHMgPSB7fTtcbiAgICB9XG4gICAgb3B0cyA9IHV0aWxzLmNsb25lKG9wdHMpO1xuICAgIGFqYXgoe1xuICAgICAgaGVhZGVyczogaG9zdC5oZWFkZXJzLFxuICAgICAgdXJsOiBnZW5EQlVybChob3N0LCAnX2NvbXBhY3QnKSxcbiAgICAgIG1ldGhvZDogJ1BPU1QnXG4gICAgfSwgZnVuY3Rpb24gKCkge1xuICAgICAgZnVuY3Rpb24gcGluZygpIHtcbiAgICAgICAgYXBpLmluZm8oZnVuY3Rpb24gKGVyciwgcmVzKSB7XG4gICAgICAgICAgaWYgKCFyZXMuY29tcGFjdF9ydW5uaW5nKSB7XG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCB7b2s6IHRydWV9KTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgc2V0VGltZW91dChwaW5nLCBvcHRzLmludGVydmFsIHx8IDIwMCk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICAgIC8vIFBpbmcgdGhlIGh0dHAgaWYgaXQncyBmaW5pc2hlZCBjb21wYWN0aW9uXG4gICAgICBpZiAodHlwZW9mIGNhbGxiYWNrID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgcGluZygpO1xuICAgICAgfVxuICAgIH0pO1xuICB9KTtcblxuICAvLyBDYWxscyBHRVQgb24gdGhlIGhvc3QsIHdoaWNoIGdldHMgYmFjayBhIEpTT04gc3RyaW5nIGNvbnRhaW5pbmdcbiAgLy8gICAgY291Y2hkYjogQSB3ZWxjb21lIHN0cmluZ1xuICAvLyAgICB2ZXJzaW9uOiBUaGUgdmVyc2lvbiBvZiBDb3VjaERCIGl0IGlzIHJ1bm5pbmdcbiAgYXBpLl9pbmZvID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgYWpheCh7XG4gICAgICBoZWFkZXJzOiBob3N0LmhlYWRlcnMsXG4gICAgICBtZXRob2Q6ICdHRVQnLFxuICAgICAgdXJsOiBnZW5EQlVybChob3N0LCAnJylcbiAgICB9LCBmdW5jdGlvbiAoZXJyLCByZXMpIHtcbiAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgY2FsbGJhY2soZXJyKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJlcy5ob3N0ID0gZ2VuREJVcmwoaG9zdCwgJycpO1xuICAgICAgICBjYWxsYmFjayhudWxsLCByZXMpO1xuICAgICAgfVxuICAgIH0pO1xuICB9O1xuXG4gIC8vIEdldCB0aGUgZG9jdW1lbnQgd2l0aCB0aGUgZ2l2ZW4gaWQgZnJvbSB0aGUgZGF0YWJhc2UgZ2l2ZW4gYnkgaG9zdC5cbiAgLy8gVGhlIGlkIGNvdWxkIGJlIHNvbGVseSB0aGUgX2lkIGluIHRoZSBkYXRhYmFzZSwgb3IgaXQgbWF5IGJlIGFcbiAgLy8gX2Rlc2lnbi9JRCBvciBfbG9jYWwvSUQgcGF0aFxuICBhcGkuZ2V0ID0gdXRpbHMuYWRhcHRlckZ1bignZ2V0JywgZnVuY3Rpb24gKGlkLCBvcHRzLCBjYWxsYmFjaykge1xuICAgIC8vIElmIG5vIG9wdGlvbnMgd2VyZSBnaXZlbiwgc2V0IHRoZSBjYWxsYmFjayB0byB0aGUgc2Vjb25kIHBhcmFtZXRlclxuICAgIGlmICh0eXBlb2Ygb3B0cyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgY2FsbGJhY2sgPSBvcHRzO1xuICAgICAgb3B0cyA9IHt9O1xuICAgIH1cbiAgICBvcHRzID0gdXRpbHMuY2xvbmUob3B0cyk7XG4gICAgaWYgKG9wdHMuYXV0b19lbmNvZGUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgb3B0cy5hdXRvX2VuY29kZSA9IHRydWU7XG4gICAgfVxuXG4gICAgLy8gTGlzdCBvZiBwYXJhbWV0ZXJzIHRvIGFkZCB0byB0aGUgR0VUIHJlcXVlc3RcbiAgICB2YXIgcGFyYW1zID0gW107XG5cbiAgICAvLyBJZiBpdCBleGlzdHMsIGFkZCB0aGUgb3B0cy5yZXZzIHZhbHVlIHRvIHRoZSBsaXN0IG9mIHBhcmFtZXRlcnMuXG4gICAgLy8gSWYgcmV2cz10cnVlIHRoZW4gdGhlIHJlc3VsdGluZyBKU09OIHdpbGwgaW5jbHVkZSBhIGZpZWxkXG4gICAgLy8gX3JldmlzaW9ucyBjb250YWluaW5nIGFuIGFycmF5IG9mIHRoZSByZXZpc2lvbiBJRHMuXG4gICAgaWYgKG9wdHMucmV2cykge1xuICAgICAgcGFyYW1zLnB1c2goJ3JldnM9dHJ1ZScpO1xuICAgIH1cblxuICAgIC8vIElmIGl0IGV4aXN0cywgYWRkIHRoZSBvcHRzLnJldnNfaW5mbyB2YWx1ZSB0byB0aGUgbGlzdCBvZiBwYXJhbWV0ZXJzLlxuICAgIC8vIElmIHJldnNfaW5mbz10cnVlIHRoZW4gdGhlIHJlc3VsdGluZyBKU09OIHdpbGwgaW5jbHVkZSB0aGUgZmllbGRcbiAgICAvLyBfcmV2c19pbmZvIGNvbnRhaW5pbmcgYW4gYXJyYXkgb2Ygb2JqZWN0cyBpbiB3aGljaCBlYWNoIG9iamVjdFxuICAgIC8vIHJlcHJlc2VudGluZyBhbiBhdmFpbGFibGUgcmV2aXNpb24uXG4gICAgaWYgKG9wdHMucmV2c19pbmZvKSB7XG4gICAgICBwYXJhbXMucHVzaCgncmV2c19pbmZvPXRydWUnKTtcbiAgICB9XG5cbiAgICBpZiAob3B0cy5sb2NhbF9zZXEpIHtcbiAgICAgIHBhcmFtcy5wdXNoKCdsb2NhbF9zZXE9dHJ1ZScpO1xuICAgIH1cbiAgICAvLyBJZiBpdCBleGlzdHMsIGFkZCB0aGUgb3B0cy5vcGVuX3JldnMgdmFsdWUgdG8gdGhlIGxpc3Qgb2YgcGFyYW1ldGVycy5cbiAgICAvLyBJZiBvcGVuX3JldnM9YWxsIHRoZW4gdGhlIHJlc3VsdGluZyBKU09OIHdpbGwgaW5jbHVkZSBhbGwgdGhlIGxlYWZcbiAgICAvLyByZXZpc2lvbnMuIElmIG9wZW5fcmV2cz1bXCJyZXYxXCIsIFwicmV2MlwiLC4uLl0gdGhlbiB0aGUgcmVzdWx0aW5nIEpTT05cbiAgICAvLyB3aWxsIGNvbnRhaW4gYW4gYXJyYXkgb2Ygb2JqZWN0cyBjb250YWluaW5nIGRhdGEgb2YgYWxsIHJldmlzaW9uc1xuICAgIGlmIChvcHRzLm9wZW5fcmV2cykge1xuICAgICAgaWYgKG9wdHMub3Blbl9yZXZzICE9PSBcImFsbFwiKSB7XG4gICAgICAgIG9wdHMub3Blbl9yZXZzID0gSlNPTi5zdHJpbmdpZnkob3B0cy5vcGVuX3JldnMpO1xuICAgICAgfVxuICAgICAgcGFyYW1zLnB1c2goJ29wZW5fcmV2cz0nICsgb3B0cy5vcGVuX3JldnMpO1xuICAgIH1cblxuICAgIC8vIElmIGl0IGV4aXN0cywgYWRkIHRoZSBvcHRzLmF0dGFjaG1lbnRzIHZhbHVlIHRvIHRoZSBsaXN0IG9mIHBhcmFtZXRlcnMuXG4gICAgLy8gSWYgYXR0YWNobWVudHM9dHJ1ZSB0aGUgcmVzdWx0aW5nIEpTT04gd2lsbCBpbmNsdWRlIHRoZSBiYXNlNjQtZW5jb2RlZFxuICAgIC8vIGNvbnRlbnRzIGluIHRoZSBcImRhdGFcIiBwcm9wZXJ0eSBvZiBlYWNoIGF0dGFjaG1lbnQuXG4gICAgaWYgKG9wdHMuYXR0YWNobWVudHMpIHtcbiAgICAgIHBhcmFtcy5wdXNoKCdhdHRhY2htZW50cz10cnVlJyk7XG4gICAgfVxuXG4gICAgLy8gSWYgaXQgZXhpc3RzLCBhZGQgdGhlIG9wdHMucmV2IHZhbHVlIHRvIHRoZSBsaXN0IG9mIHBhcmFtZXRlcnMuXG4gICAgLy8gSWYgcmV2IGlzIGdpdmVuIGEgcmV2aXNpb24gbnVtYmVyIHRoZW4gZ2V0IHRoZSBzcGVjaWZpZWQgcmV2aXNpb24uXG4gICAgaWYgKG9wdHMucmV2KSB7XG4gICAgICBwYXJhbXMucHVzaCgncmV2PScgKyBvcHRzLnJldik7XG4gICAgfVxuXG4gICAgLy8gSWYgaXQgZXhpc3RzLCBhZGQgdGhlIG9wdHMuY29uZmxpY3RzIHZhbHVlIHRvIHRoZSBsaXN0IG9mIHBhcmFtZXRlcnMuXG4gICAgLy8gSWYgY29uZmxpY3RzPXRydWUgdGhlbiB0aGUgcmVzdWx0aW5nIEpTT04gd2lsbCBpbmNsdWRlIHRoZSBmaWVsZFxuICAgIC8vIF9jb25mbGljdHMgY29udGFpbmluZyBhbGwgdGhlIGNvbmZsaWN0aW5nIHJldmlzaW9ucy5cbiAgICBpZiAob3B0cy5jb25mbGljdHMpIHtcbiAgICAgIHBhcmFtcy5wdXNoKCdjb25mbGljdHM9JyArIG9wdHMuY29uZmxpY3RzKTtcbiAgICB9XG5cbiAgICAvLyBGb3JtYXQgdGhlIGxpc3Qgb2YgcGFyYW1ldGVycyBpbnRvIGEgdmFsaWQgVVJJIHF1ZXJ5IHN0cmluZ1xuICAgIHBhcmFtcyA9IHBhcmFtcy5qb2luKCcmJyk7XG4gICAgcGFyYW1zID0gcGFyYW1zID09PSAnJyA/ICcnIDogJz8nICsgcGFyYW1zO1xuXG4gICAgaWYgKG9wdHMuYXV0b19lbmNvZGUpIHtcbiAgICAgIGlkID0gZW5jb2RlRG9jSWQoaWQpO1xuICAgIH1cblxuICAgIC8vIFNldCB0aGUgb3B0aW9ucyBmb3IgdGhlIGFqYXggY2FsbFxuICAgIHZhciBvcHRpb25zID0ge1xuICAgICAgaGVhZGVyczogaG9zdC5oZWFkZXJzLFxuICAgICAgbWV0aG9kOiAnR0VUJyxcbiAgICAgIHVybDogZ2VuREJVcmwoaG9zdCwgaWQgKyBwYXJhbXMpXG4gICAgfTtcbiAgICB2YXIgZ2V0UmVxdWVzdEFqYXhPcHRzID0gb3B0cy5hamF4IHx8IHt9O1xuICAgIHV0aWxzLmV4dGVuZCh0cnVlLCBvcHRpb25zLCBnZXRSZXF1ZXN0QWpheE9wdHMpO1xuXG4gICAgLy8gSWYgdGhlIGdpdmVuIGlkIGNvbnRhaW5zIGF0IGxlYXN0IG9uZSAnLycgYW5kIHRoZSBwYXJ0IGJlZm9yZSB0aGUgJy8nXG4gICAgLy8gaXMgTk9UIFwiX2Rlc2lnblwiIGFuZCBpcyBOT1QgXCJfbG9jYWxcIlxuICAgIC8vIE9SXG4gICAgLy8gSWYgdGhlIGdpdmVuIGlkIGNvbnRhaW5zIGF0IGxlYXN0IHR3byAnLycgYW5kIHRoZSBwYXJ0IGJlZm9yZSB0aGUgZmlyc3RcbiAgICAvLyAnLycgaXMgXCJfZGVzaWduXCIuXG4gICAgLy8gVE9ETyBUaGlzIHNlY29uZCBjb25kaXRpb24gc2VlbXMgc3RyYW5nZSBzaW5jZSBpZiBwYXJ0c1swXSA9PT0gJ19kZXNpZ24nXG4gICAgLy8gdGhlbiB3ZSBhbHJlYWR5IGtub3cgdGhhdCBwYXJ0c1swXSAhPT0gJ19sb2NhbCcuXG4gICAgdmFyIHBhcnRzID0gaWQuc3BsaXQoJy8nKTtcbiAgICBpZiAoKHBhcnRzLmxlbmd0aCA+IDEgJiYgcGFydHNbMF0gIT09ICdfZGVzaWduJyAmJiBwYXJ0c1swXSAhPT0gJ19sb2NhbCcpIHx8XG4gICAgICAgIChwYXJ0cy5sZW5ndGggPiAyICYmIHBhcnRzWzBdID09PSAnX2Rlc2lnbicgJiYgcGFydHNbMF0gIT09ICdfbG9jYWwnKSkge1xuICAgICAgLy8gQmluYXJ5IGlzIGV4cGVjdGVkIGJhY2sgZnJvbSB0aGUgc2VydmVyXG4gICAgICBvcHRpb25zLmJpbmFyeSA9IHRydWU7XG4gICAgfVxuXG4gICAgLy8gR2V0IHRoZSBkb2N1bWVudFxuICAgIGFqYXgob3B0aW9ucywgZnVuY3Rpb24gKGVyciwgZG9jLCB4aHIpIHtcbiAgICAgIC8vIElmIHRoZSBkb2N1bWVudCBkb2VzIG5vdCBleGlzdCwgc2VuZCBhbiBlcnJvciB0byB0aGUgY2FsbGJhY2tcbiAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgcmV0dXJuIGNhbGxiYWNrKGVycik7XG4gICAgICB9XG5cbiAgICAgIC8vIFNlbmQgdGhlIGRvY3VtZW50IHRvIHRoZSBjYWxsYmFja1xuICAgICAgY2FsbGJhY2sobnVsbCwgZG9jLCB4aHIpO1xuICAgIH0pO1xuICB9KTtcblxuICAvLyBEZWxldGUgdGhlIGRvY3VtZW50IGdpdmVuIGJ5IGRvYyBmcm9tIHRoZSBkYXRhYmFzZSBnaXZlbiBieSBob3N0LlxuICBhcGkucmVtb3ZlID0gdXRpbHMuYWRhcHRlckZ1bigncmVtb3ZlJyxcbiAgICAgIGZ1bmN0aW9uIChkb2NPcklkLCBvcHRzT3JSZXYsIG9wdHMsIGNhbGxiYWNrKSB7XG4gICAgdmFyIGRvYztcbiAgICBpZiAodHlwZW9mIG9wdHNPclJldiA9PT0gJ3N0cmluZycpIHtcbiAgICAgIC8vIGlkLCByZXYsIG9wdHMsIGNhbGxiYWNrIHN0eWxlXG4gICAgICBkb2MgPSB7XG4gICAgICAgIF9pZDogZG9jT3JJZCxcbiAgICAgICAgX3Jldjogb3B0c09yUmV2XG4gICAgICB9O1xuICAgICAgaWYgKHR5cGVvZiBvcHRzID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIGNhbGxiYWNrID0gb3B0cztcbiAgICAgICAgb3B0cyA9IHt9O1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBkb2MsIG9wdHMsIGNhbGxiYWNrIHN0eWxlXG4gICAgICBkb2MgPSBkb2NPcklkO1xuICAgICAgaWYgKHR5cGVvZiBvcHRzT3JSZXYgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgY2FsbGJhY2sgPSBvcHRzT3JSZXY7XG4gICAgICAgIG9wdHMgPSB7fTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNhbGxiYWNrID0gb3B0cztcbiAgICAgICAgb3B0cyA9IG9wdHNPclJldjtcbiAgICAgIH1cbiAgICB9XG5cbiAgICB2YXIgcmV2ID0gKGRvYy5fcmV2IHx8IG9wdHMucmV2KTtcblxuICAgIC8vIERlbGV0ZSB0aGUgZG9jdW1lbnRcbiAgICBhamF4KHtcbiAgICAgIGhlYWRlcnM6IGhvc3QuaGVhZGVycyxcbiAgICAgIG1ldGhvZDogJ0RFTEVURScsXG4gICAgICB1cmw6IGdlbkRCVXJsKGhvc3QsIGVuY29kZURvY0lkKGRvYy5faWQpKSArICc/cmV2PScgKyByZXZcbiAgICB9LCBjYWxsYmFjayk7XG4gIH0pO1xuXG4gIGZ1bmN0aW9uIGVuY29kZUF0dGFjaG1lbnRJZChhdHRhY2htZW50SWQpIHtcbiAgICByZXR1cm4gYXR0YWNobWVudElkLnNwbGl0KFwiL1wiKS5tYXAoZW5jb2RlVVJJQ29tcG9uZW50KS5qb2luKFwiL1wiKTtcbiAgfVxuXG4gIC8vIEdldCB0aGUgYXR0YWNobWVudFxuICBhcGkuZ2V0QXR0YWNobWVudCA9XG4gICAgdXRpbHMuYWRhcHRlckZ1bignZ2V0QXR0YWNobWVudCcsIGZ1bmN0aW9uIChkb2NJZCwgYXR0YWNobWVudElkLCBvcHRzLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2FsbGJhY2spIHtcbiAgICBpZiAodHlwZW9mIG9wdHMgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIGNhbGxiYWNrID0gb3B0cztcbiAgICAgIG9wdHMgPSB7fTtcbiAgICB9XG4gICAgb3B0cyA9IHV0aWxzLmNsb25lKG9wdHMpO1xuICAgIGlmIChvcHRzLmF1dG9fZW5jb2RlID09PSB1bmRlZmluZWQpIHtcbiAgICAgIG9wdHMuYXV0b19lbmNvZGUgPSB0cnVlO1xuICAgIH1cbiAgICBpZiAob3B0cy5hdXRvX2VuY29kZSkge1xuICAgICAgZG9jSWQgPSBlbmNvZGVEb2NJZChkb2NJZCk7XG4gICAgfVxuICAgIG9wdHMuYXV0b19lbmNvZGUgPSBmYWxzZTtcbiAgICBhcGkuZ2V0KGRvY0lkICsgJy8nICsgZW5jb2RlQXR0YWNobWVudElkKGF0dGFjaG1lbnRJZCksIG9wdHMsIGNhbGxiYWNrKTtcbiAgfSk7XG5cbiAgLy8gUmVtb3ZlIHRoZSBhdHRhY2htZW50IGdpdmVuIGJ5IHRoZSBpZCBhbmQgcmV2XG4gIGFwaS5yZW1vdmVBdHRhY2htZW50ID1cbiAgICB1dGlscy5hZGFwdGVyRnVuKCdyZW1vdmVBdHRhY2htZW50JywgZnVuY3Rpb24gKGRvY0lkLCBhdHRhY2htZW50SWQsIHJldixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNhbGxiYWNrKSB7XG5cbiAgICB2YXIgdXJsID0gZ2VuREJVcmwoaG9zdCwgZW5jb2RlRG9jSWQoZG9jSWQpICsgJy8nICtcbiAgICAgIGVuY29kZUF0dGFjaG1lbnRJZChhdHRhY2htZW50SWQpKSArICc/cmV2PScgKyByZXY7XG5cbiAgICBhamF4KHtcbiAgICAgIGhlYWRlcnM6IGhvc3QuaGVhZGVycyxcbiAgICAgIG1ldGhvZDogJ0RFTEVURScsXG4gICAgICB1cmw6IHVybFxuICAgIH0sIGNhbGxiYWNrKTtcbiAgfSk7XG5cbiAgLy8gQWRkIHRoZSBhdHRhY2htZW50IGdpdmVuIGJ5IGJsb2IgYW5kIGl0cyBjb250ZW50VHlwZSBwcm9wZXJ0eVxuICAvLyB0byB0aGUgZG9jdW1lbnQgd2l0aCB0aGUgZ2l2ZW4gaWQsIHRoZSByZXZpc2lvbiBnaXZlbiBieSByZXYsIGFuZFxuICAvLyBhZGQgaXQgdG8gdGhlIGRhdGFiYXNlIGdpdmVuIGJ5IGhvc3QuXG4gIGFwaS5wdXRBdHRhY2htZW50ID1cbiAgICB1dGlscy5hZGFwdGVyRnVuKCdwdXRBdHRhY2htZW50JywgZnVuY3Rpb24gKGRvY0lkLCBhdHRhY2htZW50SWQsIHJldiwgYmxvYixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGUsIGNhbGxiYWNrKSB7XG4gICAgaWYgKHR5cGVvZiB0eXBlID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICBjYWxsYmFjayA9IHR5cGU7XG4gICAgICB0eXBlID0gYmxvYjtcbiAgICAgIGJsb2IgPSByZXY7XG4gICAgICByZXYgPSBudWxsO1xuICAgIH1cbiAgICBpZiAodHlwZW9mIHR5cGUgPT09ICd1bmRlZmluZWQnKSB7XG4gICAgICB0eXBlID0gYmxvYjtcbiAgICAgIGJsb2IgPSByZXY7XG4gICAgICByZXYgPSBudWxsO1xuICAgIH1cbiAgICB2YXIgaWQgPSBlbmNvZGVEb2NJZChkb2NJZCkgKyAnLycgKyBlbmNvZGVBdHRhY2htZW50SWQoYXR0YWNobWVudElkKTtcbiAgICB2YXIgdXJsID0gZ2VuREJVcmwoaG9zdCwgaWQpO1xuICAgIGlmIChyZXYpIHtcbiAgICAgIHVybCArPSAnP3Jldj0nICsgcmV2O1xuICAgIH1cblxuICAgIGlmICh0eXBlb2YgYmxvYiA9PT0gJ3N0cmluZycpIHtcbiAgICAgIHZhciBiaW5hcnk7XG4gICAgICB0cnkge1xuICAgICAgICBiaW5hcnkgPSB1dGlscy5hdG9iKGJsb2IpO1xuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIC8vIGl0J3Mgbm90IGJhc2U2NC1lbmNvZGVkLCBzbyB0aHJvdyBlcnJvclxuICAgICAgICByZXR1cm4gY2FsbGJhY2soZXJyb3JzLmVycm9yKGVycm9ycy5CQURfQVJHLFxuICAgICAgICAgICAgICAgICAgICAgICAgJ0F0dGFjaG1lbnRzIG5lZWQgdG8gYmUgYmFzZTY0IGVuY29kZWQnKSk7XG4gICAgICB9XG4gICAgICBpZiAoaXNCcm93c2VyKSB7XG4gICAgICAgIGJsb2IgPSB1dGlscy5jcmVhdGVCbG9iKFt1dGlscy5maXhCaW5hcnkoYmluYXJ5KV0sIHt0eXBlOiB0eXBlfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBibG9iID0gYmluYXJ5ID8gbmV3IGJ1ZmZlcihiaW5hcnksICdiaW5hcnknKSA6ICcnO1xuICAgICAgfVxuICAgIH1cblxuICAgIHZhciBvcHRzID0ge1xuICAgICAgaGVhZGVyczogdXRpbHMuY2xvbmUoaG9zdC5oZWFkZXJzKSxcbiAgICAgIG1ldGhvZDogJ1BVVCcsXG4gICAgICB1cmw6IHVybCxcbiAgICAgIHByb2Nlc3NEYXRhOiBmYWxzZSxcbiAgICAgIGJvZHk6IGJsb2IsXG4gICAgICB0aW1lb3V0OiA2MDAwMFxuICAgIH07XG4gICAgb3B0cy5oZWFkZXJzWydDb250ZW50LVR5cGUnXSA9IHR5cGU7XG4gICAgLy8gQWRkIHRoZSBhdHRhY2htZW50XG4gICAgYWpheChvcHRzLCBjYWxsYmFjayk7XG4gIH0pO1xuXG4gIC8vIEFkZCB0aGUgZG9jdW1lbnQgZ2l2ZW4gYnkgZG9jIChpbiBKU09OIHN0cmluZyBmb3JtYXQpIHRvIHRoZSBkYXRhYmFzZVxuICAvLyBnaXZlbiBieSBob3N0LiBUaGlzIGZhaWxzIGlmIHRoZSBkb2MgaGFzIG5vIF9pZCBmaWVsZC5cbiAgYXBpLnB1dCA9IHV0aWxzLmFkYXB0ZXJGdW4oJ3B1dCcsIHV0aWxzLmdldEFyZ3VtZW50cyhmdW5jdGlvbiAoYXJncykge1xuICAgIHZhciB0ZW1wLCB0ZW1wdHlwZSwgb3B0cztcbiAgICB2YXIgZG9jID0gYXJncy5zaGlmdCgpO1xuICAgIHZhciBpZCA9ICdfaWQnIGluIGRvYztcbiAgICB2YXIgY2FsbGJhY2sgPSBhcmdzLnBvcCgpO1xuICAgIGlmICh0eXBlb2YgZG9jICE9PSAnb2JqZWN0JyB8fCBBcnJheS5pc0FycmF5KGRvYykpIHtcbiAgICAgIHJldHVybiBjYWxsYmFjayhlcnJvcnMuZXJyb3IoZXJyb3JzLk5PVF9BTl9PQkpFQ1QpKTtcbiAgICB9XG5cbiAgICBkb2MgPSB1dGlscy5jbG9uZShkb2MpO1xuXG4gICAgcHJlcHJvY2Vzc0F0dGFjaG1lbnRzKGRvYykudGhlbihmdW5jdGlvbiAoKSB7XG4gICAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgICB0ZW1wID0gYXJncy5zaGlmdCgpO1xuICAgICAgICB0ZW1wdHlwZSA9IHR5cGVvZiB0ZW1wO1xuICAgICAgICBpZiAodGVtcHR5cGUgPT09IFwic3RyaW5nXCIgJiYgIWlkKSB7XG4gICAgICAgICAgZG9jLl9pZCA9IHRlbXA7XG4gICAgICAgICAgaWQgPSB0cnVlO1xuICAgICAgICB9IGVsc2UgaWYgKHRlbXB0eXBlID09PSBcInN0cmluZ1wiICYmIGlkICYmICEoJ19yZXYnIGluIGRvYykpIHtcbiAgICAgICAgICBkb2MuX3JldiA9IHRlbXA7XG4gICAgICAgIH0gZWxzZSBpZiAodGVtcHR5cGUgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgICAgICBvcHRzID0gdXRpbHMuY2xvbmUodGVtcCk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFhcmdzLmxlbmd0aCkge1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBvcHRzID0gb3B0cyB8fCB7fTtcbiAgICAgIHZhciBlcnJvciA9IHV0aWxzLmludmFsaWRJZEVycm9yKGRvYy5faWQpO1xuICAgICAgaWYgKGVycm9yKSB7XG4gICAgICAgIHRocm93IGVycm9yO1xuICAgICAgfVxuXG4gICAgICAvLyBMaXN0IG9mIHBhcmFtZXRlciB0byBhZGQgdG8gdGhlIFBVVCByZXF1ZXN0XG4gICAgICB2YXIgcGFyYW1zID0gW107XG5cbiAgICAgIC8vIElmIGl0IGV4aXN0cywgYWRkIHRoZSBvcHRzLm5ld19lZGl0cyB2YWx1ZSB0byB0aGUgbGlzdCBvZiBwYXJhbWV0ZXJzLlxuICAgICAgLy8gSWYgbmV3X2VkaXRzID0gZmFsc2UgdGhlbiB0aGUgZGF0YWJhc2Ugd2lsbCBOT1QgYXNzaWduIHRoaXMgZG9jdW1lbnQgYVxuICAgICAgLy8gbmV3IHJldmlzaW9uIG51bWJlclxuICAgICAgaWYgKG9wdHMgJiYgdHlwZW9mIG9wdHMubmV3X2VkaXRzICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgICBwYXJhbXMucHVzaCgnbmV3X2VkaXRzPScgKyBvcHRzLm5ld19lZGl0cyk7XG4gICAgICB9XG5cbiAgICAgIC8vIEZvcm1hdCB0aGUgbGlzdCBvZiBwYXJhbWV0ZXJzIGludG8gYSB2YWxpZCBVUkkgcXVlcnkgc3RyaW5nXG4gICAgICBwYXJhbXMgPSBwYXJhbXMuam9pbignJicpO1xuICAgICAgaWYgKHBhcmFtcyAhPT0gJycpIHtcbiAgICAgICAgcGFyYW1zID0gJz8nICsgcGFyYW1zO1xuICAgICAgfVxuXG4gICAgICAvLyBBZGQgdGhlIGRvY3VtZW50XG4gICAgICBhamF4KHtcbiAgICAgICAgaGVhZGVyczogaG9zdC5oZWFkZXJzLFxuICAgICAgICBtZXRob2Q6ICdQVVQnLFxuICAgICAgICB1cmw6IGdlbkRCVXJsKGhvc3QsIGVuY29kZURvY0lkKGRvYy5faWQpKSArIHBhcmFtcyxcbiAgICAgICAgYm9keTogZG9jXG4gICAgICB9LCBmdW5jdGlvbiAoZXJyLCByZXMpIHtcbiAgICAgICAgaWYgKGVycikge1xuICAgICAgICAgIHJldHVybiBjYWxsYmFjayhlcnIpO1xuICAgICAgICB9XG4gICAgICAgIHJlcy5vayA9IHRydWU7XG4gICAgICAgIGNhbGxiYWNrKG51bGwsIHJlcyk7XG4gICAgICB9KTtcbiAgICB9KVtcImNhdGNoXCJdKGNhbGxiYWNrKTtcblxuICB9KSk7XG5cbiAgLy8gQWRkIHRoZSBkb2N1bWVudCBnaXZlbiBieSBkb2MgKGluIEpTT04gc3RyaW5nIGZvcm1hdCkgdG8gdGhlIGRhdGFiYXNlXG4gIC8vIGdpdmVuIGJ5IGhvc3QuIFRoaXMgZG9lcyBub3QgYXNzdW1lIHRoYXQgZG9jIGlzIGEgbmV3IGRvY3VtZW50IFxuICAvLyAoaS5lLiBkb2VzIG5vdCBoYXZlIGEgX2lkIG9yIGEgX3JldiBmaWVsZC4pXG4gIGFwaS5wb3N0ID0gdXRpbHMuYWRhcHRlckZ1bigncG9zdCcsIGZ1bmN0aW9uIChkb2MsIG9wdHMsIGNhbGxiYWNrKSB7XG4gICAgLy8gSWYgbm8gb3B0aW9ucyB3ZXJlIGdpdmVuLCBzZXQgdGhlIGNhbGxiYWNrIHRvIGJlIHRoZSBzZWNvbmQgcGFyYW1ldGVyXG4gICAgaWYgKHR5cGVvZiBvcHRzID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICBjYWxsYmFjayA9IG9wdHM7XG4gICAgICBvcHRzID0ge307XG4gICAgfVxuICAgIG9wdHMgPSB1dGlscy5jbG9uZShvcHRzKTtcbiAgICBpZiAodHlwZW9mIGRvYyAhPT0gJ29iamVjdCcpIHtcbiAgICAgIHJldHVybiBjYWxsYmFjayhlcnJvcnMuZXJyb3IoZXJyb3JzLk5PVF9BTl9PQkpFQ1QpKTtcbiAgICB9XG4gICAgaWYgKCEgKFwiX2lkXCIgaW4gZG9jKSkge1xuICAgICAgZG9jLl9pZCA9IHV0aWxzLnV1aWQoKTtcbiAgICB9XG4gICAgYXBpLnB1dChkb2MsIG9wdHMsIGZ1bmN0aW9uIChlcnIsIHJlcykge1xuICAgICAgaWYgKGVycikge1xuICAgICAgICByZXR1cm4gY2FsbGJhY2soZXJyKTtcbiAgICAgIH1cbiAgICAgIHJlcy5vayA9IHRydWU7XG4gICAgICBjYWxsYmFjayhudWxsLCByZXMpO1xuICAgIH0pO1xuICB9KTtcblxuICAvLyBVcGRhdGUvY3JlYXRlIG11bHRpcGxlIGRvY3VtZW50cyBnaXZlbiBieSByZXEgaW4gdGhlIGRhdGFiYXNlXG4gIC8vIGdpdmVuIGJ5IGhvc3QuXG4gIGFwaS5fYnVsa0RvY3MgPSBmdW5jdGlvbiAocmVxLCBvcHRzLCBjYWxsYmFjaykge1xuICAgIC8vIElmIG9wdHMubmV3X2VkaXRzIGV4aXN0cyBhZGQgaXQgdG8gdGhlIGRvY3VtZW50IGRhdGEgdG8gYmVcbiAgICAvLyBzZW5kIHRvIHRoZSBkYXRhYmFzZS5cbiAgICAvLyBJZiBuZXdfZWRpdHM9ZmFsc2UgdGhlbiBpdCBwcmV2ZW50cyB0aGUgZGF0YWJhc2UgZnJvbSBjcmVhdGluZ1xuICAgIC8vIG5ldyByZXZpc2lvbiBudW1iZXJzIGZvciB0aGUgZG9jdW1lbnRzLiBJbnN0ZWFkIGl0IGp1c3QgdXNlc1xuICAgIC8vIHRoZSBvbGQgb25lcy4gVGhpcyBpcyB1c2VkIGluIGRhdGFiYXNlIHJlcGxpY2F0aW9uLlxuICAgIGlmICh0eXBlb2Ygb3B0cy5uZXdfZWRpdHMgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICByZXEubmV3X2VkaXRzID0gb3B0cy5uZXdfZWRpdHM7XG4gICAgfVxuXG4gICAgdXRpbHMuUHJvbWlzZS5hbGwocmVxLmRvY3MubWFwKHByZXByb2Nlc3NBdHRhY2htZW50cykpLnRoZW4oZnVuY3Rpb24gKCkge1xuICAgICAgLy8gVXBkYXRlL2NyZWF0ZSB0aGUgZG9jdW1lbnRzXG4gICAgICBhamF4KHtcbiAgICAgICAgaGVhZGVyczogaG9zdC5oZWFkZXJzLFxuICAgICAgICBtZXRob2Q6ICdQT1NUJyxcbiAgICAgICAgdXJsOiBnZW5EQlVybChob3N0LCAnX2J1bGtfZG9jcycpLFxuICAgICAgICBib2R5OiByZXFcbiAgICAgIH0sIGZ1bmN0aW9uIChlcnIsIHJlc3VsdHMpIHtcbiAgICAgICAgaWYgKGVycikge1xuICAgICAgICAgIHJldHVybiBjYWxsYmFjayhlcnIpO1xuICAgICAgICB9XG4gICAgICAgIHJlc3VsdHMuZm9yRWFjaChmdW5jdGlvbiAocmVzdWx0KSB7XG4gICAgICAgICAgcmVzdWx0Lm9rID0gdHJ1ZTsgLy8gc21vb3RocyBvdXQgY2xvdWRhbnQgbm90IGFkZGluZyB0aGlzXG4gICAgICAgIH0pO1xuICAgICAgICBjYWxsYmFjayhudWxsLCByZXN1bHRzKTtcbiAgICAgIH0pO1xuICAgIH0pW1wiY2F0Y2hcIl0oY2FsbGJhY2spO1xuICB9O1xuXG4gIC8vIEdldCBhIGxpc3Rpbmcgb2YgdGhlIGRvY3VtZW50cyBpbiB0aGUgZGF0YWJhc2UgZ2l2ZW5cbiAgLy8gYnkgaG9zdCBhbmQgb3JkZXJlZCBieSBpbmNyZWFzaW5nIGlkLlxuICBhcGkuYWxsRG9jcyA9IHV0aWxzLmFkYXB0ZXJGdW4oJ2FsbERvY3MnLCBmdW5jdGlvbiAob3B0cywgY2FsbGJhY2spIHtcbiAgICBpZiAodHlwZW9mIG9wdHMgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIGNhbGxiYWNrID0gb3B0cztcbiAgICAgIG9wdHMgPSB7fTtcbiAgICB9XG4gICAgb3B0cyA9IHV0aWxzLmNsb25lKG9wdHMpO1xuICAgIC8vIExpc3Qgb2YgcGFyYW1ldGVycyB0byBhZGQgdG8gdGhlIEdFVCByZXF1ZXN0XG4gICAgdmFyIHBhcmFtcyA9IFtdO1xuICAgIHZhciBib2R5O1xuICAgIHZhciBtZXRob2QgPSAnR0VUJztcblxuICAgIGlmIChvcHRzLmNvbmZsaWN0cykge1xuICAgICAgcGFyYW1zLnB1c2goJ2NvbmZsaWN0cz10cnVlJyk7XG4gICAgfVxuXG4gICAgLy8gSWYgb3B0cy5kZXNjZW5kaW5nIGlzIHRydXRoeSBhZGQgaXQgdG8gcGFyYW1zXG4gICAgaWYgKG9wdHMuZGVzY2VuZGluZykge1xuICAgICAgcGFyYW1zLnB1c2goJ2Rlc2NlbmRpbmc9dHJ1ZScpO1xuICAgIH1cblxuICAgIC8vIElmIG9wdHMuaW5jbHVkZV9kb2NzIGV4aXN0cywgYWRkIHRoZSBpbmNsdWRlX2RvY3MgdmFsdWUgdG8gdGhlXG4gICAgLy8gbGlzdCBvZiBwYXJhbWV0ZXJzLlxuICAgIC8vIElmIGluY2x1ZGVfZG9jcz10cnVlIHRoZW4gaW5jbHVkZSB0aGUgYXNzb2NpYXRlZCBkb2N1bWVudCB3aXRoIGVhY2hcbiAgICAvLyByZXN1bHQuXG4gICAgaWYgKG9wdHMuaW5jbHVkZV9kb2NzKSB7XG4gICAgICBwYXJhbXMucHVzaCgnaW5jbHVkZV9kb2NzPXRydWUnKTtcbiAgICB9XG5cbiAgICBpZiAob3B0cy5hdHRhY2htZW50cykge1xuICAgICAgLy8gYWRkZWQgaW4gQ291Y2hEQiAxLjYuMFxuICAgICAgcGFyYW1zLnB1c2goJ2F0dGFjaG1lbnRzPXRydWUnKTtcbiAgICB9XG5cbiAgICBpZiAob3B0cy5rZXkpIHtcbiAgICAgIHBhcmFtcy5wdXNoKCdrZXk9JyArIGVuY29kZVVSSUNvbXBvbmVudChKU09OLnN0cmluZ2lmeShvcHRzLmtleSkpKTtcbiAgICB9XG5cbiAgICAvLyBJZiBvcHRzLnN0YXJ0a2V5IGV4aXN0cywgYWRkIHRoZSBzdGFydGtleSB2YWx1ZSB0byB0aGUgbGlzdCBvZlxuICAgIC8vIHBhcmFtZXRlcnMuXG4gICAgLy8gSWYgc3RhcnRrZXkgaXMgZ2l2ZW4gdGhlbiB0aGUgcmV0dXJuZWQgbGlzdCBvZiBkb2N1bWVudHMgd2lsbFxuICAgIC8vIHN0YXJ0IHdpdGggdGhlIGRvY3VtZW50IHdob3NlIGlkIGlzIHN0YXJ0a2V5LlxuICAgIGlmIChvcHRzLnN0YXJ0a2V5KSB7XG4gICAgICBwYXJhbXMucHVzaCgnc3RhcnRrZXk9JyArXG4gICAgICAgIGVuY29kZVVSSUNvbXBvbmVudChKU09OLnN0cmluZ2lmeShvcHRzLnN0YXJ0a2V5KSkpO1xuICAgIH1cblxuICAgIC8vIElmIG9wdHMuZW5ka2V5IGV4aXN0cywgYWRkIHRoZSBlbmRrZXkgdmFsdWUgdG8gdGhlIGxpc3Qgb2YgcGFyYW1ldGVycy5cbiAgICAvLyBJZiBlbmRrZXkgaXMgZ2l2ZW4gdGhlbiB0aGUgcmV0dXJuZWQgbGlzdCBvZiBkb2N1ZW1udHMgd2lsbFxuICAgIC8vIGVuZCB3aXRoIHRoZSBkb2N1bWVudCB3aG9zZSBpZCBpcyBlbmRrZXkuXG4gICAgaWYgKG9wdHMuZW5ka2V5KSB7XG4gICAgICBwYXJhbXMucHVzaCgnZW5ka2V5PScgKyBlbmNvZGVVUklDb21wb25lbnQoSlNPTi5zdHJpbmdpZnkob3B0cy5lbmRrZXkpKSk7XG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBvcHRzLmluY2x1c2l2ZV9lbmQgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICBwYXJhbXMucHVzaCgnaW5jbHVzaXZlX2VuZD0nICsgISFvcHRzLmluY2x1c2l2ZV9lbmQpO1xuICAgIH1cblxuICAgIC8vIElmIG9wdHMubGltaXQgZXhpc3RzLCBhZGQgdGhlIGxpbWl0IHZhbHVlIHRvIHRoZSBwYXJhbWV0ZXIgbGlzdC5cbiAgICBpZiAodHlwZW9mIG9wdHMubGltaXQgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICBwYXJhbXMucHVzaCgnbGltaXQ9JyArIG9wdHMubGltaXQpO1xuICAgIH1cblxuICAgIGlmICh0eXBlb2Ygb3B0cy5za2lwICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgcGFyYW1zLnB1c2goJ3NraXA9JyArIG9wdHMuc2tpcCk7XG4gICAgfVxuXG4gICAgLy8gRm9ybWF0IHRoZSBsaXN0IG9mIHBhcmFtZXRlcnMgaW50byBhIHZhbGlkIFVSSSBxdWVyeSBzdHJpbmdcbiAgICBwYXJhbXMgPSBwYXJhbXMuam9pbignJicpO1xuICAgIGlmIChwYXJhbXMgIT09ICcnKSB7XG4gICAgICBwYXJhbXMgPSAnPycgKyBwYXJhbXM7XG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBvcHRzLmtleXMgIT09ICd1bmRlZmluZWQnKSB7XG5cblxuICAgICAgdmFyIGtleXNBc1N0cmluZyA9XG4gICAgICAgICdrZXlzPScgKyBlbmNvZGVVUklDb21wb25lbnQoSlNPTi5zdHJpbmdpZnkob3B0cy5rZXlzKSk7XG4gICAgICBpZiAoa2V5c0FzU3RyaW5nLmxlbmd0aCArIHBhcmFtcy5sZW5ndGggKyAxIDw9IE1BWF9VUkxfTEVOR1RIKSB7XG4gICAgICAgIC8vIElmIHRoZSBrZXlzIGFyZSBzaG9ydCBlbm91Z2gsIGRvIGEgR0VULiB3ZSBkbyB0aGlzIHRvIHdvcmsgYXJvdW5kXG4gICAgICAgIC8vIFNhZmFyaSBub3QgdW5kZXJzdGFuZGluZyAzMDRzIG9uIFBPU1RzIChzZWUgaXNzdWUgIzEyMzkpXG4gICAgICAgIHBhcmFtcyArPSAocGFyYW1zLmluZGV4T2YoJz8nKSAhPT0gLTEgPyAnJicgOiAnPycpICsga2V5c0FzU3RyaW5nO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gSWYga2V5cyBhcmUgdG9vIGxvbmcsIGlzc3VlIGEgUE9TVCByZXF1ZXN0IHRvIGNpcmN1bXZlbnQgR0VUXG4gICAgICAgIC8vIHF1ZXJ5IHN0cmluZyBsaW1pdHNcbiAgICAgICAgLy8gc2VlIGh0dHA6Ly93aWtpLmFwYWNoZS5vcmcvY291Y2hkYi9IVFRQX3ZpZXdfQVBJI1F1ZXJ5aW5nX09wdGlvbnNcbiAgICAgICAgbWV0aG9kID0gJ1BPU1QnO1xuICAgICAgICBib2R5ID0gSlNPTi5zdHJpbmdpZnkoe2tleXM6IG9wdHMua2V5c30pO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIEdldCB0aGUgZG9jdW1lbnQgbGlzdGluZ1xuICAgIGFqYXgoe1xuICAgICAgaGVhZGVyczogaG9zdC5oZWFkZXJzLFxuICAgICAgbWV0aG9kOiBtZXRob2QsXG4gICAgICB1cmw6IGdlbkRCVXJsKGhvc3QsICdfYWxsX2RvY3MnICsgcGFyYW1zKSxcbiAgICAgIGJvZHk6IGJvZHlcbiAgICB9LCBjYWxsYmFjayk7XG4gIH0pO1xuXG4gIC8vIEdldCBhIGxpc3Qgb2YgY2hhbmdlcyBtYWRlIHRvIGRvY3VtZW50cyBpbiB0aGUgZGF0YWJhc2UgZ2l2ZW4gYnkgaG9zdC5cbiAgLy8gVE9ETyBBY2NvcmRpbmcgdG8gdGhlIFJFQURNRSwgdGhlcmUgc2hvdWxkIGJlIHR3byBvdGhlciBtZXRob2RzIGhlcmUsXG4gIC8vIGFwaS5jaGFuZ2VzLmFkZExpc3RlbmVyIGFuZCBhcGkuY2hhbmdlcy5yZW1vdmVMaXN0ZW5lci5cbiAgYXBpLl9jaGFuZ2VzID0gZnVuY3Rpb24gKG9wdHMpIHtcbiAgICAvLyBXZSBpbnRlcm5hbGx5IHBhZ2UgdGhlIHJlc3VsdHMgb2YgYSBjaGFuZ2VzIHJlcXVlc3QsIHRoaXMgbWVhbnNcbiAgICAvLyBpZiB0aGVyZSBpcyBhIGxhcmdlIHNldCBvZiBjaGFuZ2VzIHRvIGJlIHJldHVybmVkIHdlIGNhbiBzdGFydFxuICAgIC8vIHByb2Nlc3NpbmcgdGhlbSBxdWlja2VyIGluc3RlYWQgb2Ygd2FpdGluZyBvbiB0aGUgZW50aXJlXG4gICAgLy8gc2V0IG9mIGNoYW5nZXMgdG8gcmV0dXJuIGFuZCBhdHRlbXB0aW5nIHRvIHByb2Nlc3MgdGhlbSBhdCBvbmNlXG4gICAgdmFyIGJhdGNoU2l6ZSA9ICdiYXRjaF9zaXplJyBpbiBvcHRzID8gb3B0cy5iYXRjaF9zaXplIDogQ0hBTkdFU19CQVRDSF9TSVpFO1xuXG4gICAgb3B0cyA9IHV0aWxzLmNsb25lKG9wdHMpO1xuICAgIG9wdHMudGltZW91dCA9IG9wdHMudGltZW91dCB8fCAzMCAqIDEwMDA7XG5cbiAgICAvLyBXZSBnaXZlIGEgNSBzZWNvbmQgYnVmZmVyIGZvciBDb3VjaERCIGNoYW5nZXMgdG8gcmVzcG9uZCB3aXRoXG4gICAgLy8gYW4gb2sgdGltZW91dFxuICAgIHZhciBwYXJhbXMgPSB7IHRpbWVvdXQ6IG9wdHMudGltZW91dCAtICg1ICogMTAwMCkgfTtcbiAgICB2YXIgbGltaXQgPSAodHlwZW9mIG9wdHMubGltaXQgIT09ICd1bmRlZmluZWQnKSA/IG9wdHMubGltaXQgOiBmYWxzZTtcbiAgICBpZiAobGltaXQgPT09IDApIHtcbiAgICAgIGxpbWl0ID0gMTtcbiAgICB9XG4gICAgdmFyIHJldHVybkRvY3M7XG4gICAgaWYgKCdyZXR1cm5Eb2NzJyBpbiBvcHRzKSB7XG4gICAgICByZXR1cm5Eb2NzID0gb3B0cy5yZXR1cm5Eb2NzO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm5Eb2NzID0gdHJ1ZTtcbiAgICB9XG4gICAgLy9cbiAgICB2YXIgbGVmdFRvRmV0Y2ggPSBsaW1pdDtcblxuICAgIGlmIChvcHRzLnN0eWxlKSB7XG4gICAgICBwYXJhbXMuc3R5bGUgPSBvcHRzLnN0eWxlO1xuICAgIH1cblxuICAgIGlmIChvcHRzLmluY2x1ZGVfZG9jcyB8fCBvcHRzLmZpbHRlciAmJiB0eXBlb2Ygb3B0cy5maWx0ZXIgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHBhcmFtcy5pbmNsdWRlX2RvY3MgPSB0cnVlO1xuICAgIH1cblxuICAgIGlmIChvcHRzLmF0dGFjaG1lbnRzKSB7XG4gICAgICBwYXJhbXMuYXR0YWNobWVudHMgPSB0cnVlO1xuICAgIH1cblxuICAgIGlmIChvcHRzLmNvbnRpbnVvdXMpIHtcbiAgICAgIHBhcmFtcy5mZWVkID0gJ2xvbmdwb2xsJztcbiAgICB9XG5cbiAgICBpZiAob3B0cy5jb25mbGljdHMpIHtcbiAgICAgIHBhcmFtcy5jb25mbGljdHMgPSB0cnVlO1xuICAgIH1cblxuICAgIGlmIChvcHRzLmRlc2NlbmRpbmcpIHtcbiAgICAgIHBhcmFtcy5kZXNjZW5kaW5nID0gdHJ1ZTtcbiAgICB9XG5cbiAgICBpZiAob3B0cy5maWx0ZXIgJiYgdHlwZW9mIG9wdHMuZmlsdGVyID09PSAnc3RyaW5nJykge1xuICAgICAgcGFyYW1zLmZpbHRlciA9IG9wdHMuZmlsdGVyO1xuICAgICAgaWYgKG9wdHMuZmlsdGVyID09PSAnX3ZpZXcnICYmXG4gICAgICAgICAgb3B0cy52aWV3ICYmXG4gICAgICAgICAgdHlwZW9mIG9wdHMudmlldyA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgcGFyYW1zLnZpZXcgPSBvcHRzLnZpZXc7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gSWYgb3B0cy5xdWVyeV9wYXJhbXMgZXhpc3RzLCBwYXNzIGl0IHRocm91Z2ggdG8gdGhlIGNoYW5nZXMgcmVxdWVzdC5cbiAgICAvLyBUaGVzZSBwYXJhbWV0ZXJzIG1heSBiZSB1c2VkIGJ5IHRoZSBmaWx0ZXIgb24gdGhlIHNvdXJjZSBkYXRhYmFzZS5cbiAgICBpZiAob3B0cy5xdWVyeV9wYXJhbXMgJiYgdHlwZW9mIG9wdHMucXVlcnlfcGFyYW1zID09PSAnb2JqZWN0Jykge1xuICAgICAgZm9yICh2YXIgcGFyYW1fbmFtZSBpbiBvcHRzLnF1ZXJ5X3BhcmFtcykge1xuICAgICAgICBpZiAob3B0cy5xdWVyeV9wYXJhbXMuaGFzT3duUHJvcGVydHkocGFyYW1fbmFtZSkpIHtcbiAgICAgICAgICBwYXJhbXNbcGFyYW1fbmFtZV0gPSBvcHRzLnF1ZXJ5X3BhcmFtc1twYXJhbV9uYW1lXTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIHZhciBtZXRob2QgPSAnR0VUJztcbiAgICB2YXIgYm9keTtcblxuICAgIGlmIChvcHRzLmRvY19pZHMpIHtcbiAgICAgIC8vIHNldCB0aGlzIGF1dG9tYWdpY2FsbHkgZm9yIHRoZSB1c2VyOyBpdCdzIGFubm95aW5nIHRoYXQgY291Y2hkYlxuICAgICAgLy8gcmVxdWlyZXMgYm90aCBhIFwiZmlsdGVyXCIgYW5kIGEgXCJkb2NfaWRzXCIgcGFyYW0uXG4gICAgICBwYXJhbXMuZmlsdGVyID0gJ19kb2NfaWRzJztcblxuICAgICAgdmFyIGRvY0lkc0pzb24gPSBKU09OLnN0cmluZ2lmeShvcHRzLmRvY19pZHMpO1xuXG4gICAgICBpZiAoZG9jSWRzSnNvbi5sZW5ndGggPCBNQVhfVVJMX0xFTkdUSCkge1xuICAgICAgICBwYXJhbXMuZG9jX2lkcyA9IGRvY0lkc0pzb247XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBhbnl0aGluZyBncmVhdGVyIHRoYW4gfjIwMDAgaXMgdW5zYWZlIGZvciBnZXRzLCBzb1xuICAgICAgICAvLyB1c2UgUE9TVCBpbnN0ZWFkXG4gICAgICAgIG1ldGhvZCA9ICdQT1NUJztcbiAgICAgICAgYm9keSA9IHtkb2NfaWRzOiBvcHRzLmRvY19pZHMgfTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAob3B0cy5jb250aW51b3VzICYmIGFwaS5fdXNlU1NFKSB7XG4gICAgICByZXR1cm4gIGFwaS5zc2Uob3B0cywgcGFyYW1zLCByZXR1cm5Eb2NzKTtcbiAgICB9XG4gICAgdmFyIHhocjtcbiAgICB2YXIgbGFzdEZldGNoZWRTZXE7XG5cbiAgICAvLyBHZXQgYWxsIHRoZSBjaGFuZ2VzIHN0YXJ0aW5nIHd0aWggdGhlIG9uZSBpbW1lZGlhdGVseSBhZnRlciB0aGVcbiAgICAvLyBzZXF1ZW5jZSBudW1iZXIgZ2l2ZW4gYnkgc2luY2UuXG4gICAgdmFyIGZldGNoID0gZnVuY3Rpb24gKHNpbmNlLCBjYWxsYmFjaykge1xuICAgICAgaWYgKG9wdHMuYWJvcnRlZCkge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBwYXJhbXMuc2luY2UgPSBzaW5jZTtcbiAgICAgIGlmICh0eXBlb2YgcGFyYW1zLnNpbmNlID09PSBcIm9iamVjdFwiKSB7XG4gICAgICAgIHBhcmFtcy5zaW5jZSA9IEpTT04uc3RyaW5naWZ5KHBhcmFtcy5zaW5jZSk7XG4gICAgICB9XG5cbiAgICAgIGlmIChvcHRzLmRlc2NlbmRpbmcpIHtcbiAgICAgICAgaWYgKGxpbWl0KSB7XG4gICAgICAgICAgcGFyYW1zLmxpbWl0ID0gbGVmdFRvRmV0Y2g7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHBhcmFtcy5saW1pdCA9ICghbGltaXQgfHwgbGVmdFRvRmV0Y2ggPiBiYXRjaFNpemUpID9cbiAgICAgICAgICBiYXRjaFNpemUgOiBsZWZ0VG9GZXRjaDtcbiAgICAgIH1cblxuICAgICAgdmFyIHBhcmFtU3RyID0gJz8nICsgT2JqZWN0LmtleXMocGFyYW1zKS5tYXAoZnVuY3Rpb24gKGspIHtcbiAgICAgICAgcmV0dXJuIGsgKyAnPScgKyBwYXJhbXNba107XG4gICAgICB9KS5qb2luKCcmJyk7XG5cbiAgICAgIC8vIFNldCB0aGUgb3B0aW9ucyBmb3IgdGhlIGFqYXggY2FsbFxuICAgICAgdmFyIHhock9wdHMgPSB7XG4gICAgICAgIGhlYWRlcnM6IGhvc3QuaGVhZGVycyxcbiAgICAgICAgbWV0aG9kOiBtZXRob2QsXG4gICAgICAgIHVybDogZ2VuREJVcmwoaG9zdCwgJ19jaGFuZ2VzJyArIHBhcmFtU3RyKSxcbiAgICAgICAgLy8gX2NoYW5nZXMgY2FuIHRha2UgYSBsb25nIHRpbWUgdG8gZ2VuZXJhdGUsIGVzcGVjaWFsbHkgd2hlbiBmaWx0ZXJlZFxuICAgICAgICB0aW1lb3V0OiBvcHRzLnRpbWVvdXQsXG4gICAgICAgIGJvZHk6IGJvZHlcbiAgICAgIH07XG4gICAgICBsYXN0RmV0Y2hlZFNlcSA9IHNpbmNlO1xuXG4gICAgICBpZiAob3B0cy5hYm9ydGVkKSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgLy8gR2V0IHRoZSBjaGFuZ2VzXG4gICAgICB4aHIgPSBhamF4KHhock9wdHMsIGNhbGxiYWNrKTtcbiAgICB9O1xuXG4gICAgLy8gSWYgb3B0cy5zaW5jZSBleGlzdHMsIGdldCBhbGwgdGhlIGNoYW5nZXMgZnJvbSB0aGUgc2VxdWVuY2VcbiAgICAvLyBudW1iZXIgZ2l2ZW4gYnkgb3B0cy5zaW5jZS4gT3RoZXJ3aXNlLCBnZXQgYWxsIHRoZSBjaGFuZ2VzXG4gICAgLy8gZnJvbSB0aGUgc2VxdWVuY2UgbnVtYmVyIDAuXG4gICAgdmFyIGZldGNoVGltZW91dCA9IDEwO1xuICAgIHZhciBmZXRjaFJldHJ5Q291bnQgPSAwO1xuXG4gICAgdmFyIHJlc3VsdHMgPSB7cmVzdWx0czogW119O1xuXG4gICAgdmFyIGZldGNoZWQgPSBmdW5jdGlvbiAoZXJyLCByZXMpIHtcbiAgICAgIGlmIChvcHRzLmFib3J0ZWQpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgdmFyIHJhd19yZXN1bHRzX2xlbmd0aCA9IDA7XG4gICAgICAvLyBJZiB0aGUgcmVzdWx0IG9mIHRoZSBhamF4IGNhbGwgKHJlcykgY29udGFpbnMgY2hhbmdlcyAocmVzLnJlc3VsdHMpXG4gICAgICBpZiAocmVzICYmIHJlcy5yZXN1bHRzKSB7XG4gICAgICAgIHJhd19yZXN1bHRzX2xlbmd0aCA9IHJlcy5yZXN1bHRzLmxlbmd0aDtcbiAgICAgICAgcmVzdWx0cy5sYXN0X3NlcSA9IHJlcy5sYXN0X3NlcTtcbiAgICAgICAgLy8gRm9yIGVhY2ggY2hhbmdlXG4gICAgICAgIHZhciByZXEgPSB7fTtcbiAgICAgICAgcmVxLnF1ZXJ5ID0gb3B0cy5xdWVyeV9wYXJhbXM7XG4gICAgICAgIHJlcy5yZXN1bHRzID0gcmVzLnJlc3VsdHMuZmlsdGVyKGZ1bmN0aW9uIChjKSB7XG4gICAgICAgICAgbGVmdFRvRmV0Y2gtLTtcbiAgICAgICAgICB2YXIgcmV0ID0gdXRpbHMuZmlsdGVyQ2hhbmdlKG9wdHMpKGMpO1xuICAgICAgICAgIGlmIChyZXQpIHtcbiAgICAgICAgICAgIGlmIChyZXR1cm5Eb2NzKSB7XG4gICAgICAgICAgICAgIHJlc3VsdHMucmVzdWx0cy5wdXNoKGMpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdXRpbHMuY2FsbChvcHRzLm9uQ2hhbmdlLCBjKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuIHJldDtcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2UgaWYgKGVycikge1xuICAgICAgICAvLyBJbiBjYXNlIG9mIGFuIGVycm9yLCBzdG9wIGxpc3RlbmluZyBmb3IgY2hhbmdlcyBhbmQgY2FsbFxuICAgICAgICAvLyBvcHRzLmNvbXBsZXRlXG4gICAgICAgIG9wdHMuYWJvcnRlZCA9IHRydWU7XG4gICAgICAgIHV0aWxzLmNhbGwob3B0cy5jb21wbGV0ZSwgZXJyKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICAvLyBUaGUgY2hhbmdlcyBmZWVkIG1heSBoYXZlIHRpbWVkIG91dCB3aXRoIG5vIHJlc3VsdHNcbiAgICAgIC8vIGlmIHNvIHJldXNlIGxhc3QgdXBkYXRlIHNlcXVlbmNlXG4gICAgICBpZiAocmVzICYmIHJlcy5sYXN0X3NlcSkge1xuICAgICAgICBsYXN0RmV0Y2hlZFNlcSA9IHJlcy5sYXN0X3NlcTtcbiAgICAgIH1cblxuICAgICAgdmFyIGZpbmlzaGVkID0gKGxpbWl0ICYmIGxlZnRUb0ZldGNoIDw9IDApIHx8XG4gICAgICAgIChyZXMgJiYgcmF3X3Jlc3VsdHNfbGVuZ3RoIDwgYmF0Y2hTaXplKSB8fFxuICAgICAgICAob3B0cy5kZXNjZW5kaW5nKTtcblxuICAgICAgaWYgKChvcHRzLmNvbnRpbnVvdXMgJiYgIShsaW1pdCAmJiBsZWZ0VG9GZXRjaCA8PSAwKSkgfHwgIWZpbmlzaGVkKSB7XG4gICAgICAgIC8vIEluY3JlYXNlIHJldHJ5IGRlbGF5IGV4cG9uZW50aWFsbHkgYXMgbG9uZyBhcyBlcnJvcnMgcGVyc2lzdFxuICAgICAgICBpZiAoZXJyKSB7XG4gICAgICAgICAgZmV0Y2hSZXRyeUNvdW50ICs9IDE7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgZmV0Y2hSZXRyeUNvdW50ID0gMDtcbiAgICAgICAgfVxuICAgICAgICB2YXIgdGltZW91dE11bHRpcGxpZXIgPSAxIDw8IGZldGNoUmV0cnlDb3VudDtcbiAgICAgICAgdmFyIHJldHJ5V2FpdCA9IGZldGNoVGltZW91dCAqIHRpbWVvdXRNdWx0aXBsaWVyO1xuICAgICAgICB2YXIgbWF4aW11bVdhaXQgPSBvcHRzLm1heGltdW1XYWl0IHx8IDMwMDAwO1xuXG4gICAgICAgIGlmIChyZXRyeVdhaXQgPiBtYXhpbXVtV2FpdCkge1xuICAgICAgICAgIHV0aWxzLmNhbGwob3B0cy5jb21wbGV0ZSwgZXJyIHx8IGVycm9ycy5lcnJvcihlcnJvcnMuVU5LTk9XTl9FUlJPUikpO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFF1ZXVlIGEgY2FsbCB0byBmZXRjaCBhZ2FpbiB3aXRoIHRoZSBuZXdlc3Qgc2VxdWVuY2UgbnVtYmVyXG4gICAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24gKCkgeyBmZXRjaChsYXN0RmV0Y2hlZFNlcSwgZmV0Y2hlZCk7IH0sIHJldHJ5V2FpdCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBXZSdyZSBkb25lLCBjYWxsIHRoZSBjYWxsYmFja1xuICAgICAgICB1dGlscy5jYWxsKG9wdHMuY29tcGxldGUsIG51bGwsIHJlc3VsdHMpO1xuICAgICAgfVxuICAgIH07XG5cbiAgICBmZXRjaChvcHRzLnNpbmNlIHx8IDAsIGZldGNoZWQpO1xuXG4gICAgLy8gUmV0dXJuIGEgbWV0aG9kIHRvIGNhbmNlbCB0aGlzIG1ldGhvZCBmcm9tIHByb2Nlc3NpbmcgYW55IG1vcmVcbiAgICByZXR1cm4ge1xuICAgICAgY2FuY2VsOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIG9wdHMuYWJvcnRlZCA9IHRydWU7XG4gICAgICAgIGlmICh4aHIpIHtcbiAgICAgICAgICB4aHIuYWJvcnQoKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH07XG4gIH07XG5cbiAgYXBpLnNzZSA9IGZ1bmN0aW9uIChvcHRzLCBwYXJhbXMsIHJldHVybkRvY3MpIHtcbiAgICBwYXJhbXMuZmVlZCA9ICdldmVudHNvdXJjZSc7XG4gICAgcGFyYW1zLnNpbmNlID0gb3B0cy5zaW5jZSB8fCAwO1xuICAgIHBhcmFtcy5saW1pdCA9IG9wdHMubGltaXQ7XG4gICAgZGVsZXRlIHBhcmFtcy50aW1lb3V0O1xuICAgIHZhciBwYXJhbVN0ciA9ICc/JyArIE9iamVjdC5rZXlzKHBhcmFtcykubWFwKGZ1bmN0aW9uIChrKSB7XG4gICAgICByZXR1cm4gayArICc9JyArIHBhcmFtc1trXTtcbiAgICB9KS5qb2luKCcmJyk7XG4gICAgdmFyIHVybCA9IGdlbkRCVXJsKGhvc3QsICdfY2hhbmdlcycgKyBwYXJhbVN0cik7XG4gICAgdmFyIHNvdXJjZSA9IG5ldyBFdmVudFNvdXJjZSh1cmwpO1xuICAgIHZhciByZXN1bHRzID0ge1xuICAgICAgcmVzdWx0czogW10sXG4gICAgICBsYXN0X3NlcTogZmFsc2VcbiAgICB9O1xuICAgIHZhciBkaXNwYXRjaGVkID0gZmFsc2U7XG4gICAgdmFyIG9wZW4gPSBmYWxzZTtcbiAgICBzb3VyY2UuYWRkRXZlbnRMaXN0ZW5lcignbWVzc2FnZScsIG1zZ0hhbmRsZXIsIGZhbHNlKTtcbiAgICBzb3VyY2Uub25vcGVuID0gZnVuY3Rpb24gKCkge1xuICAgICAgb3BlbiA9IHRydWU7XG4gICAgfTtcbiAgICBzb3VyY2Uub25lcnJvciA9IGVyckhhbmRsZXI7XG4gICAgcmV0dXJuIHtcbiAgICAgIGNhbmNlbDogZnVuY3Rpb24gKCkge1xuICAgICAgICBpZiAoZGlzcGF0Y2hlZCkge1xuICAgICAgICAgIHJldHVybiBkaXNwYXRjaGVkLmNhbmNlbCgpO1xuICAgICAgICB9XG4gICAgICAgIHNvdXJjZS5yZW1vdmVFdmVudExpc3RlbmVyKCdtZXNzYWdlJywgbXNnSGFuZGxlciwgZmFsc2UpO1xuICAgICAgICBzb3VyY2UuY2xvc2UoKTtcbiAgICAgIH1cbiAgICB9O1xuICAgIGZ1bmN0aW9uIG1zZ0hhbmRsZXIoZSkge1xuICAgICAgdmFyIGRhdGEgPSBKU09OLnBhcnNlKGUuZGF0YSk7XG4gICAgICBpZiAocmV0dXJuRG9jcykge1xuICAgICAgICByZXN1bHRzLnJlc3VsdHMucHVzaChkYXRhKTtcbiAgICAgIH1cbiAgICAgIHJlc3VsdHMubGFzdF9zZXEgPSBkYXRhLnNlcTtcbiAgICAgIHV0aWxzLmNhbGwob3B0cy5vbkNoYW5nZSwgZGF0YSk7XG4gICAgfVxuICAgIGZ1bmN0aW9uIGVyckhhbmRsZXIoZXJyKSB7XG4gICAgICBzb3VyY2UucmVtb3ZlRXZlbnRMaXN0ZW5lcignbWVzc2FnZScsIG1zZ0hhbmRsZXIsIGZhbHNlKTtcbiAgICAgIGlmIChvcGVuID09PSBmYWxzZSkge1xuICAgICAgICAvLyBlcnJvcmVkIGJlZm9yZSBpdCBvcGVuZWRcbiAgICAgICAgLy8gbGlrZWx5IGRvZXNuJ3Qgc3VwcG9ydCBFdmVudFNvdXJjZVxuICAgICAgICBhcGkuX3VzZVNTRSA9IGZhbHNlO1xuICAgICAgICBkaXNwYXRjaGVkID0gYXBpLl9jaGFuZ2VzKG9wdHMpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBzb3VyY2UuY2xvc2UoKTtcbiAgICAgIHV0aWxzLmNhbGwob3B0cy5jb21wbGV0ZSwgZXJyKTtcbiAgICB9XG4gICAgXG4gIH07XG5cbiAgYXBpLl91c2VTU0UgPSBmYWxzZTtcbiAgLy8gQ3VycmVudGx5IGRpc2FibGVkIGR1ZSB0byBmYWlsaW5nIGNocm9tZSB0ZXN0cyBpbiBzYXVjZWxhYnNcbiAgLy8gYXBpLl91c2VTU0UgPSB0eXBlb2YgZ2xvYmFsLkV2ZW50U291cmNlID09PSAnZnVuY3Rpb24nO1xuXG4gIC8vIEdpdmVuIGEgc2V0IG9mIGRvY3VtZW50L3JldmlzaW9uIElEcyAoZ2l2ZW4gYnkgcmVxKSwgdGV0cyB0aGUgc3Vic2V0IG9mXG4gIC8vIHRob3NlIHRoYXQgZG8gTk9UIGNvcnJlc3BvbmQgdG8gcmV2aXNpb25zIHN0b3JlZCBpbiB0aGUgZGF0YWJhc2UuXG4gIC8vIFNlZSBodHRwOi8vd2lraS5hcGFjaGUub3JnL2NvdWNoZGIvSHR0cFBvc3RSZXZzRGlmZlxuICBhcGkucmV2c0RpZmYgPSB1dGlscy5hZGFwdGVyRnVuKCdyZXZzRGlmZicsIGZ1bmN0aW9uIChyZXEsIG9wdHMsIGNhbGxiYWNrKSB7XG4gICAgLy8gSWYgbm8gb3B0aW9ucyB3ZXJlIGdpdmVuLCBzZXQgdGhlIGNhbGxiYWNrIHRvIGJlIHRoZSBzZWNvbmQgcGFyYW1ldGVyXG4gICAgaWYgKHR5cGVvZiBvcHRzID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICBjYWxsYmFjayA9IG9wdHM7XG4gICAgICBvcHRzID0ge307XG4gICAgfVxuXG4gICAgLy8gR2V0IHRoZSBtaXNzaW5nIGRvY3VtZW50L3JldmlzaW9uIElEc1xuICAgIGFqYXgoe1xuICAgICAgaGVhZGVyczogaG9zdC5oZWFkZXJzLFxuICAgICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgICB1cmw6IGdlbkRCVXJsKGhvc3QsICdfcmV2c19kaWZmJyksXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShyZXEpXG4gICAgfSwgY2FsbGJhY2spO1xuICB9KTtcblxuICBhcGkuX2Nsb3NlID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgY2FsbGJhY2soKTtcbiAgfTtcblxuICBhcGkuZGVzdHJveSA9IHV0aWxzLmFkYXB0ZXJGdW4oJ2Rlc3Ryb3knLCBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICBhamF4KHtcbiAgICAgIHVybDogZ2VuREJVcmwoaG9zdCwgJycpLFxuICAgICAgbWV0aG9kOiAnREVMRVRFJyxcbiAgICAgIGhlYWRlcnM6IGhvc3QuaGVhZGVyc1xuICAgIH0sIGZ1bmN0aW9uIChlcnIsIHJlc3ApIHtcbiAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgYXBpLmVtaXQoJ2Vycm9yJywgZXJyKTtcbiAgICAgICAgY2FsbGJhY2soZXJyKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGFwaS5lbWl0KCdkZXN0cm95ZWQnKTtcbiAgICAgICAgY2FsbGJhY2sobnVsbCwgcmVzcCk7XG4gICAgICB9XG4gICAgfSk7XG4gIH0pO1xufVxuXG4vLyBEZWxldGUgdGhlIEh0dHBQb3VjaCBzcGVjaWZpZWQgYnkgdGhlIGdpdmVuIG5hbWUuXG5IdHRwUG91Y2guZGVzdHJveSA9IHV0aWxzLnRvUHJvbWlzZShmdW5jdGlvbiAobmFtZSwgb3B0cywgY2FsbGJhY2spIHtcbiAgdmFyIGhvc3QgPSBnZXRIb3N0KG5hbWUsIG9wdHMpO1xuICBvcHRzID0gb3B0cyB8fCB7fTtcbiAgaWYgKHR5cGVvZiBvcHRzID09PSAnZnVuY3Rpb24nKSB7XG4gICAgY2FsbGJhY2sgPSBvcHRzO1xuICAgIG9wdHMgPSB7fTtcbiAgfVxuICBvcHRzID0gdXRpbHMuY2xvbmUob3B0cyk7XG4gIG9wdHMuaGVhZGVycyA9IGhvc3QuaGVhZGVycztcbiAgb3B0cy5tZXRob2QgPSAnREVMRVRFJztcbiAgb3B0cy51cmwgPSBnZW5EQlVybChob3N0LCAnJyk7XG4gIHZhciBhamF4T3B0cyA9IG9wdHMuYWpheCB8fCB7fTtcbiAgb3B0cyA9IHV0aWxzLmV4dGVuZCh7fSwgb3B0cywgYWpheE9wdHMpO1xuICB1dGlscy5hamF4KG9wdHMsIGNhbGxiYWNrKTtcbn0pO1xuXG4vLyBIdHRwUG91Y2ggaXMgYSB2YWxpZCBhZGFwdGVyLlxuSHR0cFBvdWNoLnZhbGlkID0gZnVuY3Rpb24gKCkge1xuICByZXR1cm4gdHJ1ZTtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gSHR0cFBvdWNoO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgbWVyZ2UgPSByZXF1aXJlKCcuLi8uLi9tZXJnZScpO1xudmFyIGVycm9ycyA9IHJlcXVpcmUoJy4uLy4uL2RlcHMvZXJyb3JzJyk7XG52YXIgaWRiVXRpbHMgPSByZXF1aXJlKCcuL2lkYi11dGlscycpO1xudmFyIGlkYkNvbnN0YW50cyA9IHJlcXVpcmUoJy4vaWRiLWNvbnN0YW50cycpO1xuXG52YXIgQVRUQUNIX1NUT1JFID0gaWRiQ29uc3RhbnRzLkFUVEFDSF9TVE9SRTtcbnZhciBCWV9TRVFfU1RPUkUgPSBpZGJDb25zdGFudHMuQllfU0VRX1NUT1JFO1xudmFyIERPQ19TVE9SRSA9IGlkYkNvbnN0YW50cy5ET0NfU1RPUkU7XG5cbnZhciBkZWNvZGVEb2MgPSBpZGJVdGlscy5kZWNvZGVEb2M7XG52YXIgZGVjb2RlTWV0YWRhdGEgPSBpZGJVdGlscy5kZWNvZGVNZXRhZGF0YTtcbnZhciBmZXRjaEF0dGFjaG1lbnRzSWZOZWNlc3NhcnkgPSBpZGJVdGlscy5mZXRjaEF0dGFjaG1lbnRzSWZOZWNlc3Nhcnk7XG52YXIgcG9zdFByb2Nlc3NBdHRhY2htZW50cyA9IGlkYlV0aWxzLnBvc3RQcm9jZXNzQXR0YWNobWVudHM7XG52YXIgb3BlblRyYW5zYWN0aW9uU2FmZWx5ID0gaWRiVXRpbHMub3BlblRyYW5zYWN0aW9uU2FmZWx5O1xuXG5mdW5jdGlvbiBjcmVhdGVLZXlSYW5nZShzdGFydCwgZW5kLCBpbmNsdXNpdmVFbmQsIGtleSwgZGVzY2VuZGluZykge1xuICB0cnkge1xuICAgIGlmIChzdGFydCAmJiBlbmQpIHtcbiAgICAgIGlmIChkZXNjZW5kaW5nKSB7XG4gICAgICAgIHJldHVybiBJREJLZXlSYW5nZS5ib3VuZChlbmQsIHN0YXJ0LCAhaW5jbHVzaXZlRW5kLCBmYWxzZSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gSURCS2V5UmFuZ2UuYm91bmQoc3RhcnQsIGVuZCwgZmFsc2UsICFpbmNsdXNpdmVFbmQpO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoc3RhcnQpIHtcbiAgICAgIGlmIChkZXNjZW5kaW5nKSB7XG4gICAgICAgIHJldHVybiBJREJLZXlSYW5nZS51cHBlckJvdW5kKHN0YXJ0KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiBJREJLZXlSYW5nZS5sb3dlckJvdW5kKHN0YXJ0KTtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGVuZCkge1xuICAgICAgaWYgKGRlc2NlbmRpbmcpIHtcbiAgICAgICAgcmV0dXJuIElEQktleVJhbmdlLmxvd2VyQm91bmQoZW5kLCAhaW5jbHVzaXZlRW5kKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiBJREJLZXlSYW5nZS51cHBlckJvdW5kKGVuZCwgIWluY2x1c2l2ZUVuZCk7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChrZXkpIHtcbiAgICAgIHJldHVybiBJREJLZXlSYW5nZS5vbmx5KGtleSk7XG4gICAgfVxuICB9IGNhdGNoIChlKSB7XG4gICAgcmV0dXJuIHtlcnJvcjogZX07XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59XG5cbmZ1bmN0aW9uIGhhbmRsZUtleVJhbmdlRXJyb3IoYXBpLCBvcHRzLCBlcnIsIGNhbGxiYWNrKSB7XG4gIGlmIChlcnIubmFtZSA9PT0gXCJEYXRhRXJyb3JcIiAmJiBlcnIuY29kZSA9PT0gMCkge1xuICAgIC8vIGRhdGEgZXJyb3IsIHN0YXJ0IGlzIGxlc3MgdGhhbiBlbmRcbiAgICByZXR1cm4gY2FsbGJhY2sobnVsbCwge1xuICAgICAgdG90YWxfcm93czogYXBpLl9tZXRhLmRvY0NvdW50LFxuICAgICAgb2Zmc2V0OiBvcHRzLnNraXAsXG4gICAgICByb3dzOiBbXVxuICAgIH0pO1xuICB9XG4gIGNhbGxiYWNrKGVycm9ycy5lcnJvcihlcnJvcnMuSURCX0VSUk9SLCBlcnIubmFtZSwgZXJyLm1lc3NhZ2UpKTtcbn1cblxuZnVuY3Rpb24gaWRiQWxsRG9jcyhvcHRzLCBhcGksIGlkYiwgY2FsbGJhY2spIHtcblxuICBmdW5jdGlvbiBhbGxEb2NzUXVlcnkob3B0cywgY2FsbGJhY2spIHtcbiAgICB2YXIgc3RhcnQgPSAnc3RhcnRrZXknIGluIG9wdHMgPyBvcHRzLnN0YXJ0a2V5IDogZmFsc2U7XG4gICAgdmFyIGVuZCA9ICdlbmRrZXknIGluIG9wdHMgPyBvcHRzLmVuZGtleSA6IGZhbHNlO1xuICAgIHZhciBrZXkgPSAna2V5JyBpbiBvcHRzID8gb3B0cy5rZXkgOiBmYWxzZTtcbiAgICB2YXIgc2tpcCA9IG9wdHMuc2tpcCB8fCAwO1xuICAgIHZhciBsaW1pdCA9IHR5cGVvZiBvcHRzLmxpbWl0ID09PSAnbnVtYmVyJyA/IG9wdHMubGltaXQgOiAtMTtcbiAgICB2YXIgaW5jbHVzaXZlRW5kID0gb3B0cy5pbmNsdXNpdmVfZW5kICE9PSBmYWxzZTtcbiAgICB2YXIgZGVzY2VuZGluZyA9ICdkZXNjZW5kaW5nJyBpbiBvcHRzICYmIG9wdHMuZGVzY2VuZGluZyA/ICdwcmV2JyA6IG51bGw7XG5cbiAgICB2YXIga2V5UmFuZ2UgPSBjcmVhdGVLZXlSYW5nZShzdGFydCwgZW5kLCBpbmNsdXNpdmVFbmQsIGtleSwgZGVzY2VuZGluZyk7XG4gICAgaWYgKGtleVJhbmdlICYmIGtleVJhbmdlLmVycm9yKSB7XG4gICAgICByZXR1cm4gaGFuZGxlS2V5UmFuZ2VFcnJvcihhcGksIG9wdHMsIGtleVJhbmdlLmVycm9yLCBjYWxsYmFjayk7XG4gICAgfVxuXG4gICAgdmFyIHN0b3JlcyA9IFtET0NfU1RPUkUsIEJZX1NFUV9TVE9SRV07XG5cbiAgICBpZiAob3B0cy5hdHRhY2htZW50cykge1xuICAgICAgc3RvcmVzLnB1c2goQVRUQUNIX1NUT1JFKTtcbiAgICB9XG4gICAgdmFyIHR4blJlc3VsdCA9IG9wZW5UcmFuc2FjdGlvblNhZmVseShpZGIsIHN0b3JlcywgJ3JlYWRvbmx5Jyk7XG4gICAgaWYgKHR4blJlc3VsdC5lcnJvcikge1xuICAgICAgcmV0dXJuIGNhbGxiYWNrKHR4blJlc3VsdC5lcnJvcik7XG4gICAgfVxuICAgIHZhciB0eG4gPSB0eG5SZXN1bHQudHhuO1xuICAgIHZhciBkb2NTdG9yZSA9IHR4bi5vYmplY3RTdG9yZShET0NfU1RPUkUpO1xuICAgIHZhciBzZXFTdG9yZSA9IHR4bi5vYmplY3RTdG9yZShCWV9TRVFfU1RPUkUpO1xuICAgIHZhciBjdXJzb3IgPSBkZXNjZW5kaW5nID9cbiAgICAgIGRvY1N0b3JlLm9wZW5DdXJzb3Ioa2V5UmFuZ2UsIGRlc2NlbmRpbmcpIDpcbiAgICAgIGRvY1N0b3JlLm9wZW5DdXJzb3Ioa2V5UmFuZ2UpO1xuICAgIHZhciBkb2NJZFJldkluZGV4ID0gc2VxU3RvcmUuaW5kZXgoJ19kb2NfaWRfcmV2Jyk7XG4gICAgdmFyIHJlc3VsdHMgPSBbXTtcbiAgICB2YXIgZG9jQ291bnQgPSAwO1xuXG4gICAgLy8gaWYgdGhlIHVzZXIgc3BlY2lmaWVzIGluY2x1ZGVfZG9jcz10cnVlLCB0aGVuIHdlIGRvbid0XG4gICAgLy8gd2FudCB0byBibG9jayB0aGUgbWFpbiBjdXJzb3Igd2hpbGUgd2UncmUgZmV0Y2hpbmcgdGhlIGRvY1xuICAgIGZ1bmN0aW9uIGZldGNoRG9jQXN5bmNocm9ub3VzbHkobWV0YWRhdGEsIHJvdywgd2lubmluZ1Jldikge1xuICAgICAgdmFyIGtleSA9IG1ldGFkYXRhLmlkICsgXCI6OlwiICsgd2lubmluZ1JldjtcbiAgICAgIGRvY0lkUmV2SW5kZXguZ2V0KGtleSkub25zdWNjZXNzID0gIGZ1bmN0aW9uIG9uR2V0RG9jKGUpIHtcbiAgICAgICAgcm93LmRvYyA9IGRlY29kZURvYyhlLnRhcmdldC5yZXN1bHQpO1xuICAgICAgICBpZiAob3B0cy5jb25mbGljdHMpIHtcbiAgICAgICAgICByb3cuZG9jLl9jb25mbGljdHMgPSBtZXJnZS5jb2xsZWN0Q29uZmxpY3RzKG1ldGFkYXRhKTtcbiAgICAgICAgfVxuICAgICAgICBmZXRjaEF0dGFjaG1lbnRzSWZOZWNlc3Nhcnkocm93LmRvYywgb3B0cywgdHhuKTtcbiAgICAgIH07XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gYWxsRG9jc0lubmVyKGN1cnNvciwgd2lubmluZ1JldiwgbWV0YWRhdGEpIHtcbiAgICAgIHZhciByb3cgPSB7XG4gICAgICAgIGlkOiBtZXRhZGF0YS5pZCxcbiAgICAgICAga2V5OiBtZXRhZGF0YS5pZCxcbiAgICAgICAgdmFsdWU6IHtcbiAgICAgICAgICByZXY6IHdpbm5pbmdSZXZcbiAgICAgICAgfVxuICAgICAgfTtcbiAgICAgIHZhciBkZWxldGVkID0gbWV0YWRhdGEuZGVsZXRlZDtcbiAgICAgIGlmIChvcHRzLmRlbGV0ZWQgPT09ICdvaycpIHtcbiAgICAgICAgcmVzdWx0cy5wdXNoKHJvdyk7XG4gICAgICAgIC8vIGRlbGV0ZWQgZG9jcyBhcmUgb2theSB3aXRoIFwia2V5c1wiIHJlcXVlc3RzXG4gICAgICAgIGlmIChkZWxldGVkKSB7XG4gICAgICAgICAgcm93LnZhbHVlLmRlbGV0ZWQgPSB0cnVlO1xuICAgICAgICAgIHJvdy5kb2MgPSBudWxsO1xuICAgICAgICB9IGVsc2UgaWYgKG9wdHMuaW5jbHVkZV9kb2NzKSB7XG4gICAgICAgICAgZmV0Y2hEb2NBc3luY2hyb25vdXNseShtZXRhZGF0YSwgcm93LCB3aW5uaW5nUmV2KTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIGlmICghZGVsZXRlZCAmJiBza2lwLS0gPD0gMCkge1xuICAgICAgICByZXN1bHRzLnB1c2gocm93KTtcbiAgICAgICAgaWYgKG9wdHMuaW5jbHVkZV9kb2NzKSB7XG4gICAgICAgICAgZmV0Y2hEb2NBc3luY2hyb25vdXNseShtZXRhZGF0YSwgcm93LCB3aW5uaW5nUmV2KTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoLS1saW1pdCA9PT0gMCkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgY3Vyc29yW1wiY29udGludWVcIl0oKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBvbkdldEN1cnNvcihlKSB7XG4gICAgICBkb2NDb3VudCA9IGFwaS5fbWV0YS5kb2NDb3VudDsgLy8gZG8gdGhpcyB3aXRoaW4gdGhlIHR4biBmb3IgY29uc2lzdGVuY3lcbiAgICAgIHZhciBjdXJzb3IgPSBlLnRhcmdldC5yZXN1bHQ7XG4gICAgICBpZiAoIWN1cnNvcikge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICB2YXIgbWV0YWRhdGEgPSBkZWNvZGVNZXRhZGF0YShjdXJzb3IudmFsdWUpO1xuICAgICAgdmFyIHdpbm5pbmdSZXYgPSBtZXRhZGF0YS53aW5uaW5nUmV2O1xuXG4gICAgICBhbGxEb2NzSW5uZXIoY3Vyc29yLCB3aW5uaW5nUmV2LCBtZXRhZGF0YSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gb25SZXN1bHRzUmVhZHkoKSB7XG4gICAgICBjYWxsYmFjayhudWxsLCB7XG4gICAgICAgIHRvdGFsX3Jvd3M6IGRvY0NvdW50LFxuICAgICAgICBvZmZzZXQ6IG9wdHMuc2tpcCxcbiAgICAgICAgcm93czogcmVzdWx0c1xuICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gb25UeG5Db21wbGV0ZSgpIHtcbiAgICAgIGlmIChvcHRzLmF0dGFjaG1lbnRzKSB7XG4gICAgICAgIHBvc3RQcm9jZXNzQXR0YWNobWVudHMocmVzdWx0cykudGhlbihvblJlc3VsdHNSZWFkeSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBvblJlc3VsdHNSZWFkeSgpO1xuICAgICAgfVxuICAgIH1cblxuICAgIHR4bi5vbmNvbXBsZXRlID0gb25UeG5Db21wbGV0ZTtcbiAgICBjdXJzb3Iub25zdWNjZXNzID0gb25HZXRDdXJzb3I7XG4gIH1cblxuICBmdW5jdGlvbiBhbGxEb2NzKG9wdHMsIGNhbGxiYWNrKSB7XG5cbiAgICBpZiAob3B0cy5saW1pdCA9PT0gMCkge1xuICAgICAgcmV0dXJuIGNhbGxiYWNrKG51bGwsIHtcbiAgICAgICAgdG90YWxfcm93czogYXBpLl9tZXRhLmRvY0NvdW50LFxuICAgICAgICBvZmZzZXQ6IG9wdHMuc2tpcCxcbiAgICAgICAgcm93czogW11cbiAgICAgIH0pO1xuICAgIH1cbiAgICBhbGxEb2NzUXVlcnkob3B0cywgY2FsbGJhY2spO1xuICB9XG5cbiAgYWxsRG9jcyhvcHRzLCBjYWxsYmFjayk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gaWRiQWxsRG9jczsiLCIndXNlIHN0cmljdCc7XG5cbnZhciB1dGlscyA9IHJlcXVpcmUoJy4uLy4uL3V0aWxzJyk7XG52YXIgaWRiQ29uc3RhbnRzID0gcmVxdWlyZSgnLi9pZGItY29uc3RhbnRzJyk7XG52YXIgREVURUNUX0JMT0JfU1VQUE9SVF9TVE9SRSA9IGlkYkNvbnN0YW50cy5ERVRFQ1RfQkxPQl9TVVBQT1JUX1NUT1JFO1xuXG4vL1xuLy8gRGV0ZWN0IGJsb2Igc3VwcG9ydC4gQ2hyb21lIGRpZG4ndCBzdXBwb3J0IGl0IHVudGlsIHZlcnNpb24gMzguXG4vLyBJbiB2ZXJzaW9uIDM3IHRoZXkgaGFkIGEgYnJva2VuIHZlcnNpb24gd2hlcmUgUE5HcyAoYW5kIHBvc3NpYmx5XG4vLyBvdGhlciBiaW5hcnkgdHlwZXMpIGFyZW4ndCBzdG9yZWQgY29ycmVjdGx5LCBiZWNhdXNlIHdoZW4geW91IGZldGNoXG4vLyB0aGVtLCB0aGUgY29udGVudCB0eXBlIGlzIGFsd2F5cyBudWxsLlxuLy9cbi8vIEZ1cnRoZXJtb3JlLCB0aGV5IGhhdmUgc29tZSBvdXRzdGFuZGluZyBidWdzIHdoZXJlIGJsb2JzIG9jY2FzaW9uYWxseVxuLy8gYXJlIHJlYWQgYnkgRmlsZVJlYWRlciBhcyBudWxsLCBvciBieSBhamF4IGFzIDQwNHMuXG4vL1xuLy8gU2FkbHkgd2UgdXNlIHRoZSA0MDQgYnVnIHRvIGRldGVjdCB0aGUgRmlsZVJlYWRlciBidWcsIHNvIGlmIHRoZXlcbi8vIGdldCBmaXhlZCBpbmRlcGVuZGVudGx5IGFuZCByZWxlYXNlZCBpbiBkaWZmZXJlbnQgdmVyc2lvbnMgb2YgQ2hyb21lLFxuLy8gdGhlbiB0aGUgYnVnIGNvdWxkIGNvbWUgYmFjay4gU28gaXQncyB3b3J0aHdoaWxlIHRvIHdhdGNoIHRoZXNlIGlzc3Vlczpcbi8vIDQwNCBidWc6IGh0dHBzOi8vY29kZS5nb29nbGUuY29tL3AvY2hyb21pdW0vaXNzdWVzL2RldGFpbD9pZD00NDc5MTZcbi8vIEZpbGVSZWFkZXIgYnVnOiBodHRwczovL2NvZGUuZ29vZ2xlLmNvbS9wL2Nocm9taXVtL2lzc3Vlcy9kZXRhaWw/aWQ9NDQ3ODM2XG4vL1xuZnVuY3Rpb24gY2hlY2tCbG9iU3VwcG9ydCh0eG4sIGlkYikge1xuICByZXR1cm4gbmV3IHV0aWxzLlByb21pc2UoZnVuY3Rpb24gKHJlc29sdmUsIHJlamVjdCkge1xuICAgIHZhciBibG9iID0gdXRpbHMuY3JlYXRlQmxvYihbJyddLCB7dHlwZTogJ2ltYWdlL3BuZyd9KTtcbiAgICB0eG4ub2JqZWN0U3RvcmUoREVURUNUX0JMT0JfU1VQUE9SVF9TVE9SRSkucHV0KGJsb2IsICdrZXknKTtcbiAgICB0eG4ub25jb21wbGV0ZSA9IGZ1bmN0aW9uICgpIHtcbiAgICAgIC8vIGhhdmUgdG8gZG8gaXQgaW4gYSBzZXBhcmF0ZSB0cmFuc2FjdGlvbiwgZWxzZSB0aGUgY29ycmVjdFxuICAgICAgLy8gY29udGVudCB0eXBlIGlzIGFsd2F5cyByZXR1cm5lZFxuICAgICAgdmFyIGJsb2JUeG4gPSBpZGIudHJhbnNhY3Rpb24oW0RFVEVDVF9CTE9CX1NVUFBPUlRfU1RPUkVdLFxuICAgICAgICAncmVhZHdyaXRlJyk7XG4gICAgICB2YXIgZ2V0QmxvYlJlcSA9IGJsb2JUeG4ub2JqZWN0U3RvcmUoXG4gICAgICAgIERFVEVDVF9CTE9CX1NVUFBPUlRfU1RPUkUpLmdldCgna2V5Jyk7XG4gICAgICBnZXRCbG9iUmVxLm9uZXJyb3IgPSByZWplY3Q7XG4gICAgICBnZXRCbG9iUmVxLm9uc3VjY2VzcyA9IGZ1bmN0aW9uIChlKSB7XG5cbiAgICAgICAgdmFyIHN0b3JlZEJsb2IgPSBlLnRhcmdldC5yZXN1bHQ7XG4gICAgICAgIHZhciB1cmwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKHN0b3JlZEJsb2IpO1xuXG4gICAgICAgIHV0aWxzLmFqYXgoe1xuICAgICAgICAgIHVybDogdXJsLFxuICAgICAgICAgIGNhY2hlOiB0cnVlLFxuICAgICAgICAgIGJpbmFyeTogdHJ1ZVxuICAgICAgICB9LCBmdW5jdGlvbiAoZXJyLCByZXMpIHtcbiAgICAgICAgICBpZiAoZXJyICYmIGVyci5zdGF0dXMgPT09IDQwNSkge1xuICAgICAgICAgICAgLy8gZmlyZWZveCB3b24ndCBsZXQgdXMgZG8gdGhhdC4gYnV0IGZpcmVmb3ggZG9lc24ndFxuICAgICAgICAgICAgLy8gaGF2ZSB0aGUgYmxvYiB0eXBlIGJ1ZyB0aGF0IENocm9tZSBkb2VzLCBzbyB0aGF0J3Mgb2tcbiAgICAgICAgICAgIHJlc29sdmUodHJ1ZSk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJlc29sdmUoISEocmVzICYmIHJlcy50eXBlID09PSAnaW1hZ2UvcG5nJykpO1xuICAgICAgICAgICAgaWYgKGVyciAmJiBlcnIuc3RhdHVzID09PSA0MDQpIHtcbiAgICAgICAgICAgICAgdXRpbHMuZXhwbGFpbjQwNCgnUG91Y2hEQiBpcyBqdXN0IGRldGVjdGluZyBibG9iIFVSTCBzdXBwb3J0LicpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICBVUkwucmV2b2tlT2JqZWN0VVJMKHVybCk7XG4gICAgICAgIH0pO1xuICAgICAgfTtcbiAgICB9O1xuICB9KVtcImNhdGNoXCJdKGZ1bmN0aW9uICgpIHtcbiAgICByZXR1cm4gZmFsc2U7IC8vIGVycm9yLCBzbyBhc3N1bWUgdW5zdXBwb3J0ZWRcbiAgfSk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gY2hlY2tCbG9iU3VwcG9ydDsiLCIndXNlIHN0cmljdCc7XG5cbnZhciB1dGlscyA9IHJlcXVpcmUoJy4uLy4uL3V0aWxzJyk7XG52YXIgZXJyb3JzID0gcmVxdWlyZSgnLi4vLi4vZGVwcy9lcnJvcnMnKTtcbnZhciBpZGJVdGlscyA9IHJlcXVpcmUoJy4vaWRiLXV0aWxzJyk7XG52YXIgaWRiQ29uc3RhbnRzID0gcmVxdWlyZSgnLi9pZGItY29uc3RhbnRzJyk7XG5cbnZhciBBVFRBQ0hfQU5EX1NFUV9TVE9SRSA9IGlkYkNvbnN0YW50cy5BVFRBQ0hfQU5EX1NFUV9TVE9SRTtcbnZhciBBVFRBQ0hfU1RPUkUgPSBpZGJDb25zdGFudHMuQVRUQUNIX1NUT1JFO1xudmFyIEJZX1NFUV9TVE9SRSA9IGlkYkNvbnN0YW50cy5CWV9TRVFfU1RPUkU7XG52YXIgRE9DX1NUT1JFID0gaWRiQ29uc3RhbnRzLkRPQ19TVE9SRTtcbnZhciBMT0NBTF9TVE9SRSA9IGlkYkNvbnN0YW50cy5MT0NBTF9TVE9SRTtcbnZhciBNRVRBX1NUT1JFID0gaWRiQ29uc3RhbnRzLk1FVEFfU1RPUkU7XG5cbnZhciBjb21wYWN0UmV2cyA9IGlkYlV0aWxzLmNvbXBhY3RSZXZzO1xudmFyIGRlY29kZU1ldGFkYXRhID0gaWRiVXRpbHMuZGVjb2RlTWV0YWRhdGE7XG52YXIgZW5jb2RlTWV0YWRhdGEgPSBpZGJVdGlscy5lbmNvZGVNZXRhZGF0YTtcbnZhciBpZGJFcnJvciA9IGlkYlV0aWxzLmlkYkVycm9yO1xudmFyIG9wZW5UcmFuc2FjdGlvblNhZmVseSA9IGlkYlV0aWxzLm9wZW5UcmFuc2FjdGlvblNhZmVseTtcblxuZnVuY3Rpb24gaWRiQnVsa0RvY3MocmVxLCBvcHRzLCBhcGksIGlkYiwgQ2hhbmdlcywgY2FsbGJhY2spIHtcbiAgdmFyIGRvY0luZm9zID0gcmVxLmRvY3M7XG4gIHZhciB0eG47XG4gIHZhciBkb2NTdG9yZTtcbiAgdmFyIGJ5U2VxU3RvcmU7XG4gIHZhciBhdHRhY2hTdG9yZTtcbiAgdmFyIGF0dGFjaEFuZFNlcVN0b3JlO1xuICB2YXIgZG9jSW5mb0Vycm9yO1xuICB2YXIgZG9jQ291bnREZWx0YSA9IDA7XG5cbiAgZm9yICh2YXIgaSA9IDAsIGxlbiA9IGRvY0luZm9zLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgdmFyIGRvYyA9IGRvY0luZm9zW2ldO1xuICAgIGlmIChkb2MuX2lkICYmIHV0aWxzLmlzTG9jYWxJZChkb2MuX2lkKSkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGRvYyA9IGRvY0luZm9zW2ldID0gdXRpbHMucGFyc2VEb2MoZG9jLCBvcHRzLm5ld19lZGl0cyk7XG4gICAgaWYgKGRvYy5lcnJvciAmJiAhZG9jSW5mb0Vycm9yKSB7XG4gICAgICBkb2NJbmZvRXJyb3IgPSBkb2M7XG4gICAgfVxuICB9XG5cbiAgaWYgKGRvY0luZm9FcnJvcikge1xuICAgIHJldHVybiBjYWxsYmFjayhkb2NJbmZvRXJyb3IpO1xuICB9XG5cbiAgdmFyIHJlc3VsdHMgPSBuZXcgQXJyYXkoZG9jSW5mb3MubGVuZ3RoKTtcbiAgdmFyIGZldGNoZWREb2NzID0gbmV3IHV0aWxzLk1hcCgpO1xuICB2YXIgcHJlY29uZGl0aW9uRXJyb3JlZCA9IGZhbHNlO1xuICB2YXIgYmxvYlR5cGUgPSBhcGkuX21ldGEuYmxvYlN1cHBvcnQgPyAnYmxvYicgOiAnYmFzZTY0JztcblxuICB1dGlscy5wcmVwcm9jZXNzQXR0YWNobWVudHMoZG9jSW5mb3MsIGJsb2JUeXBlLCBmdW5jdGlvbiAoZXJyKSB7XG4gICAgaWYgKGVycikge1xuICAgICAgcmV0dXJuIGNhbGxiYWNrKGVycik7XG4gICAgfVxuICAgIHN0YXJ0VHJhbnNhY3Rpb24oKTtcbiAgfSk7XG5cbiAgZnVuY3Rpb24gc3RhcnRUcmFuc2FjdGlvbigpIHtcblxuICAgIHZhciBzdG9yZXMgPSBbXG4gICAgICBET0NfU1RPUkUsIEJZX1NFUV9TVE9SRSxcbiAgICAgIEFUVEFDSF9TVE9SRSwgTUVUQV9TVE9SRSxcbiAgICAgIExPQ0FMX1NUT1JFLCBBVFRBQ0hfQU5EX1NFUV9TVE9SRVxuICAgIF07XG4gICAgdmFyIHR4blJlc3VsdCA9IG9wZW5UcmFuc2FjdGlvblNhZmVseShpZGIsIHN0b3JlcywgJ3JlYWR3cml0ZScpO1xuICAgIGlmICh0eG5SZXN1bHQuZXJyb3IpIHtcbiAgICAgIHJldHVybiBjYWxsYmFjayh0eG5SZXN1bHQuZXJyb3IpO1xuICAgIH1cbiAgICB0eG4gPSB0eG5SZXN1bHQudHhuO1xuICAgIHR4bi5vbmVycm9yID0gaWRiRXJyb3IoY2FsbGJhY2spO1xuICAgIHR4bi5vbnRpbWVvdXQgPSBpZGJFcnJvcihjYWxsYmFjayk7XG4gICAgdHhuLm9uY29tcGxldGUgPSBjb21wbGV0ZTtcbiAgICBkb2NTdG9yZSA9IHR4bi5vYmplY3RTdG9yZShET0NfU1RPUkUpO1xuICAgIGJ5U2VxU3RvcmUgPSB0eG4ub2JqZWN0U3RvcmUoQllfU0VRX1NUT1JFKTtcbiAgICBhdHRhY2hTdG9yZSA9IHR4bi5vYmplY3RTdG9yZShBVFRBQ0hfU1RPUkUpO1xuICAgIGF0dGFjaEFuZFNlcVN0b3JlID0gdHhuLm9iamVjdFN0b3JlKEFUVEFDSF9BTkRfU0VRX1NUT1JFKTtcblxuICAgIHZlcmlmeUF0dGFjaG1lbnRzKGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgcHJlY29uZGl0aW9uRXJyb3JlZCA9IHRydWU7XG4gICAgICAgIHJldHVybiBjYWxsYmFjayhlcnIpO1xuICAgICAgfVxuICAgICAgZmV0Y2hFeGlzdGluZ0RvY3MoKTtcbiAgICB9KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHByb2Nlc3NEb2NzKCkge1xuXG4gICAgdXRpbHMucHJvY2Vzc0RvY3MoZG9jSW5mb3MsIGFwaSwgZmV0Y2hlZERvY3MsIHR4biwgcmVzdWx0cyxcbiAgICAgIHdyaXRlRG9jLCBvcHRzKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGZldGNoRXhpc3RpbmdEb2NzKCkge1xuXG4gICAgaWYgKCFkb2NJbmZvcy5sZW5ndGgpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgbnVtRmV0Y2hlZCA9IDA7XG5cbiAgICBmdW5jdGlvbiBjaGVja0RvbmUoKSB7XG4gICAgICBpZiAoKytudW1GZXRjaGVkID09PSBkb2NJbmZvcy5sZW5ndGgpIHtcbiAgICAgICAgcHJvY2Vzc0RvY3MoKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZWFkTWV0YWRhdGEoZXZlbnQpIHtcbiAgICAgIHZhciBtZXRhZGF0YSA9IGRlY29kZU1ldGFkYXRhKGV2ZW50LnRhcmdldC5yZXN1bHQpO1xuXG4gICAgICBpZiAobWV0YWRhdGEpIHtcbiAgICAgICAgZmV0Y2hlZERvY3Muc2V0KG1ldGFkYXRhLmlkLCBtZXRhZGF0YSk7XG4gICAgICB9XG4gICAgICBjaGVja0RvbmUoKTtcbiAgICB9XG5cbiAgICBmb3IgKHZhciBpID0gMCwgbGVuID0gZG9jSW5mb3MubGVuZ3RoOyBpIDwgbGVuOyBpKyspIHtcbiAgICAgIHZhciBkb2NJbmZvID0gZG9jSW5mb3NbaV07XG4gICAgICBpZiAoZG9jSW5mby5faWQgJiYgdXRpbHMuaXNMb2NhbElkKGRvY0luZm8uX2lkKSkge1xuICAgICAgICBjaGVja0RvbmUoKTsgLy8gc2tpcCBsb2NhbCBkb2NzXG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgdmFyIHJlcSA9IGRvY1N0b3JlLmdldChkb2NJbmZvLm1ldGFkYXRhLmlkKTtcbiAgICAgIHJlcS5vbnN1Y2Nlc3MgPSByZWFkTWV0YWRhdGE7XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gY29tcGxldGUoKSB7XG4gICAgaWYgKHByZWNvbmRpdGlvbkVycm9yZWQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBDaGFuZ2VzLm5vdGlmeShhcGkuX21ldGEubmFtZSk7XG4gICAgYXBpLl9tZXRhLmRvY0NvdW50ICs9IGRvY0NvdW50RGVsdGE7XG4gICAgY2FsbGJhY2sobnVsbCwgcmVzdWx0cyk7XG4gIH1cblxuICBmdW5jdGlvbiB2ZXJpZnlBdHRhY2htZW50KGRpZ2VzdCwgY2FsbGJhY2spIHtcblxuICAgIHZhciByZXEgPSBhdHRhY2hTdG9yZS5nZXQoZGlnZXN0KTtcbiAgICByZXEub25zdWNjZXNzID0gZnVuY3Rpb24gKGUpIHtcbiAgICAgIGlmICghZS50YXJnZXQucmVzdWx0KSB7XG4gICAgICAgIHZhciBlcnIgPSBlcnJvcnMuZXJyb3IoZXJyb3JzLk1JU1NJTkdfU1RVQixcbiAgICAgICAgICAndW5rbm93biBzdHViIGF0dGFjaG1lbnQgd2l0aCBkaWdlc3QgJyArXG4gICAgICAgICAgZGlnZXN0KTtcbiAgICAgICAgZXJyLnN0YXR1cyA9IDQxMjtcbiAgICAgICAgY2FsbGJhY2soZXJyKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNhbGxiYWNrKCk7XG4gICAgICB9XG4gICAgfTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHZlcmlmeUF0dGFjaG1lbnRzKGZpbmlzaCkge1xuXG5cbiAgICB2YXIgZGlnZXN0cyA9IFtdO1xuICAgIGRvY0luZm9zLmZvckVhY2goZnVuY3Rpb24gKGRvY0luZm8pIHtcbiAgICAgIGlmIChkb2NJbmZvLmRhdGEgJiYgZG9jSW5mby5kYXRhLl9hdHRhY2htZW50cykge1xuICAgICAgICBPYmplY3Qua2V5cyhkb2NJbmZvLmRhdGEuX2F0dGFjaG1lbnRzKS5mb3JFYWNoKGZ1bmN0aW9uIChmaWxlbmFtZSkge1xuICAgICAgICAgIHZhciBhdHQgPSBkb2NJbmZvLmRhdGEuX2F0dGFjaG1lbnRzW2ZpbGVuYW1lXTtcbiAgICAgICAgICBpZiAoYXR0LnN0dWIpIHtcbiAgICAgICAgICAgIGRpZ2VzdHMucHVzaChhdHQuZGlnZXN0KTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0pO1xuICAgIGlmICghZGlnZXN0cy5sZW5ndGgpIHtcbiAgICAgIHJldHVybiBmaW5pc2goKTtcbiAgICB9XG4gICAgdmFyIG51bURvbmUgPSAwO1xuICAgIHZhciBlcnI7XG5cbiAgICBmdW5jdGlvbiBjaGVja0RvbmUoKSB7XG4gICAgICBpZiAoKytudW1Eb25lID09PSBkaWdlc3RzLmxlbmd0aCkge1xuICAgICAgICBmaW5pc2goZXJyKTtcbiAgICAgIH1cbiAgICB9XG4gICAgZGlnZXN0cy5mb3JFYWNoKGZ1bmN0aW9uIChkaWdlc3QpIHtcbiAgICAgIHZlcmlmeUF0dGFjaG1lbnQoZGlnZXN0LCBmdW5jdGlvbiAoYXR0RXJyKSB7XG4gICAgICAgIGlmIChhdHRFcnIgJiYgIWVycikge1xuICAgICAgICAgIGVyciA9IGF0dEVycjtcbiAgICAgICAgfVxuICAgICAgICBjaGVja0RvbmUoKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgZnVuY3Rpb24gd3JpdGVEb2MoZG9jSW5mbywgd2lubmluZ1Jldiwgd2lubmluZ1JldklzRGVsZXRlZCwgbmV3UmV2SXNEZWxldGVkLFxuICAgICAgICAgICAgICAgICAgICBpc1VwZGF0ZSwgZGVsdGEsIHJlc3VsdHNJZHgsIGNhbGxiYWNrKSB7XG5cbiAgICBkb2NDb3VudERlbHRhICs9IGRlbHRhO1xuXG4gICAgdmFyIGRvYyA9IGRvY0luZm8uZGF0YTtcbiAgICBkb2MuX2lkID0gZG9jSW5mby5tZXRhZGF0YS5pZDtcbiAgICBkb2MuX3JldiA9IGRvY0luZm8ubWV0YWRhdGEucmV2O1xuXG4gICAgaWYgKG5ld1JldklzRGVsZXRlZCkge1xuICAgICAgZG9jLl9kZWxldGVkID0gdHJ1ZTtcbiAgICB9XG5cbiAgICB2YXIgaGFzQXR0YWNobWVudHMgPSBkb2MuX2F0dGFjaG1lbnRzICYmXG4gICAgICBPYmplY3Qua2V5cyhkb2MuX2F0dGFjaG1lbnRzKS5sZW5ndGg7XG4gICAgaWYgKGhhc0F0dGFjaG1lbnRzKSB7XG4gICAgICByZXR1cm4gd3JpdGVBdHRhY2htZW50cyhkb2NJbmZvLCB3aW5uaW5nUmV2LCB3aW5uaW5nUmV2SXNEZWxldGVkLFxuICAgICAgICBpc1VwZGF0ZSwgcmVzdWx0c0lkeCwgY2FsbGJhY2spO1xuICAgIH1cblxuICAgIGZpbmlzaERvYyhkb2NJbmZvLCB3aW5uaW5nUmV2LCB3aW5uaW5nUmV2SXNEZWxldGVkLFxuICAgICAgaXNVcGRhdGUsIHJlc3VsdHNJZHgsIGNhbGxiYWNrKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGF1dG9Db21wYWN0KGRvY0luZm8pIHtcblxuICAgIHZhciByZXZzVG9EZWxldGUgPSB1dGlscy5jb21wYWN0VHJlZShkb2NJbmZvLm1ldGFkYXRhKTtcbiAgICBjb21wYWN0UmV2cyhyZXZzVG9EZWxldGUsIGRvY0luZm8ubWV0YWRhdGEuaWQsIHR4bik7XG4gIH1cblxuICBmdW5jdGlvbiBmaW5pc2hEb2MoZG9jSW5mbywgd2lubmluZ1Jldiwgd2lubmluZ1JldklzRGVsZXRlZCxcbiAgICAgICAgICAgICAgICAgICAgIGlzVXBkYXRlLCByZXN1bHRzSWR4LCBjYWxsYmFjaykge1xuXG4gICAgdmFyIGRvYyA9IGRvY0luZm8uZGF0YTtcbiAgICB2YXIgbWV0YWRhdGEgPSBkb2NJbmZvLm1ldGFkYXRhO1xuXG4gICAgZG9jLl9kb2NfaWRfcmV2ID0gbWV0YWRhdGEuaWQgKyAnOjonICsgbWV0YWRhdGEucmV2O1xuICAgIGRlbGV0ZSBkb2MuX2lkO1xuICAgIGRlbGV0ZSBkb2MuX3JldjtcblxuICAgIGZ1bmN0aW9uIGFmdGVyUHV0RG9jKGUpIHtcbiAgICAgIGlmIChpc1VwZGF0ZSAmJiBhcGkuYXV0b19jb21wYWN0aW9uKSB7XG4gICAgICAgIGF1dG9Db21wYWN0KGRvY0luZm8pO1xuICAgICAgfVxuICAgICAgbWV0YWRhdGEuc2VxID0gZS50YXJnZXQucmVzdWx0O1xuICAgICAgLy8gQ3VycmVudCBfcmV2IGlzIGNhbGN1bGF0ZWQgZnJvbSBfcmV2X3RyZWUgb24gcmVhZFxuICAgICAgZGVsZXRlIG1ldGFkYXRhLnJldjtcbiAgICAgIHZhciBtZXRhZGF0YVRvU3RvcmUgPSBlbmNvZGVNZXRhZGF0YShtZXRhZGF0YSwgd2lubmluZ1JldixcbiAgICAgICAgd2lubmluZ1JldklzRGVsZXRlZCk7XG4gICAgICB2YXIgbWV0YURhdGFSZXEgPSBkb2NTdG9yZS5wdXQobWV0YWRhdGFUb1N0b3JlKTtcbiAgICAgIG1ldGFEYXRhUmVxLm9uc3VjY2VzcyA9IGFmdGVyUHV0TWV0YWRhdGE7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gYWZ0ZXJQdXREb2NFcnJvcihlKSB7XG4gICAgICAvLyBDb25zdHJhaW50RXJyb3IsIG5lZWQgdG8gdXBkYXRlLCBub3QgcHV0IChzZWUgIzE2MzggZm9yIGRldGFpbHMpXG4gICAgICBlLnByZXZlbnREZWZhdWx0KCk7IC8vIGF2b2lkIHRyYW5zYWN0aW9uIGFib3J0XG4gICAgICBlLnN0b3BQcm9wYWdhdGlvbigpOyAvLyBhdm9pZCB0cmFuc2FjdGlvbiBvbmVycm9yXG4gICAgICB2YXIgaW5kZXggPSBieVNlcVN0b3JlLmluZGV4KCdfZG9jX2lkX3JldicpO1xuICAgICAgdmFyIGdldEtleVJlcSA9IGluZGV4LmdldEtleShkb2MuX2RvY19pZF9yZXYpO1xuICAgICAgZ2V0S2V5UmVxLm9uc3VjY2VzcyA9IGZ1bmN0aW9uIChlKSB7XG4gICAgICAgIHZhciBwdXRSZXEgPSBieVNlcVN0b3JlLnB1dChkb2MsIGUudGFyZ2V0LnJlc3VsdCk7XG4gICAgICAgIHB1dFJlcS5vbnN1Y2Nlc3MgPSBhZnRlclB1dERvYztcbiAgICAgIH07XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gYWZ0ZXJQdXRNZXRhZGF0YSgpIHtcbiAgICAgIHJlc3VsdHNbcmVzdWx0c0lkeF0gPSB7XG4gICAgICAgIG9rOiB0cnVlLFxuICAgICAgICBpZDogbWV0YWRhdGEuaWQsXG4gICAgICAgIHJldjogd2lubmluZ1JldlxuICAgICAgfTtcbiAgICAgIGZldGNoZWREb2NzLnNldChkb2NJbmZvLm1ldGFkYXRhLmlkLCBkb2NJbmZvLm1ldGFkYXRhKTtcbiAgICAgIGluc2VydEF0dGFjaG1lbnRNYXBwaW5ncyhkb2NJbmZvLCBtZXRhZGF0YS5zZXEsIGNhbGxiYWNrKTtcbiAgICB9XG5cbiAgICB2YXIgcHV0UmVxID0gYnlTZXFTdG9yZS5wdXQoZG9jKTtcblxuICAgIHB1dFJlcS5vbnN1Y2Nlc3MgPSBhZnRlclB1dERvYztcbiAgICBwdXRSZXEub25lcnJvciA9IGFmdGVyUHV0RG9jRXJyb3I7XG4gIH1cblxuICBmdW5jdGlvbiB3cml0ZUF0dGFjaG1lbnRzKGRvY0luZm8sIHdpbm5pbmdSZXYsIHdpbm5pbmdSZXZJc0RlbGV0ZWQsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaXNVcGRhdGUsIHJlc3VsdHNJZHgsIGNhbGxiYWNrKSB7XG5cblxuICAgIHZhciBkb2MgPSBkb2NJbmZvLmRhdGE7XG5cbiAgICB2YXIgbnVtRG9uZSA9IDA7XG4gICAgdmFyIGF0dGFjaG1lbnRzID0gT2JqZWN0LmtleXMoZG9jLl9hdHRhY2htZW50cyk7XG5cbiAgICBmdW5jdGlvbiBjb2xsZWN0UmVzdWx0cygpIHtcbiAgICAgIGlmIChudW1Eb25lID09PSBhdHRhY2htZW50cy5sZW5ndGgpIHtcbiAgICAgICAgZmluaXNoRG9jKGRvY0luZm8sIHdpbm5pbmdSZXYsIHdpbm5pbmdSZXZJc0RlbGV0ZWQsXG4gICAgICAgICAgaXNVcGRhdGUsIHJlc3VsdHNJZHgsIGNhbGxiYWNrKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBmdW5jdGlvbiBhdHRhY2htZW50U2F2ZWQoKSB7XG4gICAgICBudW1Eb25lKys7XG4gICAgICBjb2xsZWN0UmVzdWx0cygpO1xuICAgIH1cblxuICAgIGF0dGFjaG1lbnRzLmZvckVhY2goZnVuY3Rpb24gKGtleSkge1xuICAgICAgdmFyIGF0dCA9IGRvY0luZm8uZGF0YS5fYXR0YWNobWVudHNba2V5XTtcbiAgICAgIGlmICghYXR0LnN0dWIpIHtcbiAgICAgICAgdmFyIGRhdGEgPSBhdHQuZGF0YTtcbiAgICAgICAgZGVsZXRlIGF0dC5kYXRhO1xuICAgICAgICB2YXIgZGlnZXN0ID0gYXR0LmRpZ2VzdDtcbiAgICAgICAgc2F2ZUF0dGFjaG1lbnQoZGlnZXN0LCBkYXRhLCBhdHRhY2htZW50U2F2ZWQpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbnVtRG9uZSsrO1xuICAgICAgICBjb2xsZWN0UmVzdWx0cygpO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgLy8gbWFwIHNlcXMgdG8gYXR0YWNobWVudCBkaWdlc3RzLCB3aGljaFxuICAvLyB3ZSB3aWxsIG5lZWQgbGF0ZXIgZHVyaW5nIGNvbXBhY3Rpb25cbiAgZnVuY3Rpb24gaW5zZXJ0QXR0YWNobWVudE1hcHBpbmdzKGRvY0luZm8sIHNlcSwgY2FsbGJhY2spIHtcblxuICAgIHZhciBhdHRzQWRkZWQgPSAwO1xuICAgIHZhciBhdHRzVG9BZGQgPSBPYmplY3Qua2V5cyhkb2NJbmZvLmRhdGEuX2F0dGFjaG1lbnRzIHx8IHt9KTtcblxuICAgIGlmICghYXR0c1RvQWRkLmxlbmd0aCkge1xuICAgICAgcmV0dXJuIGNhbGxiYWNrKCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gY2hlY2tEb25lKCkge1xuICAgICAgaWYgKCsrYXR0c0FkZGVkID09PSBhdHRzVG9BZGQubGVuZ3RoKSB7XG4gICAgICAgIGNhbGxiYWNrKCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gYWRkKGF0dCkge1xuICAgICAgdmFyIGRpZ2VzdCA9IGRvY0luZm8uZGF0YS5fYXR0YWNobWVudHNbYXR0XS5kaWdlc3Q7XG4gICAgICB2YXIgcmVxID0gYXR0YWNoQW5kU2VxU3RvcmUucHV0KHtcbiAgICAgICAgc2VxOiBzZXEsXG4gICAgICAgIGRpZ2VzdFNlcTogZGlnZXN0ICsgJzo6JyArIHNlcVxuICAgICAgfSk7XG5cbiAgICAgIHJlcS5vbnN1Y2Nlc3MgPSBjaGVja0RvbmU7XG4gICAgICByZXEub25lcnJvciA9IGZ1bmN0aW9uIChlKSB7XG4gICAgICAgIC8vIHRoaXMgY2FsbGJhY2sgaXMgZm9yIGEgY29uc3RhaW50IGVycm9yLCB3aGljaCB3ZSBpZ25vcmVcbiAgICAgICAgLy8gYmVjYXVzZSB0aGlzIGRvY2lkL3JldiBoYXMgYWxyZWFkeSBiZWVuIGFzc29jaWF0ZWQgd2l0aFxuICAgICAgICAvLyB0aGUgZGlnZXN0IChlLmcuIHdoZW4gbmV3X2VkaXRzID09IGZhbHNlKVxuICAgICAgICBlLnByZXZlbnREZWZhdWx0KCk7IC8vIGF2b2lkIHRyYW5zYWN0aW9uIGFib3J0XG4gICAgICAgIGUuc3RvcFByb3BhZ2F0aW9uKCk7IC8vIGF2b2lkIHRyYW5zYWN0aW9uIG9uZXJyb3JcbiAgICAgICAgY2hlY2tEb25lKCk7XG4gICAgICB9O1xuICAgIH1cbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGF0dHNUb0FkZC5sZW5ndGg7IGkrKykge1xuICAgICAgYWRkKGF0dHNUb0FkZFtpXSk7IC8vIGRvIGluIHBhcmFsbGVsXG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gc2F2ZUF0dGFjaG1lbnQoZGlnZXN0LCBkYXRhLCBjYWxsYmFjaykge1xuXG5cbiAgICB2YXIgZ2V0S2V5UmVxID0gYXR0YWNoU3RvcmUuY291bnQoZGlnZXN0KTtcbiAgICBnZXRLZXlSZXEub25zdWNjZXNzID0gZnVuY3Rpb24oZSkge1xuICAgICAgdmFyIGNvdW50ID0gZS50YXJnZXQucmVzdWx0O1xuICAgICAgaWYgKGNvdW50KSB7XG4gICAgICAgIHJldHVybiBjYWxsYmFjaygpOyAvLyBhbHJlYWR5IGV4aXN0c1xuICAgICAgfVxuICAgICAgdmFyIG5ld0F0dCA9IHtcbiAgICAgICAgZGlnZXN0OiBkaWdlc3QsXG4gICAgICAgIGJvZHk6IGRhdGFcbiAgICAgIH07XG4gICAgICB2YXIgcHV0UmVxID0gYXR0YWNoU3RvcmUucHV0KG5ld0F0dCk7XG4gICAgICBwdXRSZXEub25zdWNjZXNzID0gY2FsbGJhY2s7XG4gICAgfTtcbiAgfVxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGlkYkJ1bGtEb2NzOyIsIid1c2Ugc3RyaWN0JztcblxuLy8gSW5kZXhlZERCIHJlcXVpcmVzIGEgdmVyc2lvbmVkIGRhdGFiYXNlIHN0cnVjdHVyZSwgc28gd2UgdXNlIHRoZVxuLy8gdmVyc2lvbiBoZXJlIHRvIG1hbmFnZSBtaWdyYXRpb25zLlxuZXhwb3J0cy5BREFQVEVSX1ZFUlNJT04gPSA1O1xuXG4vLyBUaGUgb2JqZWN0IHN0b3JlcyBjcmVhdGVkIGZvciBlYWNoIGRhdGFiYXNlXG4vLyBET0NfU1RPUkUgc3RvcmVzIHRoZSBkb2N1bWVudCBtZXRhIGRhdGEsIGl0cyByZXZpc2lvbiBoaXN0b3J5IGFuZCBzdGF0ZVxuLy8gS2V5ZWQgYnkgZG9jdW1lbnQgaWRcbmV4cG9ydHMuIERPQ19TVE9SRSA9ICdkb2N1bWVudC1zdG9yZSc7XG4vLyBCWV9TRVFfU1RPUkUgc3RvcmVzIGEgcGFydGljdWxhciB2ZXJzaW9uIG9mIGEgZG9jdW1lbnQsIGtleWVkIGJ5IGl0c1xuLy8gc2VxdWVuY2UgaWRcbmV4cG9ydHMuQllfU0VRX1NUT1JFID0gJ2J5LXNlcXVlbmNlJztcbi8vIFdoZXJlIHdlIHN0b3JlIGF0dGFjaG1lbnRzXG5leHBvcnRzLkFUVEFDSF9TVE9SRSA9ICdhdHRhY2gtc3RvcmUnO1xuLy8gV2hlcmUgd2Ugc3RvcmUgbWFueS10by1tYW55IHJlbGF0aW9uc1xuLy8gYmV0d2VlbiBhdHRhY2htZW50IGRpZ2VzdHMgYW5kIHNlcXNcbmV4cG9ydHMuQVRUQUNIX0FORF9TRVFfU1RPUkUgPSAnYXR0YWNoLXNlcS1zdG9yZSc7XG5cbi8vIFdoZXJlIHdlIHN0b3JlIGRhdGFiYXNlLXdpZGUgbWV0YSBkYXRhIGluIGEgc2luZ2xlIHJlY29yZFxuLy8ga2V5ZWQgYnkgaWQ6IE1FVEFfU1RPUkVcbmV4cG9ydHMuTUVUQV9TVE9SRSA9ICdtZXRhLXN0b3JlJztcbi8vIFdoZXJlIHdlIHN0b3JlIGxvY2FsIGRvY3VtZW50c1xuZXhwb3J0cy5MT0NBTF9TVE9SRSA9ICdsb2NhbC1zdG9yZSc7XG4vLyBXaGVyZSB3ZSBkZXRlY3QgYmxvYiBzdXBwb3J0XG5leHBvcnRzLkRFVEVDVF9CTE9CX1NVUFBPUlRfU1RPUkUgPSAnZGV0ZWN0LWJsb2Itc3VwcG9ydCc7IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZXJyb3JzID0gcmVxdWlyZSgnLi4vLi4vZGVwcy9lcnJvcnMnKTtcbnZhciB1dGlscyA9IHJlcXVpcmUoJy4uLy4uL3V0aWxzJyk7XG52YXIgY29uc3RhbnRzID0gcmVxdWlyZSgnLi9pZGItY29uc3RhbnRzJyk7XG5cbmZ1bmN0aW9uIHRyeUNvZGUoZnVuLCB0aGF0LCBhcmdzKSB7XG4gIHRyeSB7XG4gICAgZnVuLmFwcGx5KHRoYXQsIGFyZ3MpO1xuICB9IGNhdGNoIChlcnIpIHsgLy8gc2hvdWxkbid0IGhhcHBlblxuICAgIGlmICh0eXBlb2YgUG91Y2hEQiAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgIFBvdWNoREIuZW1pdCgnZXJyb3InLCBlcnIpO1xuICAgIH1cbiAgfVxufVxuXG5leHBvcnRzLnRhc2tRdWV1ZSA9IHtcbiAgcnVubmluZzogZmFsc2UsXG4gIHF1ZXVlOiBbXVxufTtcblxuZXhwb3J0cy5hcHBseU5leHQgPSBmdW5jdGlvbiAoKSB7XG4gIGlmIChleHBvcnRzLnRhc2tRdWV1ZS5ydW5uaW5nIHx8ICFleHBvcnRzLnRhc2tRdWV1ZS5xdWV1ZS5sZW5ndGgpIHtcbiAgICByZXR1cm47XG4gIH1cbiAgZXhwb3J0cy50YXNrUXVldWUucnVubmluZyA9IHRydWU7XG4gIHZhciBpdGVtID0gZXhwb3J0cy50YXNrUXVldWUucXVldWUuc2hpZnQoKTtcbiAgaXRlbS5hY3Rpb24oZnVuY3Rpb24gKGVyciwgcmVzKSB7XG4gICAgdHJ5Q29kZShpdGVtLmNhbGxiYWNrLCB0aGlzLCBbZXJyLCByZXNdKTtcbiAgICBleHBvcnRzLnRhc2tRdWV1ZS5ydW5uaW5nID0gZmFsc2U7XG4gICAgcHJvY2Vzcy5uZXh0VGljayhleHBvcnRzLmFwcGx5TmV4dCk7XG4gIH0pO1xufTtcblxuZXhwb3J0cy5pZGJFcnJvciA9IGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICByZXR1cm4gZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgdmFyIG1lc3NhZ2UgPSAoZXZlbnQudGFyZ2V0ICYmIGV2ZW50LnRhcmdldC5lcnJvciAmJlxuICAgICAgZXZlbnQudGFyZ2V0LmVycm9yLm5hbWUpIHx8IGV2ZW50LnRhcmdldDtcbiAgICBjYWxsYmFjayhlcnJvcnMuZXJyb3IoZXJyb3JzLklEQl9FUlJPUiwgbWVzc2FnZSwgZXZlbnQudHlwZSkpO1xuICB9O1xufTtcblxuLy8gVW5mb3J0dW5hdGVseSwgdGhlIG1ldGFkYXRhIGhhcyB0byBiZSBzdHJpbmdpZmllZFxuLy8gd2hlbiBpdCBpcyBwdXQgaW50byB0aGUgZGF0YWJhc2UsIGJlY2F1c2Ugb3RoZXJ3aXNlXG4vLyBJbmRleGVkREIgY2FuIHRocm93IGVycm9ycyBmb3IgZGVlcGx5LW5lc3RlZCBvYmplY3RzLlxuLy8gT3JpZ2luYWxseSB3ZSBqdXN0IHVzZWQgSlNPTi5wYXJzZS9KU09OLnN0cmluZ2lmeTsgbm93XG4vLyB3ZSB1c2UgdGhpcyBjdXN0b20gdnV2dXplbGEgbGlicmFyeSB0aGF0IGF2b2lkcyByZWN1cnNpb24uXG4vLyBJZiB3ZSBjb3VsZCBkbyBpdCBhbGwgb3ZlciBhZ2Fpbiwgd2UnZCBwcm9iYWJseSB1c2UgYVxuLy8gZm9ybWF0IGZvciB0aGUgcmV2aXNpb24gdHJlZXMgb3RoZXIgdGhhbiBKU09OLlxuZXhwb3J0cy5lbmNvZGVNZXRhZGF0YSA9IGZ1bmN0aW9uIChtZXRhZGF0YSwgd2lubmluZ1JldiwgZGVsZXRlZCkge1xuICByZXR1cm4ge1xuICAgIGRhdGE6IHV0aWxzLnNhZmVKc29uU3RyaW5naWZ5KG1ldGFkYXRhKSxcbiAgICB3aW5uaW5nUmV2OiB3aW5uaW5nUmV2LFxuICAgIGRlbGV0ZWRPckxvY2FsOiBkZWxldGVkID8gJzEnIDogJzAnLFxuICAgIHNlcTogbWV0YWRhdGEuc2VxLCAvLyBoaWdoZXN0IHNlcSBmb3IgdGhpcyBkb2NcbiAgICBpZDogbWV0YWRhdGEuaWRcbiAgfTtcbn07XG5cbmV4cG9ydHMuZGVjb2RlTWV0YWRhdGEgPSBmdW5jdGlvbiAoc3RvcmVkT2JqZWN0KSB7XG4gIGlmICghc3RvcmVkT2JqZWN0KSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbiAgdmFyIG1ldGFkYXRhID0gdXRpbHMuc2FmZUpzb25QYXJzZShzdG9yZWRPYmplY3QuZGF0YSk7XG4gIG1ldGFkYXRhLndpbm5pbmdSZXYgPSBzdG9yZWRPYmplY3Qud2lubmluZ1JldjtcbiAgbWV0YWRhdGEuZGVsZXRlZCA9IHN0b3JlZE9iamVjdC5kZWxldGVkT3JMb2NhbCA9PT0gJzEnO1xuICBtZXRhZGF0YS5zZXEgPSBzdG9yZWRPYmplY3Quc2VxO1xuICByZXR1cm4gbWV0YWRhdGE7XG59O1xuXG4vLyByZWFkIHRoZSBkb2MgYmFjayBvdXQgZnJvbSB0aGUgZGF0YWJhc2UuIHdlIGRvbid0IHN0b3JlIHRoZVxuLy8gX2lkIG9yIF9yZXYgYmVjYXVzZSB3ZSBhbHJlYWR5IGhhdmUgX2RvY19pZF9yZXYuXG5leHBvcnRzLmRlY29kZURvYyA9IGZ1bmN0aW9uIChkb2MpIHtcbiAgaWYgKCFkb2MpIHtcbiAgICByZXR1cm4gZG9jO1xuICB9XG4gIHZhciBpZHggPSB1dGlscy5sYXN0SW5kZXhPZihkb2MuX2RvY19pZF9yZXYsICc6Jyk7XG4gIGRvYy5faWQgPSBkb2MuX2RvY19pZF9yZXYuc3Vic3RyaW5nKDAsIGlkeCAtIDEpO1xuICBkb2MuX3JldiA9IGRvYy5fZG9jX2lkX3Jldi5zdWJzdHJpbmcoaWR4ICsgMSk7XG4gIGRlbGV0ZSBkb2MuX2RvY19pZF9yZXY7XG4gIHJldHVybiBkb2M7XG59O1xuXG4vLyBSZWFkIGEgYmxvYiBmcm9tIHRoZSBkYXRhYmFzZSwgZW5jb2RpbmcgYXMgbmVjZXNzYXJ5XG4vLyBhbmQgdHJhbnNsYXRpbmcgZnJvbSBiYXNlNjQgaWYgdGhlIElEQiBkb2Vzbid0IHN1cHBvcnRcbi8vIG5hdGl2ZSBCbG9ic1xuZXhwb3J0cy5yZWFkQmxvYkRhdGEgPSBmdW5jdGlvbiAoYm9keSwgdHlwZSwgZW5jb2RlLCBjYWxsYmFjaykge1xuICBpZiAoZW5jb2RlKSB7XG4gICAgaWYgKCFib2R5KSB7XG4gICAgICBjYWxsYmFjaygnJyk7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgYm9keSAhPT0gJ3N0cmluZycpIHsgLy8gd2UgaGF2ZSBibG9iIHN1cHBvcnRcbiAgICAgIHV0aWxzLnJlYWRBc0JpbmFyeVN0cmluZyhib2R5LCBmdW5jdGlvbiAoYmluYXJ5KSB7XG4gICAgICAgIGNhbGxiYWNrKHV0aWxzLmJ0b2EoYmluYXJ5KSk7XG4gICAgICB9KTtcbiAgICB9IGVsc2UgeyAvLyBubyBibG9iIHN1cHBvcnRcbiAgICAgIGNhbGxiYWNrKGJvZHkpO1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICBpZiAoIWJvZHkpIHtcbiAgICAgIGNhbGxiYWNrKHV0aWxzLmNyZWF0ZUJsb2IoWycnXSwge3R5cGU6IHR5cGV9KSk7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgYm9keSAhPT0gJ3N0cmluZycpIHsgLy8gd2UgaGF2ZSBibG9iIHN1cHBvcnRcbiAgICAgIGNhbGxiYWNrKGJvZHkpO1xuICAgIH0gZWxzZSB7IC8vIG5vIGJsb2Igc3VwcG9ydFxuICAgICAgYm9keSA9IHV0aWxzLmZpeEJpbmFyeShhdG9iKGJvZHkpKTtcbiAgICAgIGNhbGxiYWNrKHV0aWxzLmNyZWF0ZUJsb2IoW2JvZHldLCB7dHlwZTogdHlwZX0pKTtcbiAgICB9XG4gIH1cbn07XG5cbmV4cG9ydHMuZmV0Y2hBdHRhY2htZW50c0lmTmVjZXNzYXJ5ID0gZnVuY3Rpb24gKGRvYywgb3B0cywgdHhuLCBjYikge1xuICB2YXIgYXR0YWNobWVudHMgPSBPYmplY3Qua2V5cyhkb2MuX2F0dGFjaG1lbnRzIHx8IHt9KTtcbiAgaWYgKCFhdHRhY2htZW50cy5sZW5ndGgpIHtcbiAgICByZXR1cm4gY2IgJiYgY2IoKTtcbiAgfVxuICB2YXIgbnVtRG9uZSA9IDA7XG5cbiAgZnVuY3Rpb24gY2hlY2tEb25lKCkge1xuICAgIGlmICgrK251bURvbmUgPT09IGF0dGFjaG1lbnRzLmxlbmd0aCAmJiBjYikge1xuICAgICAgY2IoKTtcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBmZXRjaEF0dGFjaG1lbnQoZG9jLCBhdHQpIHtcbiAgICB2YXIgYXR0T2JqID0gZG9jLl9hdHRhY2htZW50c1thdHRdO1xuICAgIHZhciBkaWdlc3QgPSBhdHRPYmouZGlnZXN0O1xuICAgIHZhciByZXEgPSB0eG4ub2JqZWN0U3RvcmUoY29uc3RhbnRzLkFUVEFDSF9TVE9SRSkuZ2V0KGRpZ2VzdCk7XG4gICAgcmVxLm9uc3VjY2VzcyA9IGZ1bmN0aW9uIChlKSB7XG4gICAgICBhdHRPYmouYm9keSA9IGUudGFyZ2V0LnJlc3VsdC5ib2R5O1xuICAgICAgY2hlY2tEb25lKCk7XG4gICAgfTtcbiAgfVxuXG4gIGF0dGFjaG1lbnRzLmZvckVhY2goZnVuY3Rpb24gKGF0dCkge1xuICAgIGlmIChvcHRzLmF0dGFjaG1lbnRzICYmIG9wdHMuaW5jbHVkZV9kb2NzKSB7XG4gICAgICBmZXRjaEF0dGFjaG1lbnQoZG9jLCBhdHQpO1xuICAgIH0gZWxzZSB7XG4gICAgICBkb2MuX2F0dGFjaG1lbnRzW2F0dF0uc3R1YiA9IHRydWU7XG4gICAgICBjaGVja0RvbmUoKTtcbiAgICB9XG4gIH0pO1xufTtcblxuLy8gSURCLXNwZWNpZmljIHBvc3Rwcm9jZXNzaW5nIG5lY2Vzc2FyeSBiZWNhdXNlXG4vLyB3ZSBkb24ndCBrbm93IHdoZXRoZXIgd2Ugc3RvcmVkIGEgdHJ1ZSBCbG9iIG9yXG4vLyBhIGJhc2U2NC1lbmNvZGVkIHN0cmluZywgYW5kIGlmIGl0J3MgYSBCbG9iIGl0XG4vLyBuZWVkcyB0byBiZSByZWFkIG91dHNpZGUgb2YgdGhlIHRyYW5zYWN0aW9uIGNvbnRleHRcbmV4cG9ydHMucG9zdFByb2Nlc3NBdHRhY2htZW50cyA9IGZ1bmN0aW9uIChyZXN1bHRzKSB7XG4gIHJldHVybiB1dGlscy5Qcm9taXNlLmFsbChyZXN1bHRzLm1hcChmdW5jdGlvbiAocm93KSB7XG4gICAgaWYgKHJvdy5kb2MgJiYgcm93LmRvYy5fYXR0YWNobWVudHMpIHtcbiAgICAgIHZhciBhdHROYW1lcyA9IE9iamVjdC5rZXlzKHJvdy5kb2MuX2F0dGFjaG1lbnRzKTtcbiAgICAgIHJldHVybiB1dGlscy5Qcm9taXNlLmFsbChhdHROYW1lcy5tYXAoZnVuY3Rpb24gKGF0dCkge1xuICAgICAgICB2YXIgYXR0T2JqID0gcm93LmRvYy5fYXR0YWNobWVudHNbYXR0XTtcbiAgICAgICAgaWYgKCEoJ2JvZHknIGluIGF0dE9iaikpIHsgLy8gYWxyZWFkeSBwcm9jZXNzZWRcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgdmFyIGJvZHkgPSBhdHRPYmouYm9keTtcbiAgICAgICAgdmFyIHR5cGUgPSBhdHRPYmouY29udGVudF90eXBlO1xuICAgICAgICByZXR1cm4gbmV3IHV0aWxzLlByb21pc2UoZnVuY3Rpb24gKHJlc29sdmUpIHtcbiAgICAgICAgICBleHBvcnRzLnJlYWRCbG9iRGF0YShib2R5LCB0eXBlLCB0cnVlLCBmdW5jdGlvbiAoYmFzZTY0KSB7XG4gICAgICAgICAgICByb3cuZG9jLl9hdHRhY2htZW50c1thdHRdID0gdXRpbHMuZXh0ZW5kKFxuICAgICAgICAgICAgICB1dGlscy5waWNrKGF0dE9iaiwgWydkaWdlc3QnLCAnY29udGVudF90eXBlJ10pLFxuICAgICAgICAgICAgICB7ZGF0YTogYmFzZTY0fVxuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIHJlc29sdmUoKTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgICB9KSk7XG4gICAgfVxuICB9KSk7XG59O1xuXG5leHBvcnRzLmNvbXBhY3RSZXZzID0gZnVuY3Rpb24gKHJldnMsIGRvY0lkLCB0eG4pIHtcblxuICB2YXIgcG9zc2libHlPcnBoYW5lZERpZ2VzdHMgPSBbXTtcbiAgdmFyIHNlcVN0b3JlID0gdHhuLm9iamVjdFN0b3JlKGNvbnN0YW50cy5CWV9TRVFfU1RPUkUpO1xuICB2YXIgYXR0U3RvcmUgPSB0eG4ub2JqZWN0U3RvcmUoY29uc3RhbnRzLkFUVEFDSF9TVE9SRSk7XG4gIHZhciBhdHRBbmRTZXFTdG9yZSA9IHR4bi5vYmplY3RTdG9yZShjb25zdGFudHMuQVRUQUNIX0FORF9TRVFfU1RPUkUpO1xuICB2YXIgY291bnQgPSByZXZzLmxlbmd0aDtcblxuICBmdW5jdGlvbiBjaGVja0RvbmUoKSB7XG4gICAgY291bnQtLTtcbiAgICBpZiAoIWNvdW50KSB7IC8vIGRvbmUgcHJvY2Vzc2luZyBhbGwgcmV2c1xuICAgICAgZGVsZXRlT3JwaGFuZWRBdHRhY2htZW50cygpO1xuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIGRlbGV0ZU9ycGhhbmVkQXR0YWNobWVudHMoKSB7XG4gICAgaWYgKCFwb3NzaWJseU9ycGhhbmVkRGlnZXN0cy5sZW5ndGgpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgcG9zc2libHlPcnBoYW5lZERpZ2VzdHMuZm9yRWFjaChmdW5jdGlvbiAoZGlnZXN0KSB7XG4gICAgICB2YXIgY291bnRSZXEgPSBhdHRBbmRTZXFTdG9yZS5pbmRleCgnZGlnZXN0U2VxJykuY291bnQoXG4gICAgICAgIElEQktleVJhbmdlLmJvdW5kKFxuICAgICAgICAgIGRpZ2VzdCArICc6OicsIGRpZ2VzdCArICc6OlxcdWZmZmYnLCBmYWxzZSwgZmFsc2UpKTtcbiAgICAgIGNvdW50UmVxLm9uc3VjY2VzcyA9IGZ1bmN0aW9uIChlKSB7XG4gICAgICAgIHZhciBjb3VudCA9IGUudGFyZ2V0LnJlc3VsdDtcbiAgICAgICAgaWYgKCFjb3VudCkge1xuICAgICAgICAgIC8vIG9ycGhhbmVkXG4gICAgICAgICAgYXR0U3RvcmVbXCJkZWxldGVcIl0oZGlnZXN0KTtcbiAgICAgICAgfVxuICAgICAgfTtcbiAgICB9KTtcbiAgfVxuXG4gIHJldnMuZm9yRWFjaChmdW5jdGlvbiAocmV2KSB7XG4gICAgdmFyIGluZGV4ID0gc2VxU3RvcmUuaW5kZXgoJ19kb2NfaWRfcmV2Jyk7XG4gICAgdmFyIGtleSA9IGRvY0lkICsgXCI6OlwiICsgcmV2O1xuICAgIGluZGV4LmdldEtleShrZXkpLm9uc3VjY2VzcyA9IGZ1bmN0aW9uIChlKSB7XG4gICAgICB2YXIgc2VxID0gZS50YXJnZXQucmVzdWx0O1xuICAgICAgaWYgKHR5cGVvZiBzZXEgIT09ICdudW1iZXInKSB7XG4gICAgICAgIHJldHVybiBjaGVja0RvbmUoKTtcbiAgICAgIH1cbiAgICAgIHNlcVN0b3JlW1wiZGVsZXRlXCJdKHNlcSk7XG5cbiAgICAgIHZhciBjdXJzb3IgPSBhdHRBbmRTZXFTdG9yZS5pbmRleCgnc2VxJylcbiAgICAgICAgLm9wZW5DdXJzb3IoSURCS2V5UmFuZ2Uub25seShzZXEpKTtcblxuICAgICAgY3Vyc29yLm9uc3VjY2VzcyA9IGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgICB2YXIgY3Vyc29yID0gZXZlbnQudGFyZ2V0LnJlc3VsdDtcbiAgICAgICAgaWYgKGN1cnNvcikge1xuICAgICAgICAgIHZhciBkaWdlc3QgPSBjdXJzb3IudmFsdWUuZGlnZXN0U2VxLnNwbGl0KCc6OicpWzBdO1xuICAgICAgICAgIHBvc3NpYmx5T3JwaGFuZWREaWdlc3RzLnB1c2goZGlnZXN0KTtcbiAgICAgICAgICBhdHRBbmRTZXFTdG9yZVtcImRlbGV0ZVwiXShjdXJzb3IucHJpbWFyeUtleSk7XG4gICAgICAgICAgY3Vyc29yW1wiY29udGludWVcIl0oKTtcbiAgICAgICAgfSBlbHNlIHsgLy8gZG9uZVxuICAgICAgICAgIGNoZWNrRG9uZSgpO1xuICAgICAgICB9XG4gICAgICB9O1xuICAgIH07XG4gIH0pO1xufTtcblxuZXhwb3J0cy5vcGVuVHJhbnNhY3Rpb25TYWZlbHkgPSBmdW5jdGlvbiAoaWRiLCBzdG9yZXMsIG1vZGUpIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4ge1xuICAgICAgdHhuOiBpZGIudHJhbnNhY3Rpb24oc3RvcmVzLCBtb2RlKVxuICAgIH07XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHJldHVybiB7XG4gICAgICBlcnJvcjogZXJyXG4gICAgfTtcbiAgfVxufTsiLCIndXNlIHN0cmljdCc7XG5cbnZhciB1dGlscyA9IHJlcXVpcmUoJy4uLy4uL3V0aWxzJyk7XG52YXIgbWVyZ2UgPSByZXF1aXJlKCcuLi8uLi9tZXJnZScpO1xudmFyIGVycm9ycyA9IHJlcXVpcmUoJy4uLy4uL2RlcHMvZXJyb3JzJyk7XG52YXIgaWRiVXRpbHMgPSByZXF1aXJlKCcuL2lkYi11dGlscycpO1xudmFyIGlkYkNvbnN0YW50cyA9IHJlcXVpcmUoJy4vaWRiLWNvbnN0YW50cycpO1xudmFyIGlkYkJ1bGtEb2NzID0gcmVxdWlyZSgnLi9pZGItYnVsay1kb2NzJyk7XG52YXIgaWRiQWxsRG9jcyA9IHJlcXVpcmUoJy4vaWRiLWFsbC1kb2NzJyk7XG52YXIgY2hlY2tCbG9iU3VwcG9ydCA9IHJlcXVpcmUoJy4vaWRiLWJsb2Itc3VwcG9ydCcpO1xuXG52YXIgQURBUFRFUl9WRVJTSU9OID0gaWRiQ29uc3RhbnRzLkFEQVBURVJfVkVSU0lPTjtcbnZhciBBVFRBQ0hfQU5EX1NFUV9TVE9SRSA9IGlkYkNvbnN0YW50cy5BVFRBQ0hfQU5EX1NFUV9TVE9SRTtcbnZhciBBVFRBQ0hfU1RPUkUgPSBpZGJDb25zdGFudHMuQVRUQUNIX1NUT1JFO1xudmFyIEJZX1NFUV9TVE9SRSA9IGlkYkNvbnN0YW50cy5CWV9TRVFfU1RPUkU7XG52YXIgREVURUNUX0JMT0JfU1VQUE9SVF9TVE9SRSA9IGlkYkNvbnN0YW50cy5ERVRFQ1RfQkxPQl9TVVBQT1JUX1NUT1JFO1xudmFyIERPQ19TVE9SRSA9IGlkYkNvbnN0YW50cy5ET0NfU1RPUkU7XG52YXIgTE9DQUxfU1RPUkUgPSBpZGJDb25zdGFudHMuTE9DQUxfU1RPUkU7XG52YXIgTUVUQV9TVE9SRSA9IGlkYkNvbnN0YW50cy5NRVRBX1NUT1JFO1xuXG52YXIgYXBwbHlOZXh0ID0gaWRiVXRpbHMuYXBwbHlOZXh0O1xudmFyIGNvbXBhY3RSZXZzID0gaWRiVXRpbHMuY29tcGFjdFJldnM7XG52YXIgZGVjb2RlRG9jID0gaWRiVXRpbHMuZGVjb2RlRG9jO1xudmFyIGRlY29kZU1ldGFkYXRhID0gaWRiVXRpbHMuZGVjb2RlTWV0YWRhdGE7XG52YXIgZW5jb2RlTWV0YWRhdGEgPSBpZGJVdGlscy5lbmNvZGVNZXRhZGF0YTtcbnZhciBmZXRjaEF0dGFjaG1lbnRzSWZOZWNlc3NhcnkgPSBpZGJVdGlscy5mZXRjaEF0dGFjaG1lbnRzSWZOZWNlc3Nhcnk7XG52YXIgaWRiRXJyb3IgPSBpZGJVdGlscy5pZGJFcnJvcjtcbnZhciBwb3N0UHJvY2Vzc0F0dGFjaG1lbnRzID0gaWRiVXRpbHMucG9zdFByb2Nlc3NBdHRhY2htZW50cztcbnZhciByZWFkQmxvYkRhdGEgPSBpZGJVdGlscy5yZWFkQmxvYkRhdGE7XG52YXIgdGFza1F1ZXVlID0gaWRiVXRpbHMudGFza1F1ZXVlO1xudmFyIG9wZW5UcmFuc2FjdGlvblNhZmVseSA9IGlkYlV0aWxzLm9wZW5UcmFuc2FjdGlvblNhZmVseTtcblxudmFyIGNhY2hlZERCcyA9IHt9O1xudmFyIGJsb2JTdXBwb3J0UHJvbWlzZTtcblxuZnVuY3Rpb24gSWRiUG91Y2gob3B0cywgY2FsbGJhY2spIHtcbiAgdmFyIGFwaSA9IHRoaXM7XG5cbiAgdGFza1F1ZXVlLnF1ZXVlLnB1c2goe1xuICAgIGFjdGlvbjogZnVuY3Rpb24gKHRoaXNDYWxsYmFjaykge1xuICAgICAgaW5pdChhcGksIG9wdHMsIHRoaXNDYWxsYmFjayk7XG4gICAgfSxcbiAgICBjYWxsYmFjazogY2FsbGJhY2tcbiAgfSk7XG4gIGFwcGx5TmV4dCgpO1xufVxuXG5mdW5jdGlvbiBpbml0KGFwaSwgb3B0cywgY2FsbGJhY2spIHtcblxuICB2YXIgZGJOYW1lID0gb3B0cy5uYW1lO1xuXG4gIHZhciBpZGIgPSBudWxsO1xuICBhcGkuX21ldGEgPSBudWxsO1xuXG4gIC8vIGNhbGxlZCB3aGVuIGNyZWF0aW5nIGEgZnJlc2ggbmV3IGRhdGFiYXNlXG4gIGZ1bmN0aW9uIGNyZWF0ZVNjaGVtYShkYikge1xuICAgIHZhciBkb2NTdG9yZSA9IGRiLmNyZWF0ZU9iamVjdFN0b3JlKERPQ19TVE9SRSwge2tleVBhdGggOiAnaWQnfSk7XG4gICAgZGIuY3JlYXRlT2JqZWN0U3RvcmUoQllfU0VRX1NUT1JFLCB7YXV0b0luY3JlbWVudDogdHJ1ZX0pXG4gICAgICAuY3JlYXRlSW5kZXgoJ19kb2NfaWRfcmV2JywgJ19kb2NfaWRfcmV2Jywge3VuaXF1ZTogdHJ1ZX0pO1xuICAgIGRiLmNyZWF0ZU9iamVjdFN0b3JlKEFUVEFDSF9TVE9SRSwge2tleVBhdGg6ICdkaWdlc3QnfSk7XG4gICAgZGIuY3JlYXRlT2JqZWN0U3RvcmUoTUVUQV9TVE9SRSwge2tleVBhdGg6ICdpZCcsIGF1dG9JbmNyZW1lbnQ6IGZhbHNlfSk7XG4gICAgZGIuY3JlYXRlT2JqZWN0U3RvcmUoREVURUNUX0JMT0JfU1VQUE9SVF9TVE9SRSk7XG5cbiAgICAvLyBhZGRlZCBpbiB2MlxuICAgIGRvY1N0b3JlLmNyZWF0ZUluZGV4KCdkZWxldGVkT3JMb2NhbCcsICdkZWxldGVkT3JMb2NhbCcsIHt1bmlxdWUgOiBmYWxzZX0pO1xuXG4gICAgLy8gYWRkZWQgaW4gdjNcbiAgICBkYi5jcmVhdGVPYmplY3RTdG9yZShMT0NBTF9TVE9SRSwge2tleVBhdGg6ICdfaWQnfSk7XG5cbiAgICAvLyBhZGRlZCBpbiB2NFxuICAgIHZhciBhdHRBbmRTZXFTdG9yZSA9IGRiLmNyZWF0ZU9iamVjdFN0b3JlKEFUVEFDSF9BTkRfU0VRX1NUT1JFLFxuICAgICAge2F1dG9JbmNyZW1lbnQ6IHRydWV9KTtcbiAgICBhdHRBbmRTZXFTdG9yZS5jcmVhdGVJbmRleCgnc2VxJywgJ3NlcScpO1xuICAgIGF0dEFuZFNlcVN0b3JlLmNyZWF0ZUluZGV4KCdkaWdlc3RTZXEnLCAnZGlnZXN0U2VxJywge3VuaXF1ZTogdHJ1ZX0pO1xuICB9XG5cbiAgLy8gbWlncmF0aW9uIHRvIHZlcnNpb24gMlxuICAvLyB1bmZvcnR1bmF0ZWx5IFwiZGVsZXRlZE9yTG9jYWxcIiBpcyBhIG1pc25vbWVyIG5vdyB0aGF0IHdlIG5vIGxvbmdlclxuICAvLyBzdG9yZSBsb2NhbCBkb2NzIGluIHRoZSBtYWluIGRvYy1zdG9yZSwgYnV0IHdoYWRkeWFnb25uYWRvXG4gIGZ1bmN0aW9uIGFkZERlbGV0ZWRPckxvY2FsSW5kZXgodHhuLCBjYWxsYmFjaykge1xuICAgIHZhciBkb2NTdG9yZSA9IHR4bi5vYmplY3RTdG9yZShET0NfU1RPUkUpO1xuICAgIGRvY1N0b3JlLmNyZWF0ZUluZGV4KCdkZWxldGVkT3JMb2NhbCcsICdkZWxldGVkT3JMb2NhbCcsIHt1bmlxdWUgOiBmYWxzZX0pO1xuXG4gICAgZG9jU3RvcmUub3BlbkN1cnNvcigpLm9uc3VjY2VzcyA9IGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgdmFyIGN1cnNvciA9IGV2ZW50LnRhcmdldC5yZXN1bHQ7XG4gICAgICBpZiAoY3Vyc29yKSB7XG4gICAgICAgIHZhciBtZXRhZGF0YSA9IGN1cnNvci52YWx1ZTtcbiAgICAgICAgdmFyIGRlbGV0ZWQgPSB1dGlscy5pc0RlbGV0ZWQobWV0YWRhdGEpO1xuICAgICAgICBtZXRhZGF0YS5kZWxldGVkT3JMb2NhbCA9IGRlbGV0ZWQgPyBcIjFcIiA6IFwiMFwiO1xuICAgICAgICBkb2NTdG9yZS5wdXQobWV0YWRhdGEpO1xuICAgICAgICBjdXJzb3JbXCJjb250aW51ZVwiXSgpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY2FsbGJhY2soKTtcbiAgICAgIH1cbiAgICB9O1xuICB9XG5cbiAgLy8gbWlncmF0aW9uIHRvIHZlcnNpb24gMyAocGFydCAxKVxuICBmdW5jdGlvbiBjcmVhdGVMb2NhbFN0b3JlU2NoZW1hKGRiKSB7XG4gICAgZGIuY3JlYXRlT2JqZWN0U3RvcmUoTE9DQUxfU1RPUkUsIHtrZXlQYXRoOiAnX2lkJ30pXG4gICAgICAuY3JlYXRlSW5kZXgoJ19kb2NfaWRfcmV2JywgJ19kb2NfaWRfcmV2Jywge3VuaXF1ZTogdHJ1ZX0pO1xuICB9XG5cbiAgLy8gbWlncmF0aW9uIHRvIHZlcnNpb24gMyAocGFydCAyKVxuICBmdW5jdGlvbiBtaWdyYXRlTG9jYWxTdG9yZSh0eG4sIGNiKSB7XG4gICAgdmFyIGxvY2FsU3RvcmUgPSB0eG4ub2JqZWN0U3RvcmUoTE9DQUxfU1RPUkUpO1xuICAgIHZhciBkb2NTdG9yZSA9IHR4bi5vYmplY3RTdG9yZShET0NfU1RPUkUpO1xuICAgIHZhciBzZXFTdG9yZSA9IHR4bi5vYmplY3RTdG9yZShCWV9TRVFfU1RPUkUpO1xuXG4gICAgdmFyIGN1cnNvciA9IGRvY1N0b3JlLm9wZW5DdXJzb3IoKTtcbiAgICBjdXJzb3Iub25zdWNjZXNzID0gZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgICB2YXIgY3Vyc29yID0gZXZlbnQudGFyZ2V0LnJlc3VsdDtcbiAgICAgIGlmIChjdXJzb3IpIHtcbiAgICAgICAgdmFyIG1ldGFkYXRhID0gY3Vyc29yLnZhbHVlO1xuICAgICAgICB2YXIgZG9jSWQgPSBtZXRhZGF0YS5pZDtcbiAgICAgICAgdmFyIGxvY2FsID0gdXRpbHMuaXNMb2NhbElkKGRvY0lkKTtcbiAgICAgICAgdmFyIHJldiA9IG1lcmdlLndpbm5pbmdSZXYobWV0YWRhdGEpO1xuICAgICAgICBpZiAobG9jYWwpIHtcbiAgICAgICAgICB2YXIgZG9jSWRSZXYgPSBkb2NJZCArIFwiOjpcIiArIHJldjtcbiAgICAgICAgICAvLyByZW1vdmUgYWxsIHNlcSBlbnRyaWVzXG4gICAgICAgICAgLy8gYXNzb2NpYXRlZCB3aXRoIHRoaXMgZG9jSWRcbiAgICAgICAgICB2YXIgc3RhcnQgPSBkb2NJZCArIFwiOjpcIjtcbiAgICAgICAgICB2YXIgZW5kID0gZG9jSWQgKyBcIjo6flwiO1xuICAgICAgICAgIHZhciBpbmRleCA9IHNlcVN0b3JlLmluZGV4KCdfZG9jX2lkX3JldicpO1xuICAgICAgICAgIHZhciByYW5nZSA9IElEQktleVJhbmdlLmJvdW5kKHN0YXJ0LCBlbmQsIGZhbHNlLCBmYWxzZSk7XG4gICAgICAgICAgdmFyIHNlcUN1cnNvciA9IGluZGV4Lm9wZW5DdXJzb3IocmFuZ2UpO1xuICAgICAgICAgIHNlcUN1cnNvci5vbnN1Y2Nlc3MgPSBmdW5jdGlvbiAoZSkge1xuICAgICAgICAgICAgc2VxQ3Vyc29yID0gZS50YXJnZXQucmVzdWx0O1xuICAgICAgICAgICAgaWYgKCFzZXFDdXJzb3IpIHtcbiAgICAgICAgICAgICAgLy8gZG9uZVxuICAgICAgICAgICAgICBkb2NTdG9yZVtcImRlbGV0ZVwiXShjdXJzb3IucHJpbWFyeUtleSk7XG4gICAgICAgICAgICAgIGN1cnNvcltcImNvbnRpbnVlXCJdKCk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICB2YXIgZGF0YSA9IHNlcUN1cnNvci52YWx1ZTtcbiAgICAgICAgICAgICAgaWYgKGRhdGEuX2RvY19pZF9yZXYgPT09IGRvY0lkUmV2KSB7XG4gICAgICAgICAgICAgICAgbG9jYWxTdG9yZS5wdXQoZGF0YSk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgc2VxU3RvcmVbXCJkZWxldGVcIl0oc2VxQ3Vyc29yLnByaW1hcnlLZXkpO1xuICAgICAgICAgICAgICBzZXFDdXJzb3JbXCJjb250aW51ZVwiXSgpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH07XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY3Vyc29yW1wiY29udGludWVcIl0oKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIGlmIChjYikge1xuICAgICAgICBjYigpO1xuICAgICAgfVxuICAgIH07XG4gIH1cblxuICAvLyBtaWdyYXRpb24gdG8gdmVyc2lvbiA0IChwYXJ0IDEpXG4gIGZ1bmN0aW9uIGFkZEF0dGFjaEFuZFNlcVN0b3JlKGRiKSB7XG4gICAgdmFyIGF0dEFuZFNlcVN0b3JlID0gZGIuY3JlYXRlT2JqZWN0U3RvcmUoQVRUQUNIX0FORF9TRVFfU1RPUkUsXG4gICAgICB7YXV0b0luY3JlbWVudDogdHJ1ZX0pO1xuICAgIGF0dEFuZFNlcVN0b3JlLmNyZWF0ZUluZGV4KCdzZXEnLCAnc2VxJyk7XG4gICAgYXR0QW5kU2VxU3RvcmUuY3JlYXRlSW5kZXgoJ2RpZ2VzdFNlcScsICdkaWdlc3RTZXEnLCB7dW5pcXVlOiB0cnVlfSk7XG4gIH1cblxuICAvLyBtaWdyYXRpb24gdG8gdmVyc2lvbiA0IChwYXJ0IDIpXG4gIGZ1bmN0aW9uIG1pZ3JhdGVBdHRzQW5kU2Vxcyh0eG4sIGNhbGxiYWNrKSB7XG4gICAgdmFyIHNlcVN0b3JlID0gdHhuLm9iamVjdFN0b3JlKEJZX1NFUV9TVE9SRSk7XG4gICAgdmFyIGF0dFN0b3JlID0gdHhuLm9iamVjdFN0b3JlKEFUVEFDSF9TVE9SRSk7XG4gICAgdmFyIGF0dEFuZFNlcVN0b3JlID0gdHhuLm9iamVjdFN0b3JlKEFUVEFDSF9BTkRfU0VRX1NUT1JFKTtcblxuICAgIC8vIG5lZWQgdG8gYWN0dWFsbHkgcG9wdWxhdGUgdGhlIHRhYmxlLiB0aGlzIGlzIHRoZSBleHBlbnNpdmUgcGFydCxcbiAgICAvLyBzbyBhcyBhbiBvcHRpbWl6YXRpb24sIGNoZWNrIGZpcnN0IHRoYXQgdGhpcyBkYXRhYmFzZSBldmVuXG4gICAgLy8gY29udGFpbnMgYXR0YWNobWVudHNcbiAgICB2YXIgcmVxID0gYXR0U3RvcmUuY291bnQoKTtcbiAgICByZXEub25zdWNjZXNzID0gZnVuY3Rpb24gKGUpIHtcbiAgICAgIHZhciBjb3VudCA9IGUudGFyZ2V0LnJlc3VsdDtcbiAgICAgIGlmICghY291bnQpIHtcbiAgICAgICAgcmV0dXJuIGNhbGxiYWNrKCk7IC8vIGRvbmVcbiAgICAgIH1cblxuICAgICAgc2VxU3RvcmUub3BlbkN1cnNvcigpLm9uc3VjY2VzcyA9IGZ1bmN0aW9uIChlKSB7XG4gICAgICAgIHZhciBjdXJzb3IgPSBlLnRhcmdldC5yZXN1bHQ7XG4gICAgICAgIGlmICghY3Vyc29yKSB7XG4gICAgICAgICAgcmV0dXJuIGNhbGxiYWNrKCk7IC8vIGRvbmVcbiAgICAgICAgfVxuICAgICAgICB2YXIgZG9jID0gY3Vyc29yLnZhbHVlO1xuICAgICAgICB2YXIgc2VxID0gY3Vyc29yLnByaW1hcnlLZXk7XG4gICAgICAgIHZhciBhdHRzID0gT2JqZWN0LmtleXMoZG9jLl9hdHRhY2htZW50cyB8fCB7fSk7XG4gICAgICAgIHZhciBkaWdlc3RNYXAgPSB7fTtcbiAgICAgICAgZm9yICh2YXIgaiA9IDA7IGogPCBhdHRzLmxlbmd0aDsgaisrKSB7XG4gICAgICAgICAgdmFyIGF0dCA9IGRvYy5fYXR0YWNobWVudHNbYXR0c1tqXV07XG4gICAgICAgICAgZGlnZXN0TWFwW2F0dC5kaWdlc3RdID0gdHJ1ZTsgLy8gdW5pcSBkaWdlc3RzLCBqdXN0IGluIGNhc2VcbiAgICAgICAgfVxuICAgICAgICB2YXIgZGlnZXN0cyA9IE9iamVjdC5rZXlzKGRpZ2VzdE1hcCk7XG4gICAgICAgIGZvciAoaiA9IDA7IGogPCBkaWdlc3RzLmxlbmd0aDsgaisrKSB7XG4gICAgICAgICAgdmFyIGRpZ2VzdCA9IGRpZ2VzdHNbal07XG4gICAgICAgICAgYXR0QW5kU2VxU3RvcmUucHV0KHtcbiAgICAgICAgICAgIHNlcTogc2VxLFxuICAgICAgICAgICAgZGlnZXN0U2VxOiBkaWdlc3QgKyAnOjonICsgc2VxXG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgY3Vyc29yW1wiY29udGludWVcIl0oKTtcbiAgICAgIH07XG4gICAgfTtcbiAgfVxuXG4gIC8vIG1pZ3JhdGlvbiB0byB2ZXJzaW9uIDVcbiAgLy8gSW5zdGVhZCBvZiByZWx5aW5nIG9uIG9uLXRoZS1mbHkgbWlncmF0aW9uIG9mIG1ldGFkYXRhLFxuICAvLyB0aGlzIGJyaW5ncyB0aGUgZG9jLXN0b3JlIHRvIGl0cyBtb2Rlcm4gZm9ybTpcbiAgLy8gLSBtZXRhZGF0YS53aW5uaW5ncmV2XG4gIC8vIC0gbWV0YWRhdGEuc2VxXG4gIC8vIC0gc3RyaW5naWZ5IHRoZSBtZXRhZGF0YSB3aGVuIHN0b3JpbmcgaXRcbiAgZnVuY3Rpb24gbWlncmF0ZU1ldGFkYXRhKHR4bikge1xuXG4gICAgZnVuY3Rpb24gZGVjb2RlTWV0YWRhdGFDb21wYXQoc3RvcmVkT2JqZWN0KSB7XG4gICAgICBpZiAoIXN0b3JlZE9iamVjdC5kYXRhKSB7XG4gICAgICAgIC8vIG9sZCBmb3JtYXQsIHdoZW4gd2UgZGlkbid0IHN0b3JlIGl0IHN0cmluZ2lmaWVkXG4gICAgICAgIHN0b3JlZE9iamVjdC5kZWxldGVkID0gc3RvcmVkT2JqZWN0LmRlbGV0ZWRPckxvY2FsID09PSAnMSc7XG4gICAgICAgIHJldHVybiBzdG9yZWRPYmplY3Q7XG4gICAgICB9XG4gICAgICByZXR1cm4gZGVjb2RlTWV0YWRhdGEoc3RvcmVkT2JqZWN0KTtcbiAgICB9XG5cbiAgICAvLyBlbnN1cmUgdGhhdCBldmVyeSBtZXRhZGF0YSBoYXMgYSB3aW5uaW5nUmV2IGFuZCBzZXEsXG4gICAgLy8gd2hpY2ggd2FzIHByZXZpb3VzbHkgY3JlYXRlZCBvbi10aGUtZmx5IGJ1dCBiZXR0ZXIgdG8gbWlncmF0ZVxuICAgIHZhciBieVNlcVN0b3JlID0gdHhuLm9iamVjdFN0b3JlKEJZX1NFUV9TVE9SRSk7XG4gICAgdmFyIGRvY1N0b3JlID0gdHhuLm9iamVjdFN0b3JlKERPQ19TVE9SRSk7XG4gICAgdmFyIGN1cnNvciA9IGRvY1N0b3JlLm9wZW5DdXJzb3IoKTtcbiAgICBjdXJzb3Iub25zdWNjZXNzID0gZnVuY3Rpb24gKGUpIHtcbiAgICAgIHZhciBjdXJzb3IgPSBlLnRhcmdldC5yZXN1bHQ7XG4gICAgICBpZiAoIWN1cnNvcikge1xuICAgICAgICByZXR1cm47IC8vIGRvbmVcbiAgICAgIH1cbiAgICAgIHZhciBtZXRhZGF0YSA9IGRlY29kZU1ldGFkYXRhQ29tcGF0KGN1cnNvci52YWx1ZSk7XG5cbiAgICAgIG1ldGFkYXRhLndpbm5pbmdSZXYgPSBtZXRhZGF0YS53aW5uaW5nUmV2IHx8IG1lcmdlLndpbm5pbmdSZXYobWV0YWRhdGEpO1xuXG4gICAgICBmdW5jdGlvbiBmZXRjaE1ldGFkYXRhU2VxKCkge1xuICAgICAgICAvLyBtZXRhZGF0YS5zZXEgd2FzIGFkZGVkIHBvc3QtMy4yLjAsIHNvIGlmIGl0J3MgbWlzc2luZyxcbiAgICAgICAgLy8gd2UgbmVlZCB0byBmZXRjaCBpdCBtYW51YWxseVxuICAgICAgICB2YXIgc3RhcnQgPSBtZXRhZGF0YS5pZCArICc6Oic7XG4gICAgICAgIHZhciBlbmQgPSBtZXRhZGF0YS5pZCArICc6OlxcdWZmZmYnO1xuICAgICAgICB2YXIgcmVxID0gYnlTZXFTdG9yZS5pbmRleCgnX2RvY19pZF9yZXYnKS5vcGVuQ3Vyc29yKFxuICAgICAgICAgIElEQktleVJhbmdlLmJvdW5kKHN0YXJ0LCBlbmQpKTtcblxuICAgICAgICB2YXIgbWV0YWRhdGFTZXEgPSAwO1xuICAgICAgICByZXEub25zdWNjZXNzID0gZnVuY3Rpb24gKGUpIHtcbiAgICAgICAgICB2YXIgY3Vyc29yID0gZS50YXJnZXQucmVzdWx0O1xuICAgICAgICAgIGlmICghY3Vyc29yKSB7XG4gICAgICAgICAgICBtZXRhZGF0YS5zZXEgPSBtZXRhZGF0YVNlcTtcbiAgICAgICAgICAgIHJldHVybiBvbkdldE1ldGFkYXRhU2VxKCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHZhciBzZXEgPSBjdXJzb3IucHJpbWFyeUtleTtcbiAgICAgICAgICBpZiAoc2VxID4gbWV0YWRhdGFTZXEpIHtcbiAgICAgICAgICAgIG1ldGFkYXRhU2VxID0gc2VxO1xuICAgICAgICAgIH1cbiAgICAgICAgICBjdXJzb3JbXCJjb250aW51ZVwiXSgpO1xuICAgICAgICB9O1xuICAgICAgfVxuXG4gICAgICBmdW5jdGlvbiBvbkdldE1ldGFkYXRhU2VxKCkge1xuICAgICAgICB2YXIgbWV0YWRhdGFUb1N0b3JlID0gZW5jb2RlTWV0YWRhdGEobWV0YWRhdGEsXG4gICAgICAgICAgbWV0YWRhdGEud2lubmluZ1JldiwgbWV0YWRhdGEuZGVsZXRlZCk7XG5cbiAgICAgICAgdmFyIHJlcSA9IGRvY1N0b3JlLnB1dChtZXRhZGF0YVRvU3RvcmUpO1xuICAgICAgICByZXEub25zdWNjZXNzID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgIGN1cnNvcltcImNvbnRpbnVlXCJdKCk7XG4gICAgICAgIH07XG4gICAgICB9XG5cbiAgICAgIGlmIChtZXRhZGF0YS5zZXEpIHtcbiAgICAgICAgcmV0dXJuIG9uR2V0TWV0YWRhdGFTZXEoKTtcbiAgICAgIH1cblxuICAgICAgZmV0Y2hNZXRhZGF0YVNlcSgpO1xuICAgIH07XG5cbiAgfVxuXG4gIGFwaS50eXBlID0gZnVuY3Rpb24gKCkge1xuICAgIHJldHVybiAnaWRiJztcbiAgfTtcblxuICBhcGkuX2lkID0gdXRpbHMudG9Qcm9taXNlKGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgIGNhbGxiYWNrKG51bGwsIGFwaS5fbWV0YS5pbnN0YW5jZUlkKTtcbiAgfSk7XG5cbiAgYXBpLl9idWxrRG9jcyA9IGZ1bmN0aW9uIGlkYl9idWxrRG9jcyhyZXEsIG9wdHMsIGNhbGxiYWNrKSB7XG4gICAgaWRiQnVsa0RvY3MocmVxLCBvcHRzLCBhcGksIGlkYiwgSWRiUG91Y2guQ2hhbmdlcywgY2FsbGJhY2spO1xuICB9O1xuXG4gIC8vIEZpcnN0IHdlIGxvb2sgdXAgdGhlIG1ldGFkYXRhIGluIHRoZSBpZHMgZGF0YWJhc2UsIHRoZW4gd2UgZmV0Y2ggdGhlXG4gIC8vIGN1cnJlbnQgcmV2aXNpb24ocykgZnJvbSB0aGUgYnkgc2VxdWVuY2Ugc3RvcmVcbiAgYXBpLl9nZXQgPSBmdW5jdGlvbiBpZGJfZ2V0KGlkLCBvcHRzLCBjYWxsYmFjaykge1xuICAgIHZhciBkb2M7XG4gICAgdmFyIG1ldGFkYXRhO1xuICAgIHZhciBlcnI7XG4gICAgdmFyIHR4bjtcbiAgICBvcHRzID0gdXRpbHMuY2xvbmUob3B0cyk7XG4gICAgaWYgKG9wdHMuY3R4KSB7XG4gICAgICB0eG4gPSBvcHRzLmN0eDtcbiAgICB9IGVsc2Uge1xuICAgICAgdmFyIHR4blJlc3VsdCA9IG9wZW5UcmFuc2FjdGlvblNhZmVseShpZGIsXG4gICAgICAgIFtET0NfU1RPUkUsIEJZX1NFUV9TVE9SRSwgQVRUQUNIX1NUT1JFXSwgJ3JlYWRvbmx5Jyk7XG4gICAgICBpZiAodHhuUmVzdWx0LmVycm9yKSB7XG4gICAgICAgIHJldHVybiBjYWxsYmFjayh0eG5SZXN1bHQuZXJyb3IpO1xuICAgICAgfVxuICAgICAgdHhuID0gdHhuUmVzdWx0LnR4bjtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBmaW5pc2goKSB7XG4gICAgICBjYWxsYmFjayhlcnIsIHtkb2M6IGRvYywgbWV0YWRhdGE6IG1ldGFkYXRhLCBjdHg6IHR4bn0pO1xuICAgIH1cblxuICAgIHR4bi5vYmplY3RTdG9yZShET0NfU1RPUkUpLmdldChpZCkub25zdWNjZXNzID0gZnVuY3Rpb24gKGUpIHtcbiAgICAgIG1ldGFkYXRhID0gZGVjb2RlTWV0YWRhdGEoZS50YXJnZXQucmVzdWx0KTtcbiAgICAgIC8vIHdlIGNhbiBkZXRlcm1pbmUgdGhlIHJlc3VsdCBoZXJlIGlmOlxuICAgICAgLy8gMS4gdGhlcmUgaXMgbm8gc3VjaCBkb2N1bWVudFxuICAgICAgLy8gMi4gdGhlIGRvY3VtZW50IGlzIGRlbGV0ZWQgYW5kIHdlIGRvbid0IGFzayBhYm91dCBzcGVjaWZpYyByZXZcbiAgICAgIC8vIFdoZW4gd2UgYXNrIHdpdGggb3B0cy5yZXYgd2UgZXhwZWN0IHRoZSBhbnN3ZXIgdG8gYmUgZWl0aGVyXG4gICAgICAvLyBkb2MgKHBvc3NpYmx5IHdpdGggX2RlbGV0ZWQ9dHJ1ZSkgb3IgbWlzc2luZyBlcnJvclxuICAgICAgaWYgKCFtZXRhZGF0YSkge1xuICAgICAgICBlcnIgPSBlcnJvcnMuZXJyb3IoZXJyb3JzLk1JU1NJTkdfRE9DLCAnbWlzc2luZycpO1xuICAgICAgICByZXR1cm4gZmluaXNoKCk7XG4gICAgICB9XG4gICAgICBpZiAodXRpbHMuaXNEZWxldGVkKG1ldGFkYXRhKSAmJiAhb3B0cy5yZXYpIHtcbiAgICAgICAgZXJyID0gZXJyb3JzLmVycm9yKGVycm9ycy5NSVNTSU5HX0RPQywgXCJkZWxldGVkXCIpO1xuICAgICAgICByZXR1cm4gZmluaXNoKCk7XG4gICAgICB9XG4gICAgICB2YXIgb2JqZWN0U3RvcmUgPSB0eG4ub2JqZWN0U3RvcmUoQllfU0VRX1NUT1JFKTtcblxuICAgICAgdmFyIHJldiA9IG9wdHMucmV2IHx8IG1ldGFkYXRhLndpbm5pbmdSZXY7XG4gICAgICB2YXIga2V5ID0gbWV0YWRhdGEuaWQgKyAnOjonICsgcmV2O1xuXG4gICAgICBvYmplY3RTdG9yZS5pbmRleCgnX2RvY19pZF9yZXYnKS5nZXQoa2V5KS5vbnN1Y2Nlc3MgPSBmdW5jdGlvbiAoZSkge1xuICAgICAgICBkb2MgPSBlLnRhcmdldC5yZXN1bHQ7XG4gICAgICAgIGlmIChkb2MpIHtcbiAgICAgICAgICBkb2MgPSBkZWNvZGVEb2MoZG9jKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIWRvYykge1xuICAgICAgICAgIGVyciA9IGVycm9ycy5lcnJvcihlcnJvcnMuTUlTU0lOR19ET0MsICdtaXNzaW5nJyk7XG4gICAgICAgICAgcmV0dXJuIGZpbmlzaCgpO1xuICAgICAgICB9XG4gICAgICAgIGZpbmlzaCgpO1xuICAgICAgfTtcbiAgICB9O1xuICB9O1xuXG4gIGFwaS5fZ2V0QXR0YWNobWVudCA9IGZ1bmN0aW9uIChhdHRhY2htZW50LCBvcHRzLCBjYWxsYmFjaykge1xuICAgIHZhciB0eG47XG4gICAgb3B0cyA9IHV0aWxzLmNsb25lKG9wdHMpO1xuICAgIGlmIChvcHRzLmN0eCkge1xuICAgICAgdHhuID0gb3B0cy5jdHg7XG4gICAgfSBlbHNlIHtcbiAgICAgIHZhciB0eG5SZXN1bHQgPSBvcGVuVHJhbnNhY3Rpb25TYWZlbHkoaWRiLFxuICAgICAgICBbRE9DX1NUT1JFLCBCWV9TRVFfU1RPUkUsIEFUVEFDSF9TVE9SRV0sICdyZWFkb25seScpO1xuICAgICAgaWYgKHR4blJlc3VsdC5lcnJvcikge1xuICAgICAgICByZXR1cm4gY2FsbGJhY2sodHhuUmVzdWx0LmVycm9yKTtcbiAgICAgIH1cbiAgICAgIHR4biA9IHR4blJlc3VsdC50eG47XG4gICAgfVxuICAgIHZhciBkaWdlc3QgPSBhdHRhY2htZW50LmRpZ2VzdDtcbiAgICB2YXIgdHlwZSA9IGF0dGFjaG1lbnQuY29udGVudF90eXBlO1xuXG4gICAgdHhuLm9iamVjdFN0b3JlKEFUVEFDSF9TVE9SRSkuZ2V0KGRpZ2VzdCkub25zdWNjZXNzID0gZnVuY3Rpb24gKGUpIHtcbiAgICAgIHZhciBib2R5ID0gZS50YXJnZXQucmVzdWx0LmJvZHk7XG4gICAgICByZWFkQmxvYkRhdGEoYm9keSwgdHlwZSwgb3B0cy5lbmNvZGUsIGZ1bmN0aW9uIChibG9iRGF0YSkge1xuICAgICAgICBjYWxsYmFjayhudWxsLCBibG9iRGF0YSk7XG4gICAgICB9KTtcbiAgICB9O1xuICB9O1xuXG4gIGFwaS5faW5mbyA9IGZ1bmN0aW9uIGlkYl9pbmZvKGNhbGxiYWNrKSB7XG5cbiAgICBpZiAoaWRiID09PSBudWxsIHx8ICFjYWNoZWREQnNbZGJOYW1lXSkge1xuICAgICAgdmFyIGVycm9yID0gbmV3IEVycm9yKCdkYiBpc25cXCd0IG9wZW4nKTtcbiAgICAgIGVycm9yLmlkID0gJ2lkYk51bGwnO1xuICAgICAgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICB9XG4gICAgdmFyIHVwZGF0ZVNlcTtcbiAgICB2YXIgZG9jQ291bnQ7XG5cbiAgICB2YXIgdHhuUmVzdWx0ID0gb3BlblRyYW5zYWN0aW9uU2FmZWx5KGlkYiwgW0JZX1NFUV9TVE9SRV0sICdyZWFkb25seScpO1xuICAgIGlmICh0eG5SZXN1bHQuZXJyb3IpIHtcbiAgICAgIHJldHVybiBjYWxsYmFjayh0eG5SZXN1bHQuZXJyb3IpO1xuICAgIH1cbiAgICB2YXIgdHhuID0gdHhuUmVzdWx0LnR4bjtcbiAgICB2YXIgY3Vyc29yID0gdHhuLm9iamVjdFN0b3JlKEJZX1NFUV9TVE9SRSkub3BlbkN1cnNvcihudWxsLCAncHJldicpO1xuICAgIGN1cnNvci5vbnN1Y2Nlc3MgPSBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICAgIHZhciBjdXJzb3IgPSBldmVudC50YXJnZXQucmVzdWx0O1xuICAgICAgdXBkYXRlU2VxID0gY3Vyc29yID8gY3Vyc29yLmtleSA6IDA7XG4gICAgICAvLyBjb3VudCB3aXRoaW4gdGhlIHNhbWUgdHhuIGZvciBjb25zaXN0ZW5jeVxuICAgICAgZG9jQ291bnQgPSBhcGkuX21ldGEuZG9jQ291bnQ7XG4gICAgfTtcblxuICAgIHR4bi5vbmNvbXBsZXRlID0gZnVuY3Rpb24gKCkge1xuICAgICAgY2FsbGJhY2sobnVsbCwge1xuICAgICAgICBkb2NfY291bnQ6IGRvY0NvdW50LFxuICAgICAgICB1cGRhdGVfc2VxOiB1cGRhdGVTZXEsXG4gICAgICAgIC8vIGZvciBkZWJ1Z2dpbmdcbiAgICAgICAgaWRiX2F0dGFjaG1lbnRfZm9ybWF0OiAoYXBpLl9tZXRhLmJsb2JTdXBwb3J0ID8gJ2JpbmFyeScgOiAnYmFzZTY0JylcbiAgICAgIH0pO1xuICAgIH07XG4gIH07XG5cbiAgYXBpLl9hbGxEb2NzID0gZnVuY3Rpb24gaWRiX2FsbERvY3Mob3B0cywgY2FsbGJhY2spIHtcbiAgICBpZGJBbGxEb2NzKG9wdHMsIGFwaSwgaWRiLCBjYWxsYmFjayk7XG4gIH07XG5cbiAgYXBpLl9jaGFuZ2VzID0gZnVuY3Rpb24gKG9wdHMpIHtcbiAgICBvcHRzID0gdXRpbHMuY2xvbmUob3B0cyk7XG5cbiAgICBpZiAob3B0cy5jb250aW51b3VzKSB7XG4gICAgICB2YXIgaWQgPSBkYk5hbWUgKyAnOicgKyB1dGlscy51dWlkKCk7XG4gICAgICBJZGJQb3VjaC5DaGFuZ2VzLmFkZExpc3RlbmVyKGRiTmFtZSwgaWQsIGFwaSwgb3B0cyk7XG4gICAgICBJZGJQb3VjaC5DaGFuZ2VzLm5vdGlmeShkYk5hbWUpO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgY2FuY2VsOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgSWRiUG91Y2guQ2hhbmdlcy5yZW1vdmVMaXN0ZW5lcihkYk5hbWUsIGlkKTtcbiAgICAgICAgfVxuICAgICAgfTtcbiAgICB9XG5cbiAgICB2YXIgZG9jSWRzID0gb3B0cy5kb2NfaWRzICYmIG5ldyB1dGlscy5TZXQob3B0cy5kb2NfaWRzKTtcbiAgICB2YXIgZGVzY2VuZGluZyA9IG9wdHMuZGVzY2VuZGluZyA/ICdwcmV2JyA6IG51bGw7XG5cbiAgICBvcHRzLnNpbmNlID0gb3B0cy5zaW5jZSB8fCAwO1xuICAgIHZhciBsYXN0U2VxID0gb3B0cy5zaW5jZTtcblxuICAgIHZhciBsaW1pdCA9ICdsaW1pdCcgaW4gb3B0cyA/IG9wdHMubGltaXQgOiAtMTtcbiAgICBpZiAobGltaXQgPT09IDApIHtcbiAgICAgIGxpbWl0ID0gMTsgLy8gcGVyIENvdWNoREIgX2NoYW5nZXMgc3BlY1xuICAgIH1cbiAgICB2YXIgcmV0dXJuRG9jcztcbiAgICBpZiAoJ3JldHVybkRvY3MnIGluIG9wdHMpIHtcbiAgICAgIHJldHVybkRvY3MgPSBvcHRzLnJldHVybkRvY3M7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybkRvY3MgPSB0cnVlO1xuICAgIH1cblxuICAgIHZhciByZXN1bHRzID0gW107XG4gICAgdmFyIG51bVJlc3VsdHMgPSAwO1xuICAgIHZhciBmaWx0ZXIgPSB1dGlscy5maWx0ZXJDaGFuZ2Uob3B0cyk7XG4gICAgdmFyIGRvY0lkc1RvTWV0YWRhdGEgPSBuZXcgdXRpbHMuTWFwKCk7XG5cbiAgICB2YXIgdHhuO1xuICAgIHZhciBieVNlcVN0b3JlO1xuICAgIHZhciBkb2NTdG9yZTtcblxuICAgIGZ1bmN0aW9uIG9uR2V0Q3Vyc29yKGN1cnNvcikge1xuXG4gICAgICB2YXIgZG9jID0gZGVjb2RlRG9jKGN1cnNvci52YWx1ZSk7XG4gICAgICB2YXIgc2VxID0gY3Vyc29yLmtleTtcblxuICAgICAgaWYgKGRvY0lkcyAmJiAhZG9jSWRzLmhhcyhkb2MuX2lkKSkge1xuICAgICAgICByZXR1cm4gY3Vyc29yW1wiY29udGludWVcIl0oKTtcbiAgICAgIH1cblxuICAgICAgdmFyIG1ldGFkYXRhO1xuXG4gICAgICBmdW5jdGlvbiBvbkdldE1ldGFkYXRhKCkge1xuICAgICAgICBpZiAobWV0YWRhdGEuc2VxICE9PSBzZXEpIHtcbiAgICAgICAgICAvLyBzb21lIG90aGVyIHNlcSBpcyBsYXRlclxuICAgICAgICAgIHJldHVybiBjdXJzb3JbXCJjb250aW51ZVwiXSgpO1xuICAgICAgICB9XG5cbiAgICAgICAgbGFzdFNlcSA9IHNlcTtcblxuICAgICAgICBpZiAobWV0YWRhdGEud2lubmluZ1JldiA9PT0gZG9jLl9yZXYpIHtcbiAgICAgICAgICByZXR1cm4gb25HZXRXaW5uaW5nRG9jKGRvYyk7XG4gICAgICAgIH1cblxuICAgICAgICBmZXRjaFdpbm5pbmdEb2MoKTtcbiAgICAgIH1cblxuICAgICAgZnVuY3Rpb24gZmV0Y2hXaW5uaW5nRG9jKCkge1xuICAgICAgICB2YXIgZG9jSWRSZXYgPSBkb2MuX2lkICsgJzo6JyArIG1ldGFkYXRhLndpbm5pbmdSZXY7XG4gICAgICAgIHZhciByZXEgPSBieVNlcVN0b3JlLmluZGV4KCdfZG9jX2lkX3JldicpLm9wZW5DdXJzb3IoXG4gICAgICAgICAgSURCS2V5UmFuZ2UuYm91bmQoZG9jSWRSZXYsIGRvY0lkUmV2ICsgJ1xcdWZmZmYnKSk7XG4gICAgICAgIHJlcS5vbnN1Y2Nlc3MgPSBmdW5jdGlvbiAoZSkge1xuICAgICAgICAgIG9uR2V0V2lubmluZ0RvYyhkZWNvZGVEb2MoZS50YXJnZXQucmVzdWx0LnZhbHVlKSk7XG4gICAgICAgIH07XG4gICAgICB9XG5cbiAgICAgIGZ1bmN0aW9uIG9uR2V0V2lubmluZ0RvYyh3aW5uaW5nRG9jKSB7XG5cbiAgICAgICAgdmFyIGNoYW5nZSA9IG9wdHMucHJvY2Vzc0NoYW5nZSh3aW5uaW5nRG9jLCBtZXRhZGF0YSwgb3B0cyk7XG4gICAgICAgIGNoYW5nZS5zZXEgPSBtZXRhZGF0YS5zZXE7XG4gICAgICAgIGlmIChmaWx0ZXIoY2hhbmdlKSkge1xuICAgICAgICAgIG51bVJlc3VsdHMrKztcbiAgICAgICAgICBpZiAocmV0dXJuRG9jcykge1xuICAgICAgICAgICAgcmVzdWx0cy5wdXNoKGNoYW5nZSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIC8vIHByb2Nlc3MgdGhlIGF0dGFjaG1lbnQgaW1tZWRpYXRlbHlcbiAgICAgICAgICAvLyBmb3IgdGhlIGJlbmVmaXQgb2YgbGl2ZSBsaXN0ZW5lcnNcbiAgICAgICAgICBpZiAob3B0cy5hdHRhY2htZW50cyAmJiBvcHRzLmluY2x1ZGVfZG9jcykge1xuICAgICAgICAgICAgZmV0Y2hBdHRhY2htZW50c0lmTmVjZXNzYXJ5KHdpbm5pbmdEb2MsIG9wdHMsIHR4biwgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICBwb3N0UHJvY2Vzc0F0dGFjaG1lbnRzKFtjaGFuZ2VdKS50aGVuKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICBvcHRzLm9uQ2hhbmdlKGNoYW5nZSk7XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIG9wdHMub25DaGFuZ2UoY2hhbmdlKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgaWYgKG51bVJlc3VsdHMgIT09IGxpbWl0KSB7XG4gICAgICAgICAgY3Vyc29yW1wiY29udGludWVcIl0oKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBtZXRhZGF0YSA9IGRvY0lkc1RvTWV0YWRhdGEuZ2V0KGRvYy5faWQpO1xuICAgICAgaWYgKG1ldGFkYXRhKSB7IC8vIGNhY2hlZFxuICAgICAgICByZXR1cm4gb25HZXRNZXRhZGF0YSgpO1xuICAgICAgfVxuICAgICAgLy8gbWV0YWRhdGEgbm90IGNhY2hlZCwgaGF2ZSB0byBnbyBmZXRjaCBpdFxuICAgICAgZG9jU3RvcmUuZ2V0KGRvYy5faWQpLm9uc3VjY2VzcyA9IGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgICBtZXRhZGF0YSA9IGRlY29kZU1ldGFkYXRhKGV2ZW50LnRhcmdldC5yZXN1bHQpO1xuICAgICAgICBkb2NJZHNUb01ldGFkYXRhLnNldChkb2MuX2lkLCBtZXRhZGF0YSk7XG4gICAgICAgIG9uR2V0TWV0YWRhdGEoKTtcbiAgICAgIH07XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gb25zdWNjZXNzKGV2ZW50KSB7XG4gICAgICB2YXIgY3Vyc29yID0gZXZlbnQudGFyZ2V0LnJlc3VsdDtcblxuICAgICAgaWYgKCFjdXJzb3IpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgb25HZXRDdXJzb3IoY3Vyc29yKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBmZXRjaENoYW5nZXMoKSB7XG4gICAgICB2YXIgb2JqZWN0U3RvcmVzID0gW0RPQ19TVE9SRSwgQllfU0VRX1NUT1JFXTtcbiAgICAgIGlmIChvcHRzLmF0dGFjaG1lbnRzKSB7XG4gICAgICAgIG9iamVjdFN0b3Jlcy5wdXNoKEFUVEFDSF9TVE9SRSk7XG4gICAgICB9XG4gICAgICB2YXIgdHhuUmVzdWx0ID0gb3BlblRyYW5zYWN0aW9uU2FmZWx5KGlkYiwgb2JqZWN0U3RvcmVzLCAncmVhZG9ubHknKTtcbiAgICAgIGlmICh0eG5SZXN1bHQuZXJyb3IpIHtcbiAgICAgICAgcmV0dXJuIG9wdHMuY29tcGxldGUodHhuUmVzdWx0LmVycm9yKTtcbiAgICAgIH1cbiAgICAgIHR4biA9IHR4blJlc3VsdC50eG47XG4gICAgICB0eG4ub25lcnJvciA9IGlkYkVycm9yKG9wdHMuY29tcGxldGUpO1xuICAgICAgdHhuLm9uY29tcGxldGUgPSBvblR4bkNvbXBsZXRlO1xuXG4gICAgICBieVNlcVN0b3JlID0gdHhuLm9iamVjdFN0b3JlKEJZX1NFUV9TVE9SRSk7XG4gICAgICBkb2NTdG9yZSA9IHR4bi5vYmplY3RTdG9yZShET0NfU1RPUkUpO1xuXG4gICAgICB2YXIgcmVxO1xuXG4gICAgICBpZiAoZGVzY2VuZGluZykge1xuICAgICAgICByZXEgPSBieVNlcVN0b3JlLm9wZW5DdXJzb3IoXG5cbiAgICAgICAgICBudWxsLCBkZXNjZW5kaW5nKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJlcSA9IGJ5U2VxU3RvcmUub3BlbkN1cnNvcihcbiAgICAgICAgICBJREJLZXlSYW5nZS5sb3dlckJvdW5kKG9wdHMuc2luY2UsIHRydWUpKTtcbiAgICAgIH1cblxuICAgICAgcmVxLm9uc3VjY2VzcyA9IG9uc3VjY2VzcztcbiAgICB9XG5cbiAgICBmZXRjaENoYW5nZXMoKTtcblxuICAgIGZ1bmN0aW9uIG9uVHhuQ29tcGxldGUoKSB7XG5cbiAgICAgIGZ1bmN0aW9uIGZpbmlzaCgpIHtcbiAgICAgICAgb3B0cy5jb21wbGV0ZShudWxsLCB7XG4gICAgICAgICAgcmVzdWx0czogcmVzdWx0cyxcbiAgICAgICAgICBsYXN0X3NlcTogbGFzdFNlcVxuICAgICAgICB9KTtcbiAgICAgIH1cblxuICAgICAgaWYgKCFvcHRzLmNvbnRpbnVvdXMgJiYgb3B0cy5hdHRhY2htZW50cykge1xuICAgICAgICAvLyBjYW5ub3QgZ3VhcmFudGVlIHRoYXQgcG9zdFByb2Nlc3Npbmcgd2FzIGFscmVhZHkgZG9uZSxcbiAgICAgICAgLy8gc28gZG8gaXQgYWdhaW5cbiAgICAgICAgcG9zdFByb2Nlc3NBdHRhY2htZW50cyhyZXN1bHRzKS50aGVuKGZpbmlzaCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBmaW5pc2goKTtcbiAgICAgIH1cbiAgICB9XG4gIH07XG5cbiAgYXBpLl9jbG9zZSA9IGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgIGlmIChpZGIgPT09IG51bGwpIHtcbiAgICAgIHJldHVybiBjYWxsYmFjayhlcnJvcnMuZXJyb3IoZXJyb3JzLk5PVF9PUEVOKSk7XG4gICAgfVxuXG4gICAgLy8gaHR0cHM6Ly9kZXZlbG9wZXIubW96aWxsYS5vcmcvZW4tVVMvZG9jcy9JbmRleGVkREIvSURCRGF0YWJhc2UjY2xvc2VcbiAgICAvLyBcIlJldHVybnMgaW1tZWRpYXRlbHkgYW5kIGNsb3NlcyB0aGUgY29ubmVjdGlvbiBpbiBhIHNlcGFyYXRlIHRocmVhZC4uLlwiXG4gICAgaWRiLmNsb3NlKCk7XG4gICAgZGVsZXRlIGNhY2hlZERCc1tkYk5hbWVdO1xuICAgIGlkYiA9IG51bGw7XG4gICAgY2FsbGJhY2soKTtcbiAgfTtcblxuICBhcGkuX2dldFJldmlzaW9uVHJlZSA9IGZ1bmN0aW9uIChkb2NJZCwgY2FsbGJhY2spIHtcbiAgICB2YXIgdHhuUmVzdWx0ID0gb3BlblRyYW5zYWN0aW9uU2FmZWx5KGlkYiwgW0RPQ19TVE9SRV0sICdyZWFkb25seScpO1xuICAgIGlmICh0eG5SZXN1bHQuZXJyb3IpIHtcbiAgICAgIHJldHVybiBjYWxsYmFjayh0eG5SZXN1bHQuZXJyb3IpO1xuICAgIH1cbiAgICB2YXIgdHhuID0gdHhuUmVzdWx0LnR4bjtcbiAgICB2YXIgcmVxID0gdHhuLm9iamVjdFN0b3JlKERPQ19TVE9SRSkuZ2V0KGRvY0lkKTtcbiAgICByZXEub25zdWNjZXNzID0gZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgICB2YXIgZG9jID0gZGVjb2RlTWV0YWRhdGEoZXZlbnQudGFyZ2V0LnJlc3VsdCk7XG4gICAgICBpZiAoIWRvYykge1xuICAgICAgICBjYWxsYmFjayhlcnJvcnMuZXJyb3IoZXJyb3JzLk1JU1NJTkdfRE9DKSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjYWxsYmFjayhudWxsLCBkb2MucmV2X3RyZWUpO1xuICAgICAgfVxuICAgIH07XG4gIH07XG5cbiAgLy8gVGhpcyBmdW5jdGlvbiByZW1vdmVzIHJldmlzaW9ucyBvZiBkb2N1bWVudCBkb2NJZFxuICAvLyB3aGljaCBhcmUgbGlzdGVkIGluIHJldnMgYW5kIHNldHMgdGhpcyBkb2N1bWVudFxuICAvLyByZXZpc2lvbiB0byB0byByZXZfdHJlZVxuICBhcGkuX2RvQ29tcGFjdGlvbiA9IGZ1bmN0aW9uIChkb2NJZCwgcmV2cywgY2FsbGJhY2spIHtcbiAgICB2YXIgc3RvcmVzID0gW1xuICAgICAgRE9DX1NUT1JFLFxuICAgICAgQllfU0VRX1NUT1JFLFxuICAgICAgQVRUQUNIX1NUT1JFLFxuICAgICAgQVRUQUNIX0FORF9TRVFfU1RPUkVcbiAgICBdO1xuICAgIHZhciB0eG5SZXN1bHQgPSBvcGVuVHJhbnNhY3Rpb25TYWZlbHkoaWRiLCBzdG9yZXMsICdyZWFkd3JpdGUnKTtcbiAgICBpZiAodHhuUmVzdWx0LmVycm9yKSB7XG4gICAgICByZXR1cm4gY2FsbGJhY2sodHhuUmVzdWx0LmVycm9yKTtcbiAgICB9XG4gICAgdmFyIHR4biA9IHR4blJlc3VsdC50eG47XG5cbiAgICB2YXIgZG9jU3RvcmUgPSB0eG4ub2JqZWN0U3RvcmUoRE9DX1NUT1JFKTtcblxuICAgIGRvY1N0b3JlLmdldChkb2NJZCkub25zdWNjZXNzID0gZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgICB2YXIgbWV0YWRhdGEgPSBkZWNvZGVNZXRhZGF0YShldmVudC50YXJnZXQucmVzdWx0KTtcbiAgICAgIG1lcmdlLnRyYXZlcnNlUmV2VHJlZShtZXRhZGF0YS5yZXZfdHJlZSwgZnVuY3Rpb24gKGlzTGVhZiwgcG9zLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV2SGFzaCwgY3R4LCBvcHRzKSB7XG4gICAgICAgIHZhciByZXYgPSBwb3MgKyAnLScgKyByZXZIYXNoO1xuICAgICAgICBpZiAocmV2cy5pbmRleE9mKHJldikgIT09IC0xKSB7XG4gICAgICAgICAgb3B0cy5zdGF0dXMgPSAnbWlzc2luZyc7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgY29tcGFjdFJldnMocmV2cywgZG9jSWQsIHR4bik7XG4gICAgICB2YXIgd2lubmluZ1JldiA9IG1ldGFkYXRhLndpbm5pbmdSZXY7XG4gICAgICB2YXIgZGVsZXRlZCA9IG1ldGFkYXRhLmRlbGV0ZWQ7XG4gICAgICB0eG4ub2JqZWN0U3RvcmUoRE9DX1NUT1JFKS5wdXQoXG4gICAgICAgIGVuY29kZU1ldGFkYXRhKG1ldGFkYXRhLCB3aW5uaW5nUmV2LCBkZWxldGVkKSk7XG4gICAgfTtcbiAgICB0eG4ub25lcnJvciA9IGlkYkVycm9yKGNhbGxiYWNrKTtcbiAgICB0eG4ub25jb21wbGV0ZSA9IGZ1bmN0aW9uICgpIHtcbiAgICAgIHV0aWxzLmNhbGwoY2FsbGJhY2spO1xuICAgIH07XG4gIH07XG5cblxuICBhcGkuX2dldExvY2FsID0gZnVuY3Rpb24gKGlkLCBjYWxsYmFjaykge1xuICAgIHZhciB0eG5SZXN1bHQgPSBvcGVuVHJhbnNhY3Rpb25TYWZlbHkoaWRiLCBbTE9DQUxfU1RPUkVdLCAncmVhZG9ubHknKTtcbiAgICBpZiAodHhuUmVzdWx0LmVycm9yKSB7XG4gICAgICByZXR1cm4gY2FsbGJhY2sodHhuUmVzdWx0LmVycm9yKTtcbiAgICB9XG4gICAgdmFyIHR4ID0gdHhuUmVzdWx0LnR4bjtcbiAgICB2YXIgcmVxID0gdHgub2JqZWN0U3RvcmUoTE9DQUxfU1RPUkUpLmdldChpZCk7XG5cbiAgICByZXEub25lcnJvciA9IGlkYkVycm9yKGNhbGxiYWNrKTtcbiAgICByZXEub25zdWNjZXNzID0gZnVuY3Rpb24gKGUpIHtcbiAgICAgIHZhciBkb2MgPSBlLnRhcmdldC5yZXN1bHQ7XG4gICAgICBpZiAoIWRvYykge1xuICAgICAgICBjYWxsYmFjayhlcnJvcnMuZXJyb3IoZXJyb3JzLk1JU1NJTkdfRE9DKSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBkZWxldGUgZG9jWydfZG9jX2lkX3JldiddOyAvLyBmb3IgYmFja3dhcmRzIGNvbXBhdFxuICAgICAgICBjYWxsYmFjayhudWxsLCBkb2MpO1xuICAgICAgfVxuICAgIH07XG4gIH07XG5cbiAgYXBpLl9wdXRMb2NhbCA9IGZ1bmN0aW9uIChkb2MsIG9wdHMsIGNhbGxiYWNrKSB7XG4gICAgaWYgKHR5cGVvZiBvcHRzID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICBjYWxsYmFjayA9IG9wdHM7XG4gICAgICBvcHRzID0ge307XG4gICAgfVxuICAgIGRlbGV0ZSBkb2MuX3JldmlzaW9uczsgLy8gaWdub3JlIHRoaXMsIHRydXN0IHRoZSByZXZcbiAgICB2YXIgb2xkUmV2ID0gZG9jLl9yZXY7XG4gICAgdmFyIGlkID0gZG9jLl9pZDtcbiAgICBpZiAoIW9sZFJldikge1xuICAgICAgZG9jLl9yZXYgPSAnMC0xJztcbiAgICB9IGVsc2Uge1xuICAgICAgZG9jLl9yZXYgPSAnMC0nICsgKHBhcnNlSW50KG9sZFJldi5zcGxpdCgnLScpWzFdLCAxMCkgKyAxKTtcbiAgICB9XG5cbiAgICB2YXIgdHggPSBvcHRzLmN0eDtcbiAgICB2YXIgcmV0O1xuICAgIGlmICghdHgpIHtcbiAgICAgIHZhciB0eG5SZXN1bHQgPSBvcGVuVHJhbnNhY3Rpb25TYWZlbHkoaWRiLCBbTE9DQUxfU1RPUkVdLCAncmVhZHdyaXRlJyk7XG4gICAgICBpZiAodHhuUmVzdWx0LmVycm9yKSB7XG4gICAgICAgIHJldHVybiBjYWxsYmFjayh0eG5SZXN1bHQuZXJyb3IpO1xuICAgICAgfVxuICAgICAgdHggPSB0eG5SZXN1bHQudHhuO1xuICAgICAgdHgub25lcnJvciA9IGlkYkVycm9yKGNhbGxiYWNrKTtcbiAgICAgIHR4Lm9uY29tcGxldGUgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIGlmIChyZXQpIHtcbiAgICAgICAgICBjYWxsYmFjayhudWxsLCByZXQpO1xuICAgICAgICB9XG4gICAgICB9O1xuICAgIH1cblxuICAgIHZhciBvU3RvcmUgPSB0eC5vYmplY3RTdG9yZShMT0NBTF9TVE9SRSk7XG4gICAgdmFyIHJlcTtcbiAgICBpZiAob2xkUmV2KSB7XG4gICAgICByZXEgPSBvU3RvcmUuZ2V0KGlkKTtcbiAgICAgIHJlcS5vbnN1Y2Nlc3MgPSBmdW5jdGlvbiAoZSkge1xuICAgICAgICB2YXIgb2xkRG9jID0gZS50YXJnZXQucmVzdWx0O1xuICAgICAgICBpZiAoIW9sZERvYyB8fCBvbGREb2MuX3JldiAhPT0gb2xkUmV2KSB7XG4gICAgICAgICAgY2FsbGJhY2soZXJyb3JzLmVycm9yKGVycm9ycy5SRVZfQ09ORkxJQ1QpKTtcbiAgICAgICAgfSBlbHNlIHsgLy8gdXBkYXRlXG4gICAgICAgICAgdmFyIHJlcSA9IG9TdG9yZS5wdXQoZG9jKTtcbiAgICAgICAgICByZXEub25zdWNjZXNzID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgcmV0ID0ge29rOiB0cnVlLCBpZDogZG9jLl9pZCwgcmV2OiBkb2MuX3Jldn07XG4gICAgICAgICAgICBpZiAob3B0cy5jdHgpIHsgLy8gcmV0dXJuIGltbWVkaWF0ZWx5XG4gICAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIHJldCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgfTtcbiAgICB9IGVsc2UgeyAvLyBuZXcgZG9jXG4gICAgICByZXEgPSBvU3RvcmUuYWRkKGRvYyk7XG4gICAgICByZXEub25lcnJvciA9IGZ1bmN0aW9uIChlKSB7XG4gICAgICAgIC8vIGNvbnN0cmFpbnQgZXJyb3IsIGFscmVhZHkgZXhpc3RzXG4gICAgICAgIGNhbGxiYWNrKGVycm9ycy5lcnJvcihlcnJvcnMuUkVWX0NPTkZMSUNUKSk7XG4gICAgICAgIGUucHJldmVudERlZmF1bHQoKTsgLy8gYXZvaWQgdHJhbnNhY3Rpb24gYWJvcnRcbiAgICAgICAgZS5zdG9wUHJvcGFnYXRpb24oKTsgLy8gYXZvaWQgdHJhbnNhY3Rpb24gb25lcnJvclxuICAgICAgfTtcbiAgICAgIHJlcS5vbnN1Y2Nlc3MgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHJldCA9IHtvazogdHJ1ZSwgaWQ6IGRvYy5faWQsIHJldjogZG9jLl9yZXZ9O1xuICAgICAgICBpZiAob3B0cy5jdHgpIHsgLy8gcmV0dXJuIGltbWVkaWF0ZWx5XG4gICAgICAgICAgY2FsbGJhY2sobnVsbCwgcmV0KTtcbiAgICAgICAgfVxuICAgICAgfTtcbiAgICB9XG4gIH07XG5cbiAgYXBpLl9yZW1vdmVMb2NhbCA9IGZ1bmN0aW9uIChkb2MsIGNhbGxiYWNrKSB7XG4gICAgdmFyIHR4blJlc3VsdCA9IG9wZW5UcmFuc2FjdGlvblNhZmVseShpZGIsIFtMT0NBTF9TVE9SRV0sICdyZWFkd3JpdGUnKTtcbiAgICBpZiAodHhuUmVzdWx0LmVycm9yKSB7XG4gICAgICByZXR1cm4gY2FsbGJhY2sodHhuUmVzdWx0LmVycm9yKTtcbiAgICB9XG4gICAgdmFyIHR4ID0gdHhuUmVzdWx0LnR4bjtcbiAgICB2YXIgcmV0O1xuICAgIHR4Lm9uY29tcGxldGUgPSBmdW5jdGlvbiAoKSB7XG4gICAgICBpZiAocmV0KSB7XG4gICAgICAgIGNhbGxiYWNrKG51bGwsIHJldCk7XG4gICAgICB9XG4gICAgfTtcbiAgICB2YXIgaWQgPSBkb2MuX2lkO1xuICAgIHZhciBvU3RvcmUgPSB0eC5vYmplY3RTdG9yZShMT0NBTF9TVE9SRSk7XG4gICAgdmFyIHJlcSA9IG9TdG9yZS5nZXQoaWQpO1xuXG4gICAgcmVxLm9uZXJyb3IgPSBpZGJFcnJvcihjYWxsYmFjayk7XG4gICAgcmVxLm9uc3VjY2VzcyA9IGZ1bmN0aW9uIChlKSB7XG4gICAgICB2YXIgb2xkRG9jID0gZS50YXJnZXQucmVzdWx0O1xuICAgICAgaWYgKCFvbGREb2MgfHwgb2xkRG9jLl9yZXYgIT09IGRvYy5fcmV2KSB7XG4gICAgICAgIGNhbGxiYWNrKGVycm9ycy5lcnJvcihlcnJvcnMuTUlTU0lOR19ET0MpKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG9TdG9yZVtcImRlbGV0ZVwiXShpZCk7XG4gICAgICAgIHJldCA9IHtvazogdHJ1ZSwgaWQ6IGlkLCByZXY6ICcwLTAnfTtcbiAgICAgIH1cbiAgICB9O1xuICB9O1xuXG4gIHZhciBjYWNoZWQgPSBjYWNoZWREQnNbZGJOYW1lXTtcblxuICBpZiAoY2FjaGVkKSB7XG4gICAgaWRiID0gY2FjaGVkLmlkYjtcbiAgICBhcGkuX21ldGEgPSBjYWNoZWQuZ2xvYmFsO1xuICAgIHByb2Nlc3MubmV4dFRpY2soZnVuY3Rpb24gKCkge1xuICAgICAgY2FsbGJhY2sobnVsbCwgYXBpKTtcbiAgICB9KTtcbiAgICByZXR1cm47XG4gIH1cblxuICB2YXIgcmVxID0gaW5kZXhlZERCLm9wZW4oZGJOYW1lLCBBREFQVEVSX1ZFUlNJT04pO1xuXG4gIGlmICghKCdvcGVuUmVxTGlzdCcgaW4gSWRiUG91Y2gpKSB7XG4gICAgSWRiUG91Y2gub3BlblJlcUxpc3QgPSB7fTtcbiAgfVxuICBJZGJQb3VjaC5vcGVuUmVxTGlzdFtkYk5hbWVdID0gcmVxO1xuXG4gIHJlcS5vbnVwZ3JhZGVuZWVkZWQgPSBmdW5jdGlvbiAoZSkge1xuICAgIHZhciBkYiA9IGUudGFyZ2V0LnJlc3VsdDtcbiAgICBpZiAoZS5vbGRWZXJzaW9uIDwgMSkge1xuICAgICAgcmV0dXJuIGNyZWF0ZVNjaGVtYShkYik7IC8vIG5ldyBkYiwgaW5pdGlhbCBzY2hlbWFcbiAgICB9XG4gICAgLy8gZG8gbWlncmF0aW9uc1xuXG4gICAgdmFyIHR4biA9IGUuY3VycmVudFRhcmdldC50cmFuc2FjdGlvbjtcbiAgICAvLyB0aGVzZSBtaWdyYXRpb25zIGhhdmUgdG8gYmUgZG9uZSBpbiB0aGlzIGZ1bmN0aW9uLCBiZWZvcmVcbiAgICAvLyBjb250cm9sIGlzIHJldHVybmVkIHRvIHRoZSBldmVudCBsb29wLCBiZWNhdXNlIEluZGV4ZWREQlxuXG4gICAgaWYgKGUub2xkVmVyc2lvbiA8IDMpIHtcbiAgICAgIGNyZWF0ZUxvY2FsU3RvcmVTY2hlbWEoZGIpOyAvLyB2MiAtPiB2M1xuICAgIH1cbiAgICBpZiAoZS5vbGRWZXJzaW9uIDwgNCkge1xuICAgICAgYWRkQXR0YWNoQW5kU2VxU3RvcmUoZGIpOyAvLyB2MyAtPiB2NFxuICAgIH1cblxuICAgIHZhciBtaWdyYXRpb25zID0gW1xuICAgICAgYWRkRGVsZXRlZE9yTG9jYWxJbmRleCwgLy8gdjEgLT4gdjJcbiAgICAgIG1pZ3JhdGVMb2NhbFN0b3JlLCAgICAgIC8vIHYyIC0+IHYzXG4gICAgICBtaWdyYXRlQXR0c0FuZFNlcXMsICAgICAvLyB2MyAtPiB2NFxuICAgICAgbWlncmF0ZU1ldGFkYXRhICAgICAgICAgLy8gdjQgLT4gdjVcbiAgICBdO1xuXG4gICAgdmFyIGkgPSBlLm9sZFZlcnNpb247XG5cbiAgICBmdW5jdGlvbiBuZXh0KCkge1xuICAgICAgdmFyIG1pZ3JhdGlvbiA9IG1pZ3JhdGlvbnNbaSAtIDFdO1xuICAgICAgaSsrO1xuICAgICAgaWYgKG1pZ3JhdGlvbikge1xuICAgICAgICBtaWdyYXRpb24odHhuLCBuZXh0KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBuZXh0KCk7XG4gIH07XG5cbiAgcmVxLm9uc3VjY2VzcyA9IGZ1bmN0aW9uIChlKSB7XG5cbiAgICBpZGIgPSBlLnRhcmdldC5yZXN1bHQ7XG5cbiAgICBpZGIub252ZXJzaW9uY2hhbmdlID0gZnVuY3Rpb24gKCkge1xuICAgICAgaWRiLmNsb3NlKCk7XG4gICAgICBkZWxldGUgY2FjaGVkREJzW2RiTmFtZV07XG4gICAgfTtcbiAgICBpZGIub25hYm9ydCA9IGZ1bmN0aW9uICgpIHtcbiAgICAgIGlkYi5jbG9zZSgpO1xuICAgICAgZGVsZXRlIGNhY2hlZERCc1tkYk5hbWVdO1xuICAgIH07XG5cbiAgICB2YXIgdHhuID0gaWRiLnRyYW5zYWN0aW9uKFtcbiAgICAgICAgTUVUQV9TVE9SRSxcbiAgICAgICAgREVURUNUX0JMT0JfU1VQUE9SVF9TVE9SRSxcbiAgICAgICAgRE9DX1NUT1JFXG4gICAgICBdLCAncmVhZHdyaXRlJyk7XG5cbiAgICB2YXIgcmVxID0gdHhuLm9iamVjdFN0b3JlKE1FVEFfU1RPUkUpLmdldChNRVRBX1NUT1JFKTtcblxuICAgIHZhciBibG9iU3VwcG9ydCA9IG51bGw7XG4gICAgdmFyIGRvY0NvdW50ID0gbnVsbDtcbiAgICB2YXIgaW5zdGFuY2VJZCA9IG51bGw7XG5cbiAgICByZXEub25zdWNjZXNzID0gZnVuY3Rpb24gKGUpIHtcblxuICAgICAgdmFyIGNoZWNrU2V0dXBDb21wbGV0ZSA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgaWYgKGJsb2JTdXBwb3J0ID09PSBudWxsIHx8IGRvY0NvdW50ID09PSBudWxsIHx8XG4gICAgICAgICAgICBpbnN0YW5jZUlkID09PSBudWxsKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGFwaS5fbWV0YSA9IHtcbiAgICAgICAgICAgIG5hbWU6IGRiTmFtZSxcbiAgICAgICAgICAgIGluc3RhbmNlSWQ6IGluc3RhbmNlSWQsXG4gICAgICAgICAgICBibG9iU3VwcG9ydDogYmxvYlN1cHBvcnQsXG4gICAgICAgICAgICBkb2NDb3VudDogZG9jQ291bnRcbiAgICAgICAgICB9O1xuXG4gICAgICAgICAgY2FjaGVkREJzW2RiTmFtZV0gPSB7XG4gICAgICAgICAgICBpZGI6IGlkYixcbiAgICAgICAgICAgIGdsb2JhbDogYXBpLl9tZXRhXG4gICAgICAgICAgfTtcbiAgICAgICAgICBjYWxsYmFjayhudWxsLCBhcGkpO1xuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICAvL1xuICAgICAgLy8gZmV0Y2gvc3RvcmUgdGhlIGlkXG4gICAgICAvL1xuXG4gICAgICB2YXIgbWV0YSA9IGUudGFyZ2V0LnJlc3VsdCB8fCB7aWQ6IE1FVEFfU1RPUkV9O1xuICAgICAgaWYgKGRiTmFtZSAgKyAnX2lkJyBpbiBtZXRhKSB7XG4gICAgICAgIGluc3RhbmNlSWQgPSBtZXRhW2RiTmFtZSArICdfaWQnXTtcbiAgICAgICAgY2hlY2tTZXR1cENvbXBsZXRlKCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpbnN0YW5jZUlkID0gdXRpbHMudXVpZCgpO1xuICAgICAgICBtZXRhW2RiTmFtZSArICdfaWQnXSA9IGluc3RhbmNlSWQ7XG4gICAgICAgIHR4bi5vYmplY3RTdG9yZShNRVRBX1NUT1JFKS5wdXQobWV0YSkub25zdWNjZXNzID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgIGNoZWNrU2V0dXBDb21wbGV0ZSgpO1xuICAgICAgICB9O1xuICAgICAgfVxuXG4gICAgICAvL1xuICAgICAgLy8gY2hlY2sgYmxvYiBzdXBwb3J0XG4gICAgICAvL1xuXG4gICAgICBpZiAoIWJsb2JTdXBwb3J0UHJvbWlzZSkge1xuICAgICAgICAvLyBtYWtlIHN1cmUgYmxvYiBzdXBwb3J0IGlzIG9ubHkgY2hlY2tlZCBvbmNlXG4gICAgICAgIGJsb2JTdXBwb3J0UHJvbWlzZSA9IGNoZWNrQmxvYlN1cHBvcnQodHhuLCBpZGIpO1xuICAgICAgfVxuXG4gICAgICBibG9iU3VwcG9ydFByb21pc2UudGhlbihmdW5jdGlvbiAodmFsKSB7XG4gICAgICAgIGJsb2JTdXBwb3J0ID0gdmFsO1xuICAgICAgICBjaGVja1NldHVwQ29tcGxldGUoKTtcbiAgICAgIH0pO1xuXG4gICAgICAvL1xuICAgICAgLy8gY291bnQgZG9jc1xuICAgICAgLy9cblxuICAgICAgdmFyIGluZGV4ID0gdHhuLm9iamVjdFN0b3JlKERPQ19TVE9SRSkuaW5kZXgoJ2RlbGV0ZWRPckxvY2FsJyk7XG4gICAgICBpbmRleC5jb3VudChJREJLZXlSYW5nZS5vbmx5KCcwJykpLm9uc3VjY2VzcyA9IGZ1bmN0aW9uIChlKSB7XG4gICAgICAgIGRvY0NvdW50ID0gZS50YXJnZXQucmVzdWx0O1xuICAgICAgICBjaGVja1NldHVwQ29tcGxldGUoKTtcbiAgICAgIH07XG5cbiAgICB9O1xuICB9O1xuXG4gIHJlcS5vbmVycm9yID0gaWRiRXJyb3IoY2FsbGJhY2spO1xuXG59XG5cbklkYlBvdWNoLnZhbGlkID0gZnVuY3Rpb24gKCkge1xuICAvLyBJc3N1ZSAjMjUzMywgd2UgZmluYWxseSBnYXZlIHVwIG9uIGRvaW5nIGJ1Z1xuICAvLyBkZXRlY3Rpb24gaW5zdGVhZCBvZiBicm93c2VyIHNuaWZmaW5nLiBTYWZhcmkgYnJvdWdodCB1c1xuICAvLyB0byBvdXIga25lZXMuXG4gIHZhciBpc1NhZmFyaSA9IHR5cGVvZiBvcGVuRGF0YWJhc2UgIT09ICd1bmRlZmluZWQnICYmXG4gICAgLyhTYWZhcml8aVBob25lfGlQYWR8aVBvZCkvLnRlc3QobmF2aWdhdG9yLnVzZXJBZ2VudCkgJiZcbiAgICAhL0Nocm9tZS8udGVzdChuYXZpZ2F0b3IudXNlckFnZW50KTtcblxuICAvLyBzb21lIG91dGRhdGVkIGltcGxlbWVudGF0aW9ucyBvZiBJREIgdGhhdCBhcHBlYXIgb24gU2Ftc3VuZ1xuICAvLyBhbmQgSFRDIEFuZHJvaWQgZGV2aWNlcyA8NC40IGFyZSBtaXNzaW5nIElEQktleVJhbmdlXG4gIHJldHVybiAhaXNTYWZhcmkgJiYgdHlwZW9mIGluZGV4ZWREQiAhPT0gJ3VuZGVmaW5lZCcgJiZcbiAgICB0eXBlb2YgSURCS2V5UmFuZ2UgIT09ICd1bmRlZmluZWQnO1xufTtcblxuZnVuY3Rpb24gZGVzdHJveShuYW1lLCBvcHRzLCBjYWxsYmFjaykge1xuICBpZiAoISgnb3BlblJlcUxpc3QnIGluIElkYlBvdWNoKSkge1xuICAgIElkYlBvdWNoLm9wZW5SZXFMaXN0ID0ge307XG4gIH1cbiAgSWRiUG91Y2guQ2hhbmdlcy5yZW1vdmVBbGxMaXN0ZW5lcnMobmFtZSk7XG5cbiAgLy9DbG9zZSBvcGVuIHJlcXVlc3QgZm9yIFwibmFtZVwiIGRhdGFiYXNlIHRvIGZpeCBpZSBkZWxheS5cbiAgaWYgKElkYlBvdWNoLm9wZW5SZXFMaXN0W25hbWVdICYmIElkYlBvdWNoLm9wZW5SZXFMaXN0W25hbWVdLnJlc3VsdCkge1xuICAgIElkYlBvdWNoLm9wZW5SZXFMaXN0W25hbWVdLnJlc3VsdC5jbG9zZSgpO1xuICAgIGRlbGV0ZSBjYWNoZWREQnNbbmFtZV07XG4gIH1cbiAgdmFyIHJlcSA9IGluZGV4ZWREQi5kZWxldGVEYXRhYmFzZShuYW1lKTtcblxuICByZXEub25zdWNjZXNzID0gZnVuY3Rpb24gKCkge1xuICAgIC8vUmVtb3ZlIG9wZW4gcmVxdWVzdCBmcm9tIHRoZSBsaXN0LlxuICAgIGlmIChJZGJQb3VjaC5vcGVuUmVxTGlzdFtuYW1lXSkge1xuICAgICAgSWRiUG91Y2gub3BlblJlcUxpc3RbbmFtZV0gPSBudWxsO1xuICAgIH1cbiAgICBpZiAodXRpbHMuaGFzTG9jYWxTdG9yYWdlKCkgJiYgKG5hbWUgaW4gbG9jYWxTdG9yYWdlKSkge1xuICAgICAgZGVsZXRlIGxvY2FsU3RvcmFnZVtuYW1lXTtcbiAgICB9XG4gICAgY2FsbGJhY2sobnVsbCwgeyAnb2snOiB0cnVlIH0pO1xuICB9O1xuXG4gIHJlcS5vbmVycm9yID0gaWRiRXJyb3IoY2FsbGJhY2spO1xufVxuXG5JZGJQb3VjaC5kZXN0cm95ID0gdXRpbHMudG9Qcm9taXNlKGZ1bmN0aW9uIChuYW1lLCBvcHRzLCBjYWxsYmFjaykge1xuICB0YXNrUXVldWUucXVldWUucHVzaCh7XG4gICAgYWN0aW9uOiBmdW5jdGlvbiAodGhpc0NhbGxiYWNrKSB7XG4gICAgICBkZXN0cm95KG5hbWUsIG9wdHMsIHRoaXNDYWxsYmFjayk7XG4gICAgfSxcbiAgICBjYWxsYmFjazogY2FsbGJhY2tcbiAgfSk7XG4gIGFwcGx5TmV4dCgpO1xufSk7XG5cbklkYlBvdWNoLkNoYW5nZXMgPSBuZXcgdXRpbHMuQ2hhbmdlcygpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IElkYlBvdWNoO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBbJ2lkYicsICd3ZWJzcWwnXTsiLCIndXNlIHN0cmljdCc7XG5cbnZhciB1dGlscyA9IHJlcXVpcmUoJy4uLy4uL3V0aWxzJyk7XG52YXIgZXJyb3JzID0gcmVxdWlyZSgnLi4vLi4vZGVwcy9lcnJvcnMnKTtcblxudmFyIHdlYnNxbFV0aWxzID0gcmVxdWlyZSgnLi93ZWJzcWwtdXRpbHMnKTtcbnZhciB3ZWJzcWxDb25zdGFudHMgPSByZXF1aXJlKCcuL3dlYnNxbC1jb25zdGFudHMnKTtcblxudmFyIERPQ19TVE9SRSA9IHdlYnNxbENvbnN0YW50cy5ET0NfU1RPUkU7XG52YXIgQllfU0VRX1NUT1JFID0gd2Vic3FsQ29uc3RhbnRzLkJZX1NFUV9TVE9SRTtcbnZhciBBVFRBQ0hfU1RPUkUgPSB3ZWJzcWxDb25zdGFudHMuQVRUQUNIX1NUT1JFO1xudmFyIEFUVEFDSF9BTkRfU0VRX1NUT1JFID0gd2Vic3FsQ29uc3RhbnRzLkFUVEFDSF9BTkRfU0VRX1NUT1JFO1xuXG52YXIgc2VsZWN0ID0gd2Vic3FsVXRpbHMuc2VsZWN0O1xudmFyIHN0cmluZ2lmeURvYyA9IHdlYnNxbFV0aWxzLnN0cmluZ2lmeURvYztcbnZhciBjb21wYWN0UmV2cyA9IHdlYnNxbFV0aWxzLmNvbXBhY3RSZXZzO1xudmFyIHVua25vd25FcnJvciA9IHdlYnNxbFV0aWxzLnVua25vd25FcnJvcjtcblxuZnVuY3Rpb24gd2Vic3FsQnVsa0RvY3MocmVxLCBvcHRzLCBhcGksIGRiLCBDaGFuZ2VzLCBjYWxsYmFjaykge1xuICB2YXIgbmV3RWRpdHMgPSBvcHRzLm5ld19lZGl0cztcbiAgdmFyIHVzZXJEb2NzID0gcmVxLmRvY3M7XG5cbiAgLy8gUGFyc2UgdGhlIGRvY3MsIGdpdmUgdGhlbSBhIHNlcXVlbmNlIG51bWJlciBmb3IgdGhlIHJlc3VsdFxuICB2YXIgZG9jSW5mb3MgPSB1c2VyRG9jcy5tYXAoZnVuY3Rpb24gKGRvYykge1xuICAgIGlmIChkb2MuX2lkICYmIHV0aWxzLmlzTG9jYWxJZChkb2MuX2lkKSkge1xuICAgICAgcmV0dXJuIGRvYztcbiAgICB9XG4gICAgdmFyIG5ld0RvYyA9IHV0aWxzLnBhcnNlRG9jKGRvYywgbmV3RWRpdHMpO1xuICAgIHJldHVybiBuZXdEb2M7XG4gIH0pO1xuXG4gIHZhciBkb2NJbmZvRXJyb3JzID0gZG9jSW5mb3MuZmlsdGVyKGZ1bmN0aW9uIChkb2NJbmZvKSB7XG4gICAgcmV0dXJuIGRvY0luZm8uZXJyb3I7XG4gIH0pO1xuICBpZiAoZG9jSW5mb0Vycm9ycy5sZW5ndGgpIHtcbiAgICByZXR1cm4gY2FsbGJhY2soZG9jSW5mb0Vycm9yc1swXSk7XG4gIH1cblxuICB2YXIgdHg7XG4gIHZhciByZXN1bHRzID0gbmV3IEFycmF5KGRvY0luZm9zLmxlbmd0aCk7XG4gIHZhciBmZXRjaGVkRG9jcyA9IG5ldyB1dGlscy5NYXAoKTtcblxuICB2YXIgcHJlY29uZGl0aW9uRXJyb3JlZDtcbiAgZnVuY3Rpb24gY29tcGxldGUoKSB7XG4gICAgaWYgKHByZWNvbmRpdGlvbkVycm9yZWQpIHtcbiAgICAgIHJldHVybiBjYWxsYmFjayhwcmVjb25kaXRpb25FcnJvcmVkKTtcbiAgICB9XG4gICAgQ2hhbmdlcy5ub3RpZnkoYXBpLl9uYW1lKTtcbiAgICBhcGkuX2RvY0NvdW50ID0gLTE7IC8vIGludmFsaWRhdGVcbiAgICBjYWxsYmFjayhudWxsLCByZXN1bHRzKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHZlcmlmeUF0dGFjaG1lbnQoZGlnZXN0LCBjYWxsYmFjaykge1xuICAgIHZhciBzcWwgPSAnU0VMRUNUIGNvdW50KCopIGFzIGNudCBGUk9NICcgKyBBVFRBQ0hfU1RPUkUgK1xuICAgICAgJyBXSEVSRSBkaWdlc3Q9Pyc7XG4gICAgdHguZXhlY3V0ZVNxbChzcWwsIFtkaWdlc3RdLCBmdW5jdGlvbiAodHgsIHJlc3VsdCkge1xuICAgICAgaWYgKHJlc3VsdC5yb3dzLml0ZW0oMCkuY250ID09PSAwKSB7XG4gICAgICAgIHZhciBlcnIgPSBlcnJvcnMuZXJyb3IoZXJyb3JzLk1JU1NJTkdfU1RVQixcbiAgICAgICAgICAndW5rbm93biBzdHViIGF0dGFjaG1lbnQgd2l0aCBkaWdlc3QgJyArXG4gICAgICAgICAgZGlnZXN0KTtcbiAgICAgICAgY2FsbGJhY2soZXJyKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNhbGxiYWNrKCk7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBmdW5jdGlvbiB2ZXJpZnlBdHRhY2htZW50cyhmaW5pc2gpIHtcbiAgICB2YXIgZGlnZXN0cyA9IFtdO1xuICAgIGRvY0luZm9zLmZvckVhY2goZnVuY3Rpb24gKGRvY0luZm8pIHtcbiAgICAgIGlmIChkb2NJbmZvLmRhdGEgJiYgZG9jSW5mby5kYXRhLl9hdHRhY2htZW50cykge1xuICAgICAgICBPYmplY3Qua2V5cyhkb2NJbmZvLmRhdGEuX2F0dGFjaG1lbnRzKS5mb3JFYWNoKGZ1bmN0aW9uIChmaWxlbmFtZSkge1xuICAgICAgICAgIHZhciBhdHQgPSBkb2NJbmZvLmRhdGEuX2F0dGFjaG1lbnRzW2ZpbGVuYW1lXTtcbiAgICAgICAgICBpZiAoYXR0LnN0dWIpIHtcbiAgICAgICAgICAgIGRpZ2VzdHMucHVzaChhdHQuZGlnZXN0KTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0pO1xuICAgIGlmICghZGlnZXN0cy5sZW5ndGgpIHtcbiAgICAgIHJldHVybiBmaW5pc2goKTtcbiAgICB9XG4gICAgdmFyIG51bURvbmUgPSAwO1xuICAgIHZhciBlcnI7XG5cbiAgICBmdW5jdGlvbiBjaGVja0RvbmUoKSB7XG4gICAgICBpZiAoKytudW1Eb25lID09PSBkaWdlc3RzLmxlbmd0aCkge1xuICAgICAgICBmaW5pc2goZXJyKTtcbiAgICAgIH1cbiAgICB9XG4gICAgZGlnZXN0cy5mb3JFYWNoKGZ1bmN0aW9uIChkaWdlc3QpIHtcbiAgICAgIHZlcmlmeUF0dGFjaG1lbnQoZGlnZXN0LCBmdW5jdGlvbiAoYXR0RXJyKSB7XG4gICAgICAgIGlmIChhdHRFcnIgJiYgIWVycikge1xuICAgICAgICAgIGVyciA9IGF0dEVycjtcbiAgICAgICAgfVxuICAgICAgICBjaGVja0RvbmUoKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgZnVuY3Rpb24gd3JpdGVEb2MoZG9jSW5mbywgd2lubmluZ1Jldiwgd2lubmluZ1JldklzRGVsZXRlZCwgbmV3UmV2SXNEZWxldGVkLFxuICAgICAgICAgICAgICAgICAgICBpc1VwZGF0ZSwgZGVsdGEsIHJlc3VsdHNJZHgsIGNhbGxiYWNrKSB7XG5cbiAgICBmdW5jdGlvbiBmaW5pc2goKSB7XG4gICAgICB2YXIgZGF0YSA9IGRvY0luZm8uZGF0YTtcbiAgICAgIHZhciBkZWxldGVkSW50ID0gbmV3UmV2SXNEZWxldGVkID8gMSA6IDA7XG5cbiAgICAgIHZhciBpZCA9IGRhdGEuX2lkO1xuICAgICAgdmFyIHJldiA9IGRhdGEuX3JldjtcbiAgICAgIHZhciBqc29uID0gc3RyaW5naWZ5RG9jKGRhdGEpO1xuICAgICAgdmFyIHNxbCA9ICdJTlNFUlQgSU5UTyAnICsgQllfU0VRX1NUT1JFICtcbiAgICAgICAgJyAoZG9jX2lkLCByZXYsIGpzb24sIGRlbGV0ZWQpIFZBTFVFUyAoPywgPywgPywgPyk7JztcbiAgICAgIHZhciBzcWxBcmdzID0gW2lkLCByZXYsIGpzb24sIGRlbGV0ZWRJbnRdO1xuXG4gICAgICAvLyBtYXAgc2VxcyB0byBhdHRhY2htZW50IGRpZ2VzdHMsIHdoaWNoXG4gICAgICAvLyB3ZSB3aWxsIG5lZWQgbGF0ZXIgZHVyaW5nIGNvbXBhY3Rpb25cbiAgICAgIGZ1bmN0aW9uIGluc2VydEF0dGFjaG1lbnRNYXBwaW5ncyhzZXEsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBhdHRzQWRkZWQgPSAwO1xuICAgICAgICB2YXIgYXR0c1RvQWRkID0gT2JqZWN0LmtleXMoZGF0YS5fYXR0YWNobWVudHMgfHwge30pO1xuXG4gICAgICAgIGlmICghYXR0c1RvQWRkLmxlbmd0aCkge1xuICAgICAgICAgIHJldHVybiBjYWxsYmFjaygpO1xuICAgICAgICB9XG4gICAgICAgIGZ1bmN0aW9uIGNoZWNrRG9uZSgpIHtcbiAgICAgICAgICBpZiAoKythdHRzQWRkZWQgPT09IGF0dHNUb0FkZC5sZW5ndGgpIHtcbiAgICAgICAgICAgIGNhbGxiYWNrKCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiBmYWxzZTsgLy8gYWNrIGhhbmRsaW5nIGEgY29uc3RyYWludCBlcnJvclxuICAgICAgICB9XG4gICAgICAgIGZ1bmN0aW9uIGFkZChhdHQpIHtcbiAgICAgICAgICB2YXIgc3FsID0gJ0lOU0VSVCBJTlRPICcgKyBBVFRBQ0hfQU5EX1NFUV9TVE9SRSArXG4gICAgICAgICAgICAnIChkaWdlc3QsIHNlcSkgVkFMVUVTICg/LD8pJztcbiAgICAgICAgICB2YXIgc3FsQXJncyA9IFtkYXRhLl9hdHRhY2htZW50c1thdHRdLmRpZ2VzdCwgc2VxXTtcbiAgICAgICAgICB0eC5leGVjdXRlU3FsKHNxbCwgc3FsQXJncywgY2hlY2tEb25lLCBjaGVja0RvbmUpO1xuICAgICAgICAgIC8vIHNlY29uZCBjYWxsYmFjayBpcyBmb3IgYSBjb25zdGFpbnQgZXJyb3IsIHdoaWNoIHdlIGlnbm9yZVxuICAgICAgICAgIC8vIGJlY2F1c2UgdGhpcyBkb2NpZC9yZXYgaGFzIGFscmVhZHkgYmVlbiBhc3NvY2lhdGVkIHdpdGhcbiAgICAgICAgICAvLyB0aGUgZGlnZXN0IChlLmcuIHdoZW4gbmV3X2VkaXRzID09IGZhbHNlKVxuICAgICAgICB9XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgYXR0c1RvQWRkLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgYWRkKGF0dHNUb0FkZFtpXSk7IC8vIGRvIGluIHBhcmFsbGVsXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgdHguZXhlY3V0ZVNxbChzcWwsIHNxbEFyZ3MsIGZ1bmN0aW9uICh0eCwgcmVzdWx0KSB7XG4gICAgICAgIHZhciBzZXEgPSByZXN1bHQuaW5zZXJ0SWQ7XG4gICAgICAgIGluc2VydEF0dGFjaG1lbnRNYXBwaW5ncyhzZXEsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICBkYXRhV3JpdHRlbih0eCwgc2VxKTtcbiAgICAgICAgfSk7XG4gICAgICB9LCBmdW5jdGlvbiAoKSB7XG4gICAgICAgIC8vIGNvbnN0cmFpbnQgZXJyb3IsIHJlY292ZXIgYnkgdXBkYXRpbmcgaW5zdGVhZCAoc2VlICMxNjM4KVxuICAgICAgICB2YXIgZmV0Y2hTcWwgPSBzZWxlY3QoJ3NlcScsIEJZX1NFUV9TVE9SRSwgbnVsbCxcbiAgICAgICAgICAnZG9jX2lkPT8gQU5EIHJldj0/Jyk7XG4gICAgICAgIHR4LmV4ZWN1dGVTcWwoZmV0Y2hTcWwsIFtpZCwgcmV2XSwgZnVuY3Rpb24gKHR4LCByZXMpIHtcbiAgICAgICAgICB2YXIgc2VxID0gcmVzLnJvd3MuaXRlbSgwKS5zZXE7XG4gICAgICAgICAgdmFyIHNxbCA9ICdVUERBVEUgJyArIEJZX1NFUV9TVE9SRSArXG4gICAgICAgICAgICAnIFNFVCBqc29uPT8sIGRlbGV0ZWQ9PyBXSEVSRSBkb2NfaWQ9PyBBTkQgcmV2PT87JztcbiAgICAgICAgICB2YXIgc3FsQXJncyA9IFtqc29uLCBkZWxldGVkSW50LCBpZCwgcmV2XTtcbiAgICAgICAgICB0eC5leGVjdXRlU3FsKHNxbCwgc3FsQXJncywgZnVuY3Rpb24gKHR4KSB7XG4gICAgICAgICAgICBpbnNlcnRBdHRhY2htZW50TWFwcGluZ3Moc2VxLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgIGRhdGFXcml0dGVuKHR4LCBzZXEpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gZmFsc2U7IC8vIGFjayB0aGF0IHdlJ3ZlIGhhbmRsZWQgdGhlIGVycm9yXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBjb2xsZWN0UmVzdWx0cyhhdHRhY2htZW50RXJyKSB7XG4gICAgICBpZiAoIWVycikge1xuICAgICAgICBpZiAoYXR0YWNobWVudEVycikge1xuICAgICAgICAgIGVyciA9IGF0dGFjaG1lbnRFcnI7XG4gICAgICAgICAgY2FsbGJhY2soZXJyKTtcbiAgICAgICAgfSBlbHNlIGlmIChyZWN2ID09PSBhdHRhY2htZW50cy5sZW5ndGgpIHtcbiAgICAgICAgICBmaW5pc2goKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIHZhciBlcnIgPSBudWxsO1xuICAgIHZhciByZWN2ID0gMDtcblxuICAgIGRvY0luZm8uZGF0YS5faWQgPSBkb2NJbmZvLm1ldGFkYXRhLmlkO1xuICAgIGRvY0luZm8uZGF0YS5fcmV2ID0gZG9jSW5mby5tZXRhZGF0YS5yZXY7XG4gICAgdmFyIGF0dGFjaG1lbnRzID0gT2JqZWN0LmtleXMoZG9jSW5mby5kYXRhLl9hdHRhY2htZW50cyB8fCB7fSk7XG5cblxuICAgIGlmIChuZXdSZXZJc0RlbGV0ZWQpIHtcbiAgICAgIGRvY0luZm8uZGF0YS5fZGVsZXRlZCA9IHRydWU7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gYXR0YWNobWVudFNhdmVkKGVycikge1xuICAgICAgcmVjdisrO1xuICAgICAgY29sbGVjdFJlc3VsdHMoZXJyKTtcbiAgICB9XG5cbiAgICBhdHRhY2htZW50cy5mb3JFYWNoKGZ1bmN0aW9uIChrZXkpIHtcbiAgICAgIHZhciBhdHQgPSBkb2NJbmZvLmRhdGEuX2F0dGFjaG1lbnRzW2tleV07XG4gICAgICBpZiAoIWF0dC5zdHViKSB7XG4gICAgICAgIHZhciBkYXRhID0gYXR0LmRhdGE7XG4gICAgICAgIGRlbGV0ZSBhdHQuZGF0YTtcbiAgICAgICAgdmFyIGRpZ2VzdCA9IGF0dC5kaWdlc3Q7XG4gICAgICAgIHNhdmVBdHRhY2htZW50KGRpZ2VzdCwgZGF0YSwgYXR0YWNobWVudFNhdmVkKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJlY3YrKztcbiAgICAgICAgY29sbGVjdFJlc3VsdHMoKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGlmICghYXR0YWNobWVudHMubGVuZ3RoKSB7XG4gICAgICBmaW5pc2goKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBhdXRvQ29tcGFjdCgpIHtcbiAgICAgIGlmICghaXNVcGRhdGUgfHwgIWFwaS5hdXRvX2NvbXBhY3Rpb24pIHtcbiAgICAgICAgcmV0dXJuOyAvLyBub3RoaW5nIHRvIGRvXG4gICAgICB9XG4gICAgICB2YXIgaWQgPSBkb2NJbmZvLm1ldGFkYXRhLmlkO1xuICAgICAgdmFyIHJldnNUb0RlbGV0ZSA9IHV0aWxzLmNvbXBhY3RUcmVlKGRvY0luZm8ubWV0YWRhdGEpO1xuICAgICAgY29tcGFjdFJldnMocmV2c1RvRGVsZXRlLCBpZCwgdHgpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGRhdGFXcml0dGVuKHR4LCBzZXEpIHtcbiAgICAgIGF1dG9Db21wYWN0KCk7XG4gICAgICBkb2NJbmZvLm1ldGFkYXRhLnNlcSA9IHNlcTtcbiAgICAgIGRlbGV0ZSBkb2NJbmZvLm1ldGFkYXRhLnJldjtcblxuICAgICAgdmFyIHNxbCA9IGlzVXBkYXRlID9cbiAgICAgICdVUERBVEUgJyArIERPQ19TVE9SRSArXG4gICAgICAnIFNFVCBqc29uPT8sIG1heF9zZXE9Pywgd2lubmluZ3NlcT0nICtcbiAgICAgICcoU0VMRUNUIHNlcSBGUk9NICcgKyBCWV9TRVFfU1RPUkUgK1xuICAgICAgJyBXSEVSRSBkb2NfaWQ9JyArIERPQ19TVE9SRSArICcuaWQgQU5EIHJldj0/KSBXSEVSRSBpZD0/J1xuICAgICAgICA6ICdJTlNFUlQgSU5UTyAnICsgRE9DX1NUT1JFICtcbiAgICAgICcgKGlkLCB3aW5uaW5nc2VxLCBtYXhfc2VxLCBqc29uKSBWQUxVRVMgKD8sPyw/LD8pOyc7XG4gICAgICB2YXIgbWV0YWRhdGFTdHIgPSB1dGlscy5zYWZlSnNvblN0cmluZ2lmeShkb2NJbmZvLm1ldGFkYXRhKTtcbiAgICAgIHZhciBpZCA9IGRvY0luZm8ubWV0YWRhdGEuaWQ7XG4gICAgICB2YXIgcGFyYW1zID0gaXNVcGRhdGUgP1xuICAgICAgICBbbWV0YWRhdGFTdHIsIHNlcSwgd2lubmluZ1JldiwgaWRdIDpcbiAgICAgICAgW2lkLCBzZXEsIHNlcSwgbWV0YWRhdGFTdHJdO1xuICAgICAgdHguZXhlY3V0ZVNxbChzcWwsIHBhcmFtcywgZnVuY3Rpb24gKCkge1xuICAgICAgICByZXN1bHRzW3Jlc3VsdHNJZHhdID0ge1xuICAgICAgICAgIG9rOiB0cnVlLFxuICAgICAgICAgIGlkOiBkb2NJbmZvLm1ldGFkYXRhLmlkLFxuICAgICAgICAgIHJldjogd2lubmluZ1JldlxuICAgICAgICB9O1xuICAgICAgICBmZXRjaGVkRG9jcy5zZXQoaWQsIGRvY0luZm8ubWV0YWRhdGEpO1xuICAgICAgICBjYWxsYmFjaygpO1xuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gcHJvY2Vzc0RvY3MoKSB7XG4gICAgdXRpbHMucHJvY2Vzc0RvY3MoZG9jSW5mb3MsIGFwaSwgZmV0Y2hlZERvY3MsXG4gICAgICB0eCwgcmVzdWx0cywgd3JpdGVEb2MsIG9wdHMpO1xuICB9XG5cbiAgZnVuY3Rpb24gZmV0Y2hFeGlzdGluZ0RvY3MoY2FsbGJhY2spIHtcbiAgICBpZiAoIWRvY0luZm9zLmxlbmd0aCkge1xuICAgICAgcmV0dXJuIGNhbGxiYWNrKCk7XG4gICAgfVxuXG4gICAgdmFyIG51bUZldGNoZWQgPSAwO1xuXG4gICAgZnVuY3Rpb24gY2hlY2tEb25lKCkge1xuICAgICAgaWYgKCsrbnVtRmV0Y2hlZCA9PT0gZG9jSW5mb3MubGVuZ3RoKSB7XG4gICAgICAgIGNhbGxiYWNrKCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgZG9jSW5mb3MuZm9yRWFjaChmdW5jdGlvbiAoZG9jSW5mbykge1xuICAgICAgaWYgKGRvY0luZm8uX2lkICYmIHV0aWxzLmlzTG9jYWxJZChkb2NJbmZvLl9pZCkpIHtcbiAgICAgICAgcmV0dXJuIGNoZWNrRG9uZSgpOyAvLyBza2lwIGxvY2FsIGRvY3NcbiAgICAgIH1cbiAgICAgIHZhciBpZCA9IGRvY0luZm8ubWV0YWRhdGEuaWQ7XG4gICAgICB0eC5leGVjdXRlU3FsKCdTRUxFQ1QganNvbiBGUk9NICcgKyBET0NfU1RPUkUgK1xuICAgICAgJyBXSEVSRSBpZCA9ID8nLCBbaWRdLCBmdW5jdGlvbiAodHgsIHJlc3VsdCkge1xuICAgICAgICBpZiAocmVzdWx0LnJvd3MubGVuZ3RoKSB7XG4gICAgICAgICAgdmFyIG1ldGFkYXRhID0gdXRpbHMuc2FmZUpzb25QYXJzZShyZXN1bHQucm93cy5pdGVtKDApLmpzb24pO1xuICAgICAgICAgIGZldGNoZWREb2NzLnNldChpZCwgbWV0YWRhdGEpO1xuICAgICAgICB9XG4gICAgICAgIGNoZWNrRG9uZSgpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBmdW5jdGlvbiBzYXZlQXR0YWNobWVudChkaWdlc3QsIGRhdGEsIGNhbGxiYWNrKSB7XG4gICAgdmFyIHNxbCA9ICdTRUxFQ1QgZGlnZXN0IEZST00gJyArIEFUVEFDSF9TVE9SRSArICcgV0hFUkUgZGlnZXN0PT8nO1xuICAgIHR4LmV4ZWN1dGVTcWwoc3FsLCBbZGlnZXN0XSwgZnVuY3Rpb24gKHR4LCByZXN1bHQpIHtcbiAgICAgIGlmIChyZXN1bHQucm93cy5sZW5ndGgpIHsgLy8gYXR0YWNobWVudCBhbHJlYWR5IGV4aXN0c1xuICAgICAgICByZXR1cm4gY2FsbGJhY2soKTtcbiAgICAgIH1cbiAgICAgIC8vIHdlIGNvdWxkIGp1c3QgaW5zZXJ0IGJlZm9yZSBzZWxlY3RpbmcgYW5kIGNhdGNoIHRoZSBlcnJvcixcbiAgICAgIC8vIGJ1dCBteSBodW5jaCBpcyB0aGF0IGl0J3MgY2hlYXBlciBub3QgdG8gc2VyaWFsaXplIHRoZSBibG9iXG4gICAgICAvLyBmcm9tIEpTIHRvIEMgaWYgd2UgZG9uJ3QgaGF2ZSB0byAoVE9ETzogY29uZmlybSB0aGlzKVxuICAgICAgc3FsID0gJ0lOU0VSVCBJTlRPICcgKyBBVFRBQ0hfU1RPUkUgK1xuICAgICAgJyAoZGlnZXN0LCBib2R5LCBlc2NhcGVkKSBWQUxVRVMgKD8sPywxKSc7XG4gICAgICB0eC5leGVjdXRlU3FsKHNxbCwgW2RpZ2VzdCwgd2Vic3FsVXRpbHMuZXNjYXBlQmxvYihkYXRhKV0sIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgY2FsbGJhY2soKTtcbiAgICAgIH0sIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgLy8gaWdub3JlIGNvbnN0YWludCBlcnJvcnMsIG1lYW5zIGl0IGFscmVhZHkgZXhpc3RzXG4gICAgICAgIGNhbGxiYWNrKCk7XG4gICAgICAgIHJldHVybiBmYWxzZTsgLy8gYWNrIHdlIGhhbmRsZWQgdGhlIGVycm9yXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIHV0aWxzLnByZXByb2Nlc3NBdHRhY2htZW50cyhkb2NJbmZvcywgJ2JpbmFyeScsIGZ1bmN0aW9uIChlcnIpIHtcbiAgICBpZiAoZXJyKSB7XG4gICAgICByZXR1cm4gY2FsbGJhY2soZXJyKTtcbiAgICB9XG4gICAgZGIudHJhbnNhY3Rpb24oZnVuY3Rpb24gKHR4bikge1xuICAgICAgdHggPSB0eG47XG4gICAgICB2ZXJpZnlBdHRhY2htZW50cyhmdW5jdGlvbiAoZXJyKSB7XG4gICAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgICBwcmVjb25kaXRpb25FcnJvcmVkID0gZXJyO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGZldGNoRXhpc3RpbmdEb2NzKHByb2Nlc3NEb2NzKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSwgdW5rbm93bkVycm9yKGNhbGxiYWNrKSwgY29tcGxldGUpO1xuICB9KTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB3ZWJzcWxCdWxrRG9jcztcbiIsIid1c2Ugc3RyaWN0JztcblxuZnVuY3Rpb24gcXVvdGUoc3RyKSB7XG4gIHJldHVybiBcIidcIiArIHN0ciArIFwiJ1wiO1xufVxuXG5leHBvcnRzLkFEQVBURVJfVkVSU0lPTiA9IDc7IC8vIHVzZWQgdG8gbWFuYWdlIG1pZ3JhdGlvbnNcblxuLy8gVGhlIG9iamVjdCBzdG9yZXMgY3JlYXRlZCBmb3IgZWFjaCBkYXRhYmFzZVxuLy8gRE9DX1NUT1JFIHN0b3JlcyB0aGUgZG9jdW1lbnQgbWV0YSBkYXRhLCBpdHMgcmV2aXNpb24gaGlzdG9yeSBhbmQgc3RhdGVcbmV4cG9ydHMuRE9DX1NUT1JFID0gcXVvdGUoJ2RvY3VtZW50LXN0b3JlJyk7XG4vLyBCWV9TRVFfU1RPUkUgc3RvcmVzIGEgcGFydGljdWxhciB2ZXJzaW9uIG9mIGEgZG9jdW1lbnQsIGtleWVkIGJ5IGl0c1xuLy8gc2VxdWVuY2UgaWRcbmV4cG9ydHMuQllfU0VRX1NUT1JFID0gcXVvdGUoJ2J5LXNlcXVlbmNlJyk7XG4vLyBXaGVyZSB3ZSBzdG9yZSBhdHRhY2htZW50c1xuZXhwb3J0cy5BVFRBQ0hfU1RPUkUgPSBxdW90ZSgnYXR0YWNoLXN0b3JlJyk7XG5leHBvcnRzLkxPQ0FMX1NUT1JFID0gcXVvdGUoJ2xvY2FsLXN0b3JlJyk7XG5leHBvcnRzLk1FVEFfU1RPUkUgPSBxdW90ZSgnbWV0YWRhdGEtc3RvcmUnKTtcbi8vIHdoZXJlIHdlIHN0b3JlIG1hbnktdG8tbWFueSByZWxhdGlvbnMgYmV0d2VlbiBhdHRhY2htZW50XG4vLyBkaWdlc3RzIGFuZCBzZXFzXG5leHBvcnRzLkFUVEFDSF9BTkRfU0VRX1NUT1JFID0gcXVvdGUoJ2F0dGFjaC1zZXEtc3RvcmUnKTtcblxuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuLi8uLi91dGlscycpO1xudmFyIGVycm9ycyA9IHJlcXVpcmUoJy4uLy4uL2RlcHMvZXJyb3JzJyk7XG5cbnZhciB3ZWJzcWxDb25zdGFudHMgPSByZXF1aXJlKCcuL3dlYnNxbC1jb25zdGFudHMnKTtcblxudmFyIEJZX1NFUV9TVE9SRSA9IHdlYnNxbENvbnN0YW50cy5CWV9TRVFfU1RPUkU7XG52YXIgQVRUQUNIX1NUT1JFID0gd2Vic3FsQ29uc3RhbnRzLkFUVEFDSF9TVE9SRTtcbnZhciBBVFRBQ0hfQU5EX1NFUV9TVE9SRSA9IHdlYnNxbENvbnN0YW50cy5BVFRBQ0hfQU5EX1NFUV9TVE9SRTtcblxuLy8gZXNjYXBlQmxvYiBhbmQgdW5lc2NhcGVCbG9iIGFyZSB3b3JrYXJvdW5kcyBmb3IgYSB3ZWJzcWwgYnVnOlxuLy8gaHR0cHM6Ly9jb2RlLmdvb2dsZS5jb20vcC9jaHJvbWl1bS9pc3N1ZXMvZGV0YWlsP2lkPTQyMjY5MFxuLy8gaHR0cHM6Ly9idWdzLndlYmtpdC5vcmcvc2hvd19idWcuY2dpP2lkPTEzNzYzN1xuLy8gVGhlIGdvYWwgaXMgdG8gbmV2ZXIgYWN0dWFsbHkgaW5zZXJ0IHRoZSBcXHUwMDAwIGNoYXJhY3RlclxuLy8gaW4gdGhlIGRhdGFiYXNlLlxuZnVuY3Rpb24gZXNjYXBlQmxvYihzdHIpIHtcbiAgcmV0dXJuIHN0clxuICAgIC5yZXBsYWNlKC9cXHUwMDAyL2csICdcXHUwMDAyXFx1MDAwMicpXG4gICAgLnJlcGxhY2UoL1xcdTAwMDEvZywgJ1xcdTAwMDFcXHUwMDAyJylcbiAgICAucmVwbGFjZSgvXFx1MDAwMC9nLCAnXFx1MDAwMVxcdTAwMDEnKTtcbn1cblxuZnVuY3Rpb24gdW5lc2NhcGVCbG9iKHN0cikge1xuICByZXR1cm4gc3RyXG4gICAgLnJlcGxhY2UoL1xcdTAwMDFcXHUwMDAxL2csICdcXHUwMDAwJylcbiAgICAucmVwbGFjZSgvXFx1MDAwMVxcdTAwMDIvZywgJ1xcdTAwMDEnKVxuICAgIC5yZXBsYWNlKC9cXHUwMDAyXFx1MDAwMi9nLCAnXFx1MDAwMicpO1xufVxuXG5mdW5jdGlvbiBzdHJpbmdpZnlEb2MoZG9jKSB7XG4gIC8vIGRvbid0IGJvdGhlciBzdG9yaW5nIHRoZSBpZC9yZXYuIGl0IHVzZXMgbG90cyBvZiBzcGFjZSxcbiAgLy8gaW4gcGVyc2lzdGVudCBtYXAvcmVkdWNlIGVzcGVjaWFsbHlcbiAgZGVsZXRlIGRvYy5faWQ7XG4gIGRlbGV0ZSBkb2MuX3JldjtcbiAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KGRvYyk7XG59XG5cbmZ1bmN0aW9uIHVuc3RyaW5naWZ5RG9jKGRvYywgaWQsIHJldikge1xuICBkb2MgPSBKU09OLnBhcnNlKGRvYyk7XG4gIGRvYy5faWQgPSBpZDtcbiAgZG9jLl9yZXYgPSByZXY7XG4gIHJldHVybiBkb2M7XG59XG5cbi8vIHF1ZXN0aW9uIG1hcmsgZ3JvdXBzIElOIHF1ZXJpZXMsIGUuZy4gMyAtPiAnKD8sPyw/KSdcbmZ1bmN0aW9uIHFNYXJrcyhudW0pIHtcbiAgdmFyIHMgPSAnKCc7XG4gIHdoaWxlIChudW0tLSkge1xuICAgIHMgKz0gJz8nO1xuICAgIGlmIChudW0pIHtcbiAgICAgIHMgKz0gJywnO1xuICAgIH1cbiAgfVxuICByZXR1cm4gcyArICcpJztcbn1cblxuZnVuY3Rpb24gc2VsZWN0KHNlbGVjdG9yLCB0YWJsZSwgam9pbmVyLCB3aGVyZSwgb3JkZXJCeSkge1xuICByZXR1cm4gJ1NFTEVDVCAnICsgc2VsZWN0b3IgKyAnIEZST00gJyArXG4gICAgKHR5cGVvZiB0YWJsZSA9PT0gJ3N0cmluZycgPyB0YWJsZSA6IHRhYmxlLmpvaW4oJyBKT0lOICcpKSArXG4gICAgKGpvaW5lciA/ICgnIE9OICcgKyBqb2luZXIpIDogJycpICtcbiAgICAod2hlcmUgPyAoJyBXSEVSRSAnICtcbiAgICAodHlwZW9mIHdoZXJlID09PSAnc3RyaW5nJyA/IHdoZXJlIDogd2hlcmUuam9pbignIEFORCAnKSkpIDogJycpICtcbiAgICAob3JkZXJCeSA/ICgnIE9SREVSIEJZICcgKyBvcmRlckJ5KSA6ICcnKTtcbn1cblxuZnVuY3Rpb24gY29tcGFjdFJldnMocmV2cywgZG9jSWQsIHR4KSB7XG5cbiAgaWYgKCFyZXZzLmxlbmd0aCkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIHZhciBudW1Eb25lID0gMDtcbiAgdmFyIHNlcXMgPSBbXTtcblxuICBmdW5jdGlvbiBjaGVja0RvbmUoKSB7XG4gICAgaWYgKCsrbnVtRG9uZSA9PT0gcmV2cy5sZW5ndGgpIHsgLy8gZG9uZVxuICAgICAgZGVsZXRlT3JwaGFucygpO1xuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIGRlbGV0ZU9ycGhhbnMoKSB7XG4gICAgLy8gZmluZCBvcnBoYW5lZCBhdHRhY2htZW50IGRpZ2VzdHNcblxuICAgIGlmICghc2Vxcy5sZW5ndGgpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgc3FsID0gJ1NFTEVDVCBESVNUSU5DVCBkaWdlc3QgQVMgZGlnZXN0IEZST00gJyArXG4gICAgICBBVFRBQ0hfQU5EX1NFUV9TVE9SRSArICcgV0hFUkUgc2VxIElOICcgKyBxTWFya3Moc2Vxcy5sZW5ndGgpO1xuXG4gICAgdHguZXhlY3V0ZVNxbChzcWwsIHNlcXMsIGZ1bmN0aW9uICh0eCwgcmVzKSB7XG5cbiAgICAgIHZhciBkaWdlc3RzVG9DaGVjayA9IFtdO1xuICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCByZXMucm93cy5sZW5ndGg7IGkrKykge1xuICAgICAgICBkaWdlc3RzVG9DaGVjay5wdXNoKHJlcy5yb3dzLml0ZW0oaSkuZGlnZXN0KTtcbiAgICAgIH1cbiAgICAgIGlmICghZGlnZXN0c1RvQ2hlY2subGVuZ3RoKSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgdmFyIHNxbCA9ICdERUxFVEUgRlJPTSAnICsgQVRUQUNIX0FORF9TRVFfU1RPUkUgK1xuICAgICAgICAnIFdIRVJFIHNlcSBJTiAoJyArXG4gICAgICAgIHNlcXMubWFwKGZ1bmN0aW9uICgpIHsgcmV0dXJuICc/JzsgfSkuam9pbignLCcpICtcbiAgICAgICAgJyknO1xuICAgICAgdHguZXhlY3V0ZVNxbChzcWwsIHNlcXMsIGZ1bmN0aW9uICh0eCkge1xuXG4gICAgICAgIHZhciBzcWwgPSAnU0VMRUNUIGRpZ2VzdCBGUk9NICcgKyBBVFRBQ0hfQU5EX1NFUV9TVE9SRSArXG4gICAgICAgICAgJyBXSEVSRSBkaWdlc3QgSU4gKCcgK1xuICAgICAgICAgIGRpZ2VzdHNUb0NoZWNrLm1hcChmdW5jdGlvbiAoKSB7IHJldHVybiAnPyc7IH0pLmpvaW4oJywnKSArXG4gICAgICAgICAgJyknO1xuICAgICAgICB0eC5leGVjdXRlU3FsKHNxbCwgZGlnZXN0c1RvQ2hlY2ssIGZ1bmN0aW9uICh0eCwgcmVzKSB7XG4gICAgICAgICAgdmFyIG5vbk9ycGhhbmVkRGlnZXN0cyA9IG5ldyB1dGlscy5TZXQoKTtcbiAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHJlcy5yb3dzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBub25PcnBoYW5lZERpZ2VzdHMuYWRkKHJlcy5yb3dzLml0ZW0oaSkuZGlnZXN0KTtcbiAgICAgICAgICB9XG4gICAgICAgICAgZGlnZXN0c1RvQ2hlY2suZm9yRWFjaChmdW5jdGlvbiAoZGlnZXN0KSB7XG4gICAgICAgICAgICBpZiAobm9uT3JwaGFuZWREaWdlc3RzLmhhcyhkaWdlc3QpKSB7XG4gICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHR4LmV4ZWN1dGVTcWwoXG4gICAgICAgICAgICAgICdERUxFVEUgRlJPTSAnICsgQVRUQUNIX0FORF9TRVFfU1RPUkUgKyAnIFdIRVJFIGRpZ2VzdD0/JyxcbiAgICAgICAgICAgICAgW2RpZ2VzdF0pO1xuICAgICAgICAgICAgdHguZXhlY3V0ZVNxbChcbiAgICAgICAgICAgICAgJ0RFTEVURSBGUk9NICcgKyBBVFRBQ0hfU1RPUkUgKyAnIFdIRVJFIGRpZ2VzdD0/JywgW2RpZ2VzdF0pO1xuICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgLy8gdXBkYXRlIGJ5LXNlcSBhbmQgYXR0YWNoIHN0b3JlcyBpbiBwYXJhbGxlbFxuICByZXZzLmZvckVhY2goZnVuY3Rpb24gKHJldikge1xuICAgIHZhciBzcWwgPSAnU0VMRUNUIHNlcSBGUk9NICcgKyBCWV9TRVFfU1RPUkUgK1xuICAgICAgJyBXSEVSRSBkb2NfaWQ9PyBBTkQgcmV2PT8nO1xuXG4gICAgdHguZXhlY3V0ZVNxbChzcWwsIFtkb2NJZCwgcmV2XSwgZnVuY3Rpb24gKHR4LCByZXMpIHtcbiAgICAgIGlmICghcmVzLnJvd3MubGVuZ3RoKSB7IC8vIGFscmVhZHkgZGVsZXRlZFxuICAgICAgICByZXR1cm4gY2hlY2tEb25lKCk7XG4gICAgICB9XG4gICAgICB2YXIgc2VxID0gcmVzLnJvd3MuaXRlbSgwKS5zZXE7XG4gICAgICBzZXFzLnB1c2goc2VxKTtcblxuICAgICAgdHguZXhlY3V0ZVNxbChcbiAgICAgICAgJ0RFTEVURSBGUk9NICcgKyBCWV9TRVFfU1RPUkUgKyAnIFdIRVJFIHNlcT0/JywgW3NlcV0sIGNoZWNrRG9uZSk7XG4gICAgfSk7XG4gIH0pO1xufVxuXG5mdW5jdGlvbiB1bmtub3duRXJyb3IoY2FsbGJhY2spIHtcbiAgcmV0dXJuIGZ1bmN0aW9uIChldmVudCkge1xuICAgIC8vIGV2ZW50IG1heSBhY3R1YWxseSBiZSBhIFNRTEVycm9yIG9iamVjdCwgc28gcmVwb3J0IGlzIGFzIHN1Y2hcbiAgICB2YXIgZXJyb3JOYW1lTWF0Y2ggPSBldmVudCAmJiBldmVudC5jb25zdHJ1Y3Rvci50b1N0cmluZygpXG4gICAgICAgIC5tYXRjaCgvZnVuY3Rpb24gKFteXFwoXSspLyk7XG4gICAgdmFyIGVycm9yTmFtZSA9IChlcnJvck5hbWVNYXRjaCAmJiBlcnJvck5hbWVNYXRjaFsxXSkgfHwgZXZlbnQudHlwZTtcbiAgICB2YXIgZXJyb3JSZWFzb24gPSBldmVudC50YXJnZXQgfHwgZXZlbnQubWVzc2FnZTtcbiAgICBjYWxsYmFjayhlcnJvcnMuZXJyb3IoZXJyb3JzLldTUV9FUlJPUiwgZXJyb3JSZWFzb24sIGVycm9yTmFtZSkpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBnZXRTaXplKG9wdHMpIHtcbiAgaWYgKCdzaXplJyBpbiBvcHRzKSB7XG4gICAgLy8gdHJpZ2dlcnMgaW1tZWRpYXRlIHBvcHVwIGluIGlPUywgZml4ZXMgIzIzNDdcbiAgICAvLyBlLmcuIDUwMDAwMDEgYXNrcyBmb3IgNSBNQiwgMTAwMDAwMDEgYXNrcyBmb3IgMTAgTUIsXG4gICAgcmV0dXJuIG9wdHMuc2l6ZSAqIDEwMDAwMDA7XG4gIH1cbiAgLy8gSW4gaU9TLCBkb2Vzbid0IG1hdHRlciBhcyBsb25nIGFzIGl0J3MgPD0gNTAwMDAwMC5cbiAgLy8gRXhjZXB0IHRoYXQgaWYgeW91IHJlcXVlc3QgdG9vIG11Y2gsIG91ciB0ZXN0cyBmYWlsXG4gIC8vIGJlY2F1c2Ugb2YgdGhlIG5hdGl2ZSBcImRvIHlvdSBhY2NlcHQ/XCIgcG9wdXAuXG4gIC8vIEluIEFuZHJvaWQgPD00LjMsIHRoaXMgdmFsdWUgaXMgYWN0dWFsbHkgdXNlZCBhcyBhblxuICAvLyBob25lc3QtdG8tZ29kIGNlaWxpbmcgZm9yIGRhdGEsIHNvIHdlIG5lZWQgdG9cbiAgLy8gc2V0IGl0IHRvIGEgZGVjZW50bHkgaGlnaCBudW1iZXIuXG4gIHZhciBpc0FuZHJvaWQgPSAvQW5kcm9pZC8udGVzdCh3aW5kb3cubmF2aWdhdG9yLnVzZXJBZ2VudCk7XG4gIHJldHVybiBpc0FuZHJvaWQgPyA1MDAwMDAwIDogMTsgLy8gaW4gUGhhbnRvbUpTLCBpZiB5b3UgdXNlIDAgaXQgd2lsbCBjcmFzaFxufVxuXG5mdW5jdGlvbiBjcmVhdGVPcGVuREJGdW5jdGlvbigpIHtcbiAgaWYgKHR5cGVvZiBzcWxpdGVQbHVnaW4gIT09ICd1bmRlZmluZWQnKSB7XG4gICAgLy8gVGhlIFNRTGl0ZSBQbHVnaW4gc3RhcnRlZCBkZXZpYXRpbmcgcHJldHR5IGhlYXZpbHkgZnJvbSB0aGVcbiAgICAvLyBzdGFuZGFyZCBvcGVuRGF0YWJhc2UoKSBmdW5jdGlvbiwgYXMgdGhleSBzdGFydGVkIGFkZGluZyBtb3JlIGZlYXR1cmVzLlxuICAgIC8vIEl0J3MgYmV0dGVyIHRvIGp1c3QgdXNlIHRoZWlyIFwibmV3XCIgZm9ybWF0IGFuZCBwYXNzIGluIGEgYmlnIG9sJ1xuICAgIC8vIG9wdGlvbnMgb2JqZWN0LlxuICAgIHJldHVybiBzcWxpdGVQbHVnaW4ub3BlbkRhdGFiYXNlLmJpbmQoc3FsaXRlUGx1Z2luKTtcbiAgfVxuXG4gIGlmICh0eXBlb2Ygb3BlbkRhdGFiYXNlICE9PSAndW5kZWZpbmVkJykge1xuICAgIHJldHVybiBmdW5jdGlvbiBvcGVuREIob3B0cykge1xuICAgICAgLy8gVHJhZGl0aW9uYWwgV2ViU1FMIEFQSVxuICAgICAgcmV0dXJuIG9wZW5EYXRhYmFzZShvcHRzLm5hbWUsIG9wdHMudmVyc2lvbiwgb3B0cy5kZXNjcmlwdGlvbiwgb3B0cy5zaXplKTtcbiAgICB9O1xuICB9XG59XG5cbnZhciBjYWNoZWREYXRhYmFzZXMgPSB7fTtcblxuZnVuY3Rpb24gb3BlbkRCKG9wdHMpIHtcblxuICB2YXIgb3BlbkRCRnVuY3Rpb24gPSBjcmVhdGVPcGVuREJGdW5jdGlvbigpO1xuXG4gIHZhciBkYiA9IGNhY2hlZERhdGFiYXNlc1tvcHRzLm5hbWVdO1xuICBpZiAoIWRiKSB7XG4gICAgZGIgPSBjYWNoZWREYXRhYmFzZXNbb3B0cy5uYW1lXSA9IG9wZW5EQkZ1bmN0aW9uKG9wdHMpO1xuICAgIGRiLl9zcWxpdGVQbHVnaW4gPSB0eXBlb2Ygc3FsaXRlUGx1Z2luICE9PSAndW5kZWZpbmVkJztcbiAgfVxuICByZXR1cm4gZGI7XG59XG5cbmZ1bmN0aW9uIHZhbGlkKCkge1xuICAvLyBTUUxpdGVQbHVnaW4gbGVha3MgdGhpcyBnbG9iYWwgb2JqZWN0LCB3aGljaCB3ZSBjYW4gdXNlXG4gIC8vIHRvIGRldGVjdCBpZiBpdCdzIGluc3RhbGxlZCBvciBub3QuIFRoZSBiZW5lZml0IGlzIHRoYXQgaXQnc1xuICAvLyBkZWNsYXJlZCBpbW1lZGlhdGVseSwgYmVmb3JlIHRoZSAnZGV2aWNlcmVhZHknIGV2ZW50IGhhcyBmaXJlZC5cbiAgcmV0dXJuIHR5cGVvZiBvcGVuRGF0YWJhc2UgIT09ICd1bmRlZmluZWQnIHx8XG4gICAgdHlwZW9mIFNRTGl0ZVBsdWdpbiAhPT0gJ3VuZGVmaW5lZCc7XG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICBlc2NhcGVCbG9iOiBlc2NhcGVCbG9iLFxuICB1bmVzY2FwZUJsb2I6IHVuZXNjYXBlQmxvYixcbiAgc3RyaW5naWZ5RG9jOiBzdHJpbmdpZnlEb2MsXG4gIHVuc3RyaW5naWZ5RG9jOiB1bnN0cmluZ2lmeURvYyxcbiAgcU1hcmtzOiBxTWFya3MsXG4gIHNlbGVjdDogc2VsZWN0LFxuICBjb21wYWN0UmV2czogY29tcGFjdFJldnMsXG4gIHVua25vd25FcnJvcjogdW5rbm93bkVycm9yLFxuICBnZXRTaXplOiBnZXRTaXplLFxuICBvcGVuREI6IG9wZW5EQixcbiAgdmFsaWQ6IHZhbGlkXG59OyIsIid1c2Ugc3RyaWN0JztcblxudmFyIHV0aWxzID0gcmVxdWlyZSgnLi4vLi4vdXRpbHMnKTtcbnZhciBtZXJnZSA9IHJlcXVpcmUoJy4uLy4uL21lcmdlJyk7XG52YXIgZXJyb3JzID0gcmVxdWlyZSgnLi4vLi4vZGVwcy9lcnJvcnMnKTtcbnZhciBwYXJzZUhleFN0cmluZyA9IHJlcXVpcmUoJy4uLy4uL2RlcHMvcGFyc2UtaGV4Jyk7XG5cbnZhciB3ZWJzcWxDb25zdGFudHMgPSByZXF1aXJlKCcuL3dlYnNxbC1jb25zdGFudHMnKTtcbnZhciB3ZWJzcWxVdGlscyA9IHJlcXVpcmUoJy4vd2Vic3FsLXV0aWxzJyk7XG52YXIgd2Vic3FsQnVsa0RvY3MgPSByZXF1aXJlKCcuL3dlYnNxbC1idWxrLWRvY3MnKTtcblxudmFyIEFEQVBURVJfVkVSU0lPTiA9IHdlYnNxbENvbnN0YW50cy5BREFQVEVSX1ZFUlNJT047XG52YXIgRE9DX1NUT1JFID0gd2Vic3FsQ29uc3RhbnRzLkRPQ19TVE9SRTtcbnZhciBCWV9TRVFfU1RPUkUgPSB3ZWJzcWxDb25zdGFudHMuQllfU0VRX1NUT1JFO1xudmFyIEFUVEFDSF9TVE9SRSA9IHdlYnNxbENvbnN0YW50cy5BVFRBQ0hfU1RPUkU7XG52YXIgTE9DQUxfU1RPUkUgPSB3ZWJzcWxDb25zdGFudHMuTE9DQUxfU1RPUkU7XG52YXIgTUVUQV9TVE9SRSA9IHdlYnNxbENvbnN0YW50cy5NRVRBX1NUT1JFO1xudmFyIEFUVEFDSF9BTkRfU0VRX1NUT1JFID0gd2Vic3FsQ29uc3RhbnRzLkFUVEFDSF9BTkRfU0VRX1NUT1JFO1xuXG52YXIgcU1hcmtzID0gd2Vic3FsVXRpbHMucU1hcmtzO1xudmFyIHN0cmluZ2lmeURvYyA9IHdlYnNxbFV0aWxzLnN0cmluZ2lmeURvYztcbnZhciB1bnN0cmluZ2lmeURvYyA9IHdlYnNxbFV0aWxzLnVuc3RyaW5naWZ5RG9jO1xudmFyIHNlbGVjdCA9IHdlYnNxbFV0aWxzLnNlbGVjdDtcbnZhciBjb21wYWN0UmV2cyA9IHdlYnNxbFV0aWxzLmNvbXBhY3RSZXZzO1xudmFyIHVua25vd25FcnJvciA9IHdlYnNxbFV0aWxzLnVua25vd25FcnJvcjtcbnZhciBnZXRTaXplID0gd2Vic3FsVXRpbHMuZ2V0U2l6ZTtcbnZhciBvcGVuREIgPSB3ZWJzcWxVdGlscy5vcGVuREI7XG5cbmZ1bmN0aW9uIGZldGNoQXR0YWNobWVudHNJZk5lY2Vzc2FyeShkb2MsIG9wdHMsIGFwaSwgdHhuLCBjYikge1xuICB2YXIgYXR0YWNobWVudHMgPSBPYmplY3Qua2V5cyhkb2MuX2F0dGFjaG1lbnRzIHx8IHt9KTtcbiAgaWYgKCFhdHRhY2htZW50cy5sZW5ndGgpIHtcbiAgICByZXR1cm4gY2IgJiYgY2IoKTtcbiAgfVxuICB2YXIgbnVtRG9uZSA9IDA7XG5cbiAgZnVuY3Rpb24gY2hlY2tEb25lKCkge1xuICAgIGlmICgrK251bURvbmUgPT09IGF0dGFjaG1lbnRzLmxlbmd0aCAmJiBjYikge1xuICAgICAgY2IoKTtcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBmZXRjaEF0dGFjaG1lbnQoZG9jLCBhdHQpIHtcbiAgICB2YXIgYXR0T2JqID0gZG9jLl9hdHRhY2htZW50c1thdHRdO1xuICAgIHZhciBhdHRPcHRzID0ge2VuY29kZTogdHJ1ZSwgY3R4OiB0eG59O1xuICAgIGFwaS5fZ2V0QXR0YWNobWVudChhdHRPYmosIGF0dE9wdHMsIGZ1bmN0aW9uIChfLCBiYXNlNjQpIHtcbiAgICAgIGRvYy5fYXR0YWNobWVudHNbYXR0XSA9IHV0aWxzLmV4dGVuZChcbiAgICAgICAgdXRpbHMucGljayhhdHRPYmosIFsnZGlnZXN0JywgJ2NvbnRlbnRfdHlwZSddKSxcbiAgICAgICAgeyBkYXRhOiBiYXNlNjQgfVxuICAgICAgKTtcbiAgICAgIGNoZWNrRG9uZSgpO1xuICAgIH0pO1xuICB9XG5cbiAgYXR0YWNobWVudHMuZm9yRWFjaChmdW5jdGlvbiAoYXR0KSB7XG4gICAgaWYgKG9wdHMuYXR0YWNobWVudHMgJiYgb3B0cy5pbmNsdWRlX2RvY3MpIHtcbiAgICAgIGZldGNoQXR0YWNobWVudChkb2MsIGF0dCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGRvYy5fYXR0YWNobWVudHNbYXR0XS5zdHViID0gdHJ1ZTtcbiAgICAgIGNoZWNrRG9uZSgpO1xuICAgIH1cbiAgfSk7XG59XG5cbnZhciBQT1VDSF9WRVJTSU9OID0gMTtcblxuLy8gdGhlc2UgaW5kZXhlcyBjb3ZlciB0aGUgZ3JvdW5kIGZvciBtb3N0IGFsbERvY3MgcXVlcmllc1xudmFyIEJZX1NFUV9TVE9SRV9ERUxFVEVEX0lOREVYX1NRTCA9XG4gICdDUkVBVEUgSU5ERVggSUYgTk9UIEVYSVNUUyBcXCdieS1zZXEtZGVsZXRlZC1pZHhcXCcgT04gJyArXG4gIEJZX1NFUV9TVE9SRSArICcgKHNlcSwgZGVsZXRlZCknO1xudmFyIEJZX1NFUV9TVE9SRV9ET0NfSURfUkVWX0lOREVYX1NRTCA9XG4gICdDUkVBVEUgVU5JUVVFIElOREVYIElGIE5PVCBFWElTVFMgXFwnYnktc2VxLWRvYy1pZC1yZXZcXCcgT04gJyArXG4gICAgQllfU0VRX1NUT1JFICsgJyAoZG9jX2lkLCByZXYpJztcbnZhciBET0NfU1RPUkVfV0lOTklOR1NFUV9JTkRFWF9TUUwgPVxuICAnQ1JFQVRFIElOREVYIElGIE5PVCBFWElTVFMgXFwnZG9jLXdpbm5pbmdzZXEtaWR4XFwnIE9OICcgK1xuICBET0NfU1RPUkUgKyAnICh3aW5uaW5nc2VxKSc7XG52YXIgQVRUQUNIX0FORF9TRVFfU1RPUkVfU0VRX0lOREVYX1NRTCA9XG4gICdDUkVBVEUgSU5ERVggSUYgTk9UIEVYSVNUUyBcXCdhdHRhY2gtc2VxLXNlcS1pZHhcXCcgT04gJyArXG4gICAgQVRUQUNIX0FORF9TRVFfU1RPUkUgKyAnIChzZXEpJztcbnZhciBBVFRBQ0hfQU5EX1NFUV9TVE9SRV9BVFRBQ0hfSU5ERVhfU1FMID1cbiAgJ0NSRUFURSBVTklRVUUgSU5ERVggSUYgTk9UIEVYSVNUUyBcXCdhdHRhY2gtc2VxLWRpZ2VzdC1pZHhcXCcgT04gJyArXG4gICAgQVRUQUNIX0FORF9TRVFfU1RPUkUgKyAnIChkaWdlc3QsIHNlcSknO1xuXG52YXIgRE9DX1NUT1JFX0FORF9CWV9TRVFfSk9JTkVSID0gQllfU0VRX1NUT1JFICtcbiAgJy5zZXEgPSAnICsgRE9DX1NUT1JFICsgJy53aW5uaW5nc2VxJztcblxudmFyIFNFTEVDVF9ET0NTID0gQllfU0VRX1NUT1JFICsgJy5zZXEgQVMgc2VxLCAnICtcbiAgQllfU0VRX1NUT1JFICsgJy5kZWxldGVkIEFTIGRlbGV0ZWQsICcgK1xuICBCWV9TRVFfU1RPUkUgKyAnLmpzb24gQVMgZGF0YSwgJyArXG4gIEJZX1NFUV9TVE9SRSArICcucmV2IEFTIHJldiwgJyArXG4gIERPQ19TVE9SRSArICcuanNvbiBBUyBtZXRhZGF0YSc7XG5cbmZ1bmN0aW9uIFdlYlNxbFBvdWNoKG9wdHMsIGNhbGxiYWNrKSB7XG4gIHZhciBhcGkgPSB0aGlzO1xuICB2YXIgaW5zdGFuY2VJZCA9IG51bGw7XG4gIHZhciBzaXplID0gZ2V0U2l6ZShvcHRzKTtcbiAgdmFyIGlkUmVxdWVzdHMgPSBbXTtcbiAgdmFyIGVuY29kaW5nO1xuXG4gIGFwaS5fZG9jQ291bnQgPSAtMTsgLy8gY2FjaGUgc3FsaXRlIGNvdW50KCopIGZvciBwZXJmb3JtYW5jZVxuICBhcGkuX25hbWUgPSBvcHRzLm5hbWU7XG5cbiAgdmFyIGRiID0gb3BlbkRCKHtcbiAgICBuYW1lOiBhcGkuX25hbWUsXG4gICAgdmVyc2lvbjogUE9VQ0hfVkVSU0lPTixcbiAgICBkZXNjcmlwdGlvbjogYXBpLl9uYW1lLFxuICAgIHNpemU6IHNpemUsXG4gICAgbG9jYXRpb246IG9wdHMubG9jYXRpb24sXG4gICAgY3JlYXRlRnJvbUxvY2F0aW9uOiBvcHRzLmNyZWF0ZUZyb21Mb2NhdGlvblxuICB9KTtcbiAgaWYgKCFkYikge1xuICAgIHJldHVybiBjYWxsYmFjayhlcnJvcnMuZXJyb3IoZXJyb3JzLlVOS05PV05fRVJST1IpKTtcbiAgfSBlbHNlIGlmICh0eXBlb2YgZGIucmVhZFRyYW5zYWN0aW9uICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgLy8gZG9lc24ndCBleGlzdCBpbiBzcWxpdGUgcGx1Z2luXG4gICAgZGIucmVhZFRyYW5zYWN0aW9uID0gZGIudHJhbnNhY3Rpb247XG4gIH1cblxuICBmdW5jdGlvbiBkYkNyZWF0ZWQoKSB7XG4gICAgLy8gbm90ZSB0aGUgZGIgbmFtZSBpbiBjYXNlIHRoZSBicm93c2VyIHVwZ3JhZGVzIHRvIGlkYlxuICAgIGlmICh1dGlscy5oYXNMb2NhbFN0b3JhZ2UoKSkge1xuICAgICAgd2luZG93LmxvY2FsU3RvcmFnZVsnX3BvdWNoX193ZWJzcWxkYl8nICsgYXBpLl9uYW1lXSA9IHRydWU7XG4gICAgfVxuICAgIGNhbGxiYWNrKG51bGwsIGFwaSk7XG4gIH1cblxuICAvLyBJbiB0aGlzIG1pZ3JhdGlvbiwgd2UgYWRkZWQgdGhlICdkZWxldGVkJyBhbmQgJ2xvY2FsJyBjb2x1bW5zIHRvIHRoZVxuICAvLyBieS1zZXEgYW5kIGRvYyBzdG9yZSB0YWJsZXMuXG4gIC8vIFRvIHByZXNlcnZlIGV4aXN0aW5nIHVzZXIgZGF0YSwgd2UgcmUtcHJvY2VzcyBhbGwgdGhlIGV4aXN0aW5nIEpTT05cbiAgLy8gYW5kIGFkZCB0aGVzZSB2YWx1ZXMuXG4gIC8vIENhbGxlZCBtaWdyYXRpb24yIGJlY2F1c2UgaXQgY29ycmVzcG9uZHMgdG8gYWRhcHRlciB2ZXJzaW9uIChkYl92ZXJzaW9uKSAjMlxuICBmdW5jdGlvbiBydW5NaWdyYXRpb24yKHR4LCBjYWxsYmFjaykge1xuICAgIC8vIGluZGV4IHVzZWQgZm9yIHRoZSBqb2luIGluIHRoZSBhbGxEb2NzIHF1ZXJ5XG4gICAgdHguZXhlY3V0ZVNxbChET0NfU1RPUkVfV0lOTklOR1NFUV9JTkRFWF9TUUwpO1xuXG4gICAgdHguZXhlY3V0ZVNxbCgnQUxURVIgVEFCTEUgJyArIEJZX1NFUV9TVE9SRSArXG4gICAgICAnIEFERCBDT0xVTU4gZGVsZXRlZCBUSU5ZSU5UKDEpIERFRkFVTFQgMCcsIFtdLCBmdW5jdGlvbiAoKSB7XG4gICAgICB0eC5leGVjdXRlU3FsKEJZX1NFUV9TVE9SRV9ERUxFVEVEX0lOREVYX1NRTCk7XG4gICAgICB0eC5leGVjdXRlU3FsKCdBTFRFUiBUQUJMRSAnICsgRE9DX1NUT1JFICtcbiAgICAgICAgJyBBREQgQ09MVU1OIGxvY2FsIFRJTllJTlQoMSkgREVGQVVMVCAwJywgW10sIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdHguZXhlY3V0ZVNxbCgnQ1JFQVRFIElOREVYIElGIE5PVCBFWElTVFMgXFwnZG9jLXN0b3JlLWxvY2FsLWlkeFxcJyBPTiAnICtcbiAgICAgICAgICBET0NfU1RPUkUgKyAnIChsb2NhbCwgaWQpJyk7XG5cbiAgICAgICAgdmFyIHNxbCA9ICdTRUxFQ1QgJyArIERPQ19TVE9SRSArICcud2lubmluZ3NlcSBBUyBzZXEsICcgKyBET0NfU1RPUkUgK1xuICAgICAgICAgICcuanNvbiBBUyBtZXRhZGF0YSBGUk9NICcgKyBCWV9TRVFfU1RPUkUgKyAnIEpPSU4gJyArIERPQ19TVE9SRSArXG4gICAgICAgICAgJyBPTiAnICsgQllfU0VRX1NUT1JFICsgJy5zZXEgPSAnICsgRE9DX1NUT1JFICsgJy53aW5uaW5nc2VxJztcblxuICAgICAgICB0eC5leGVjdXRlU3FsKHNxbCwgW10sIGZ1bmN0aW9uICh0eCwgcmVzdWx0KSB7XG5cbiAgICAgICAgICB2YXIgZGVsZXRlZCA9IFtdO1xuICAgICAgICAgIHZhciBsb2NhbCA9IFtdO1xuXG4gICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCByZXN1bHQucm93cy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgdmFyIGl0ZW0gPSByZXN1bHQucm93cy5pdGVtKGkpO1xuICAgICAgICAgICAgdmFyIHNlcSA9IGl0ZW0uc2VxO1xuICAgICAgICAgICAgdmFyIG1ldGFkYXRhID0gSlNPTi5wYXJzZShpdGVtLm1ldGFkYXRhKTtcbiAgICAgICAgICAgIGlmICh1dGlscy5pc0RlbGV0ZWQobWV0YWRhdGEpKSB7XG4gICAgICAgICAgICAgIGRlbGV0ZWQucHVzaChzZXEpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHV0aWxzLmlzTG9jYWxJZChtZXRhZGF0YS5pZCkpIHtcbiAgICAgICAgICAgICAgbG9jYWwucHVzaChtZXRhZGF0YS5pZCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICAgIHR4LmV4ZWN1dGVTcWwoJ1VQREFURSAnICsgRE9DX1NUT1JFICsgJ1NFVCBsb2NhbCA9IDEgV0hFUkUgaWQgSU4gJyArXG4gICAgICAgICAgICBxTWFya3MobG9jYWwubGVuZ3RoKSwgbG9jYWwsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHR4LmV4ZWN1dGVTcWwoJ1VQREFURSAnICsgQllfU0VRX1NUT1JFICtcbiAgICAgICAgICAgICAgJyBTRVQgZGVsZXRlZCA9IDEgV0hFUkUgc2VxIElOICcgK1xuICAgICAgICAgICAgICBxTWFya3MoZGVsZXRlZC5sZW5ndGgpLCBkZWxldGVkLCBjYWxsYmFjayk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICAvLyBpbiB0aGlzIG1pZ3JhdGlvbiwgd2UgbWFrZSBhbGwgdGhlIGxvY2FsIGRvY3MgdW52ZXJzaW9uZWRcbiAgZnVuY3Rpb24gcnVuTWlncmF0aW9uMyh0eCwgY2FsbGJhY2spIHtcbiAgICB2YXIgbG9jYWwgPSAnQ1JFQVRFIFRBQkxFIElGIE5PVCBFWElTVFMgJyArIExPQ0FMX1NUT1JFICtcbiAgICAgICcgKGlkIFVOSVFVRSwgcmV2LCBqc29uKSc7XG4gICAgdHguZXhlY3V0ZVNxbChsb2NhbCwgW10sIGZ1bmN0aW9uICgpIHtcbiAgICAgIHZhciBzcWwgPSAnU0VMRUNUICcgKyBET0NfU1RPUkUgKyAnLmlkIEFTIGlkLCAnICtcbiAgICAgICAgQllfU0VRX1NUT1JFICsgJy5qc29uIEFTIGRhdGEgJyArXG4gICAgICAgICdGUk9NICcgKyBCWV9TRVFfU1RPUkUgKyAnIEpPSU4gJyArXG4gICAgICAgIERPQ19TVE9SRSArICcgT04gJyArIEJZX1NFUV9TVE9SRSArICcuc2VxID0gJyArXG4gICAgICAgIERPQ19TVE9SRSArICcud2lubmluZ3NlcSBXSEVSRSBsb2NhbCA9IDEnO1xuICAgICAgdHguZXhlY3V0ZVNxbChzcWwsIFtdLCBmdW5jdGlvbiAodHgsIHJlcykge1xuICAgICAgICB2YXIgcm93cyA9IFtdO1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHJlcy5yb3dzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgcm93cy5wdXNoKHJlcy5yb3dzLml0ZW0oaSkpO1xuICAgICAgICB9XG4gICAgICAgIGZ1bmN0aW9uIGRvTmV4dCgpIHtcbiAgICAgICAgICBpZiAoIXJvd3MubGVuZ3RoKSB7XG4gICAgICAgICAgICByZXR1cm4gY2FsbGJhY2sodHgpO1xuICAgICAgICAgIH1cbiAgICAgICAgICB2YXIgcm93ID0gcm93cy5zaGlmdCgpO1xuICAgICAgICAgIHZhciByZXYgPSBKU09OLnBhcnNlKHJvdy5kYXRhKS5fcmV2O1xuICAgICAgICAgIHR4LmV4ZWN1dGVTcWwoJ0lOU0VSVCBJTlRPICcgKyBMT0NBTF9TVE9SRSArXG4gICAgICAgICAgICAgICcgKGlkLCByZXYsIGpzb24pIFZBTFVFUyAoPyw/LD8pJyxcbiAgICAgICAgICAgICAgW3Jvdy5pZCwgcmV2LCByb3cuZGF0YV0sIGZ1bmN0aW9uICh0eCkge1xuICAgICAgICAgICAgdHguZXhlY3V0ZVNxbCgnREVMRVRFIEZST00gJyArIERPQ19TVE9SRSArICcgV0hFUkUgaWQ9PycsXG4gICAgICAgICAgICAgICAgW3Jvdy5pZF0sIGZ1bmN0aW9uICh0eCkge1xuICAgICAgICAgICAgICB0eC5leGVjdXRlU3FsKCdERUxFVEUgRlJPTSAnICsgQllfU0VRX1NUT1JFICsgJyBXSEVSRSBzZXE9PycsXG4gICAgICAgICAgICAgICAgICBbcm93LnNlcV0sIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICBkb05leHQoKTtcbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgICBkb05leHQoKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgLy8gaW4gdGhpcyBtaWdyYXRpb24sIHdlIHJlbW92ZSBkb2NfaWRfcmV2IGFuZCBqdXN0IHVzZSByZXZcbiAgZnVuY3Rpb24gcnVuTWlncmF0aW9uNCh0eCwgY2FsbGJhY2spIHtcblxuICAgIGZ1bmN0aW9uIHVwZGF0ZVJvd3Mocm93cykge1xuICAgICAgZnVuY3Rpb24gZG9OZXh0KCkge1xuICAgICAgICBpZiAoIXJvd3MubGVuZ3RoKSB7XG4gICAgICAgICAgcmV0dXJuIGNhbGxiYWNrKHR4KTtcbiAgICAgICAgfVxuICAgICAgICB2YXIgcm93ID0gcm93cy5zaGlmdCgpO1xuICAgICAgICB2YXIgZG9jX2lkX3JldiA9IHBhcnNlSGV4U3RyaW5nKHJvdy5oZXgsIGVuY29kaW5nKTtcbiAgICAgICAgdmFyIGlkeCA9IGRvY19pZF9yZXYubGFzdEluZGV4T2YoJzo6Jyk7XG4gICAgICAgIHZhciBkb2NfaWQgPSBkb2NfaWRfcmV2LnN1YnN0cmluZygwLCBpZHgpO1xuICAgICAgICB2YXIgcmV2ID0gZG9jX2lkX3Jldi5zdWJzdHJpbmcoaWR4ICsgMik7XG4gICAgICAgIHZhciBzcWwgPSAnVVBEQVRFICcgKyBCWV9TRVFfU1RPUkUgK1xuICAgICAgICAgICcgU0VUIGRvY19pZD0/LCByZXY9PyBXSEVSRSBkb2NfaWRfcmV2PT8nO1xuICAgICAgICB0eC5leGVjdXRlU3FsKHNxbCwgW2RvY19pZCwgcmV2LCBkb2NfaWRfcmV2XSwgZnVuY3Rpb24gKCkge1xuICAgICAgICAgIGRvTmV4dCgpO1xuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICAgIGRvTmV4dCgpO1xuICAgIH1cblxuICAgIHZhciBzcWwgPSAnQUxURVIgVEFCTEUgJyArIEJZX1NFUV9TVE9SRSArICcgQUREIENPTFVNTiBkb2NfaWQnO1xuICAgIHR4LmV4ZWN1dGVTcWwoc3FsLCBbXSwgZnVuY3Rpb24gKHR4KSB7XG4gICAgICB2YXIgc3FsID0gJ0FMVEVSIFRBQkxFICcgKyBCWV9TRVFfU1RPUkUgKyAnIEFERCBDT0xVTU4gcmV2JztcbiAgICAgIHR4LmV4ZWN1dGVTcWwoc3FsLCBbXSwgZnVuY3Rpb24gKHR4KSB7XG4gICAgICAgIHR4LmV4ZWN1dGVTcWwoQllfU0VRX1NUT1JFX0RPQ19JRF9SRVZfSU5ERVhfU1FMLCBbXSwgZnVuY3Rpb24gKHR4KSB7XG4gICAgICAgICAgdmFyIHNxbCA9ICdTRUxFQ1QgaGV4KGRvY19pZF9yZXYpIGFzIGhleCBGUk9NICcgKyBCWV9TRVFfU1RPUkU7XG4gICAgICAgICAgdHguZXhlY3V0ZVNxbChzcWwsIFtdLCBmdW5jdGlvbiAodHgsIHJlcykge1xuICAgICAgICAgICAgdmFyIHJvd3MgPSBbXTtcbiAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcmVzLnJvd3MubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgICAgcm93cy5wdXNoKHJlcy5yb3dzLml0ZW0oaSkpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdXBkYXRlUm93cyhyb3dzKTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIC8vIGluIHRoaXMgbWlncmF0aW9uLCB3ZSBhZGQgdGhlIGF0dGFjaF9hbmRfc2VxIHRhYmxlXG4gIC8vIGZvciBpc3N1ZSAjMjgxOFxuICBmdW5jdGlvbiBydW5NaWdyYXRpb241KHR4LCBjYWxsYmFjaykge1xuXG4gICAgZnVuY3Rpb24gbWlncmF0ZUF0dHNBbmRTZXFzKHR4KSB7XG4gICAgICAvLyBuZWVkIHRvIGFjdHVhbGx5IHBvcHVsYXRlIHRoZSB0YWJsZS4gdGhpcyBpcyB0aGUgZXhwZW5zaXZlIHBhcnQsXG4gICAgICAvLyBzbyBhcyBhbiBvcHRpbWl6YXRpb24sIGNoZWNrIGZpcnN0IHRoYXQgdGhpcyBkYXRhYmFzZSBldmVuXG4gICAgICAvLyBjb250YWlucyBhdHRhY2htZW50c1xuICAgICAgdmFyIHNxbCA9ICdTRUxFQ1QgQ09VTlQoKikgQVMgY250IEZST00gJyArIEFUVEFDSF9TVE9SRTtcbiAgICAgIHR4LmV4ZWN1dGVTcWwoc3FsLCBbXSwgZnVuY3Rpb24gKHR4LCByZXMpIHtcbiAgICAgICAgdmFyIGNvdW50ID0gcmVzLnJvd3MuaXRlbSgwKS5jbnQ7XG4gICAgICAgIGlmICghY291bnQpIHtcbiAgICAgICAgICByZXR1cm4gY2FsbGJhY2sodHgpO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIG9mZnNldCA9IDA7XG4gICAgICAgIHZhciBwYWdlU2l6ZSA9IDEwO1xuICAgICAgICBmdW5jdGlvbiBuZXh0UGFnZSgpIHtcbiAgICAgICAgICB2YXIgc3FsID0gc2VsZWN0KFxuICAgICAgICAgICAgU0VMRUNUX0RPQ1MgKyAnLCAnICsgRE9DX1NUT1JFICsgJy5pZCBBUyBpZCcsXG4gICAgICAgICAgICBbRE9DX1NUT1JFLCBCWV9TRVFfU1RPUkVdLFxuICAgICAgICAgICAgRE9DX1NUT1JFX0FORF9CWV9TRVFfSk9JTkVSLFxuICAgICAgICAgICAgbnVsbCxcbiAgICAgICAgICAgIERPQ19TVE9SRSArICcuaWQgJ1xuICAgICAgICAgICk7XG4gICAgICAgICAgc3FsICs9ICcgTElNSVQgJyArIHBhZ2VTaXplICsgJyBPRkZTRVQgJyArIG9mZnNldDtcbiAgICAgICAgICBvZmZzZXQgKz0gcGFnZVNpemU7XG4gICAgICAgICAgdHguZXhlY3V0ZVNxbChzcWwsIFtdLCBmdW5jdGlvbiAodHgsIHJlcykge1xuICAgICAgICAgICAgaWYgKCFyZXMucm93cy5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgcmV0dXJuIGNhbGxiYWNrKHR4KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHZhciBkaWdlc3RTZXFzID0ge307XG4gICAgICAgICAgICBmdW5jdGlvbiBhZGREaWdlc3RTZXEoZGlnZXN0LCBzZXEpIHtcbiAgICAgICAgICAgICAgLy8gdW5pcSBkaWdlc3Qvc2VxIHBhaXJzLCBqdXN0IGluIGNhc2UgdGhlcmUgYXJlIGR1cHNcbiAgICAgICAgICAgICAgdmFyIHNlcXMgPSBkaWdlc3RTZXFzW2RpZ2VzdF0gPSAoZGlnZXN0U2Vxc1tkaWdlc3RdIHx8IFtdKTtcbiAgICAgICAgICAgICAgaWYgKHNlcXMuaW5kZXhPZihzZXEpID09PSAtMSkge1xuICAgICAgICAgICAgICAgIHNlcXMucHVzaChzZXEpO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHJlcy5yb3dzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICAgIHZhciByb3cgPSByZXMucm93cy5pdGVtKGkpO1xuICAgICAgICAgICAgICB2YXIgZG9jID0gdW5zdHJpbmdpZnlEb2Mocm93LmRhdGEsIHJvdy5pZCwgcm93LnJldik7XG4gICAgICAgICAgICAgIHZhciBhdHRzID0gT2JqZWN0LmtleXMoZG9jLl9hdHRhY2htZW50cyB8fCB7fSk7XG4gICAgICAgICAgICAgIGZvciAodmFyIGogPSAwOyBqIDwgYXR0cy5sZW5ndGg7IGorKykge1xuICAgICAgICAgICAgICAgIHZhciBhdHQgPSBkb2MuX2F0dGFjaG1lbnRzW2F0dHNbal1dO1xuICAgICAgICAgICAgICAgIGFkZERpZ2VzdFNlcShhdHQuZGlnZXN0LCByb3cuc2VxKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdmFyIGRpZ2VzdFNlcVBhaXJzID0gW107XG4gICAgICAgICAgICBPYmplY3Qua2V5cyhkaWdlc3RTZXFzKS5mb3JFYWNoKGZ1bmN0aW9uIChkaWdlc3QpIHtcbiAgICAgICAgICAgICAgdmFyIHNlcXMgPSBkaWdlc3RTZXFzW2RpZ2VzdF07XG4gICAgICAgICAgICAgIHNlcXMuZm9yRWFjaChmdW5jdGlvbiAoc2VxKSB7XG4gICAgICAgICAgICAgICAgZGlnZXN0U2VxUGFpcnMucHVzaChbZGlnZXN0LCBzZXFdKTtcbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIGlmICghZGlnZXN0U2VxUGFpcnMubGVuZ3RoKSB7XG4gICAgICAgICAgICAgIHJldHVybiBuZXh0UGFnZSgpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdmFyIG51bURvbmUgPSAwO1xuICAgICAgICAgICAgZGlnZXN0U2VxUGFpcnMuZm9yRWFjaChmdW5jdGlvbiAocGFpcikge1xuICAgICAgICAgICAgICB2YXIgc3FsID0gJ0lOU0VSVCBJTlRPICcgKyBBVFRBQ0hfQU5EX1NFUV9TVE9SRSArXG4gICAgICAgICAgICAgICAgJyAoZGlnZXN0LCBzZXEpIFZBTFVFUyAoPyw/KSc7XG4gICAgICAgICAgICAgIHR4LmV4ZWN1dGVTcWwoc3FsLCBwYWlyLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgaWYgKCsrbnVtRG9uZSA9PT0gZGlnZXN0U2VxUGFpcnMubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgICBuZXh0UGFnZSgpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgICBuZXh0UGFnZSgpO1xuICAgICAgfSk7XG4gICAgfVxuXG4gICAgdmFyIGF0dGFjaEFuZFJldiA9ICdDUkVBVEUgVEFCTEUgSUYgTk9UIEVYSVNUUyAnICtcbiAgICAgIEFUVEFDSF9BTkRfU0VRX1NUT1JFICsgJyAoZGlnZXN0LCBzZXEgSU5URUdFUiknO1xuICAgIHR4LmV4ZWN1dGVTcWwoYXR0YWNoQW5kUmV2LCBbXSwgZnVuY3Rpb24gKHR4KSB7XG4gICAgICB0eC5leGVjdXRlU3FsKFxuICAgICAgICBBVFRBQ0hfQU5EX1NFUV9TVE9SRV9BVFRBQ0hfSU5ERVhfU1FMLCBbXSwgZnVuY3Rpb24gKHR4KSB7XG4gICAgICAgICAgdHguZXhlY3V0ZVNxbChcbiAgICAgICAgICAgIEFUVEFDSF9BTkRfU0VRX1NUT1JFX1NFUV9JTkRFWF9TUUwsIFtdLFxuICAgICAgICAgICAgbWlncmF0ZUF0dHNBbmRTZXFzKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICAvLyBpbiB0aGlzIG1pZ3JhdGlvbiwgd2UgdXNlIGVzY2FwZUJsb2IoKSBhbmQgdW5lc2NhcGVCbG9iKClcbiAgLy8gaW5zdGVhZCBvZiByZWFkaW5nIG91dCB0aGUgYmluYXJ5IGFzIEhFWCwgd2hpY2ggaXMgc2xvd1xuICBmdW5jdGlvbiBydW5NaWdyYXRpb242KHR4LCBjYWxsYmFjaykge1xuICAgIHZhciBzcWwgPSAnQUxURVIgVEFCTEUgJyArIEFUVEFDSF9TVE9SRSArXG4gICAgICAnIEFERCBDT0xVTU4gZXNjYXBlZCBUSU5ZSU5UKDEpIERFRkFVTFQgMCc7XG4gICAgdHguZXhlY3V0ZVNxbChzcWwsIFtdLCBjYWxsYmFjayk7XG4gIH1cblxuICAvLyBpc3N1ZSAjMzEzNiwgaW4gdGhpcyBtaWdyYXRpb24gd2UgbmVlZCBhIFwibGF0ZXN0IHNlcVwiIGFzIHdlbGxcbiAgLy8gYXMgdGhlIFwid2lubmluZyBzZXFcIiBpbiB0aGUgZG9jIHN0b3JlXG4gIGZ1bmN0aW9uIHJ1bk1pZ3JhdGlvbjcodHgsIGNhbGxiYWNrKSB7XG4gICAgdmFyIHNxbCA9ICdBTFRFUiBUQUJMRSAnICsgRE9DX1NUT1JFICtcbiAgICAgICcgQUREIENPTFVNTiBtYXhfc2VxIElOVEVHRVInO1xuICAgIHR4LmV4ZWN1dGVTcWwoc3FsLCBbXSwgZnVuY3Rpb24gKHR4KSB7XG4gICAgICB2YXIgc3FsID0gJ1VQREFURSAnICsgRE9DX1NUT1JFICsgJyBTRVQgbWF4X3NlcT0oU0VMRUNUIE1BWChzZXEpIEZST00gJyArXG4gICAgICAgIEJZX1NFUV9TVE9SRSArICcgV0hFUkUgZG9jX2lkPWlkKSc7XG4gICAgICB0eC5leGVjdXRlU3FsKHNxbCwgW10sIGZ1bmN0aW9uICh0eCkge1xuICAgICAgICAvLyBhZGQgdW5pcXVlIGluZGV4IGFmdGVyIGZpbGxpbmcsIGVsc2Ugd2UnbGwgZ2V0IGEgY29uc3RyYWludFxuICAgICAgICAvLyBlcnJvciB3aGVuIHdlIGRvIHRoZSBBTFRFUiBUQUJMRVxuICAgICAgICB2YXIgc3FsID1cbiAgICAgICAgICAnQ1JFQVRFIFVOSVFVRSBJTkRFWCBJRiBOT1QgRVhJU1RTIFxcJ2RvYy1tYXgtc2VxLWlkeFxcJyBPTiAnICtcbiAgICAgICAgICBET0NfU1RPUkUgKyAnIChtYXhfc2VxKSc7XG4gICAgICAgIHR4LmV4ZWN1dGVTcWwoc3FsLCBbXSwgY2FsbGJhY2spO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBmdW5jdGlvbiBjaGVja0VuY29kaW5nKHR4LCBjYikge1xuICAgIC8vIFVURi04IG9uIGNocm9tZS9hbmRyb2lkLCBVVEYtMTYgb24gc2FmYXJpIDwgNy4xXG4gICAgdHguZXhlY3V0ZVNxbCgnU0VMRUNUIEhFWChcImFcIikgQVMgaGV4JywgW10sIGZ1bmN0aW9uICh0eCwgcmVzKSB7XG4gICAgICAgIHZhciBoZXggPSByZXMucm93cy5pdGVtKDApLmhleDtcbiAgICAgICAgZW5jb2RpbmcgPSBoZXgubGVuZ3RoID09PSAyID8gJ1VURi04JyA6ICdVVEYtMTYnO1xuICAgICAgICBjYigpO1xuICAgICAgfVxuICAgICk7XG4gIH1cblxuICBmdW5jdGlvbiBvbkdldEluc3RhbmNlSWQoKSB7XG4gICAgd2hpbGUgKGlkUmVxdWVzdHMubGVuZ3RoID4gMCkge1xuICAgICAgdmFyIGlkQ2FsbGJhY2sgPSBpZFJlcXVlc3RzLnBvcCgpO1xuICAgICAgaWRDYWxsYmFjayhudWxsLCBpbnN0YW5jZUlkKTtcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBvbkdldFZlcnNpb24odHgsIGRiVmVyc2lvbikge1xuICAgIGlmIChkYlZlcnNpb24gPT09IDApIHtcbiAgICAgIC8vIGluaXRpYWwgc2NoZW1hXG5cbiAgICAgIHZhciBtZXRhID0gJ0NSRUFURSBUQUJMRSBJRiBOT1QgRVhJU1RTICcgKyBNRVRBX1NUT1JFICtcbiAgICAgICAgJyAoZGJpZCwgZGJfdmVyc2lvbiBJTlRFR0VSKSc7XG4gICAgICB2YXIgYXR0YWNoID0gJ0NSRUFURSBUQUJMRSBJRiBOT1QgRVhJU1RTICcgKyBBVFRBQ0hfU1RPUkUgK1xuICAgICAgICAnIChkaWdlc3QgVU5JUVVFLCBlc2NhcGVkIFRJTllJTlQoMSksIGJvZHkgQkxPQiknO1xuICAgICAgdmFyIGF0dGFjaEFuZFJldiA9ICdDUkVBVEUgVEFCTEUgSUYgTk9UIEVYSVNUUyAnICtcbiAgICAgICAgQVRUQUNIX0FORF9TRVFfU1RPUkUgKyAnIChkaWdlc3QsIHNlcSBJTlRFR0VSKSc7XG4gICAgICAvLyBUT0RPOiBtaWdyYXRlIHdpbm5pbmdzZXEgdG8gSU5URUdFUlxuICAgICAgdmFyIGRvYyA9ICdDUkVBVEUgVEFCTEUgSUYgTk9UIEVYSVNUUyAnICsgRE9DX1NUT1JFICtcbiAgICAgICAgJyAoaWQgdW5pcXVlLCBqc29uLCB3aW5uaW5nc2VxLCBtYXhfc2VxIElOVEVHRVIgVU5JUVVFKSc7XG4gICAgICB2YXIgc2VxID0gJ0NSRUFURSBUQUJMRSBJRiBOT1QgRVhJU1RTICcgKyBCWV9TRVFfU1RPUkUgK1xuICAgICAgICAnIChzZXEgSU5URUdFUiBOT1QgTlVMTCBQUklNQVJZIEtFWSBBVVRPSU5DUkVNRU5ULCAnICtcbiAgICAgICAgJ2pzb24sIGRlbGV0ZWQgVElOWUlOVCgxKSwgZG9jX2lkLCByZXYpJztcbiAgICAgIHZhciBsb2NhbCA9ICdDUkVBVEUgVEFCTEUgSUYgTk9UIEVYSVNUUyAnICsgTE9DQUxfU1RPUkUgK1xuICAgICAgICAnIChpZCBVTklRVUUsIHJldiwganNvbiknO1xuXG4gICAgICAvLyBjcmVhdGVzXG4gICAgICB0eC5leGVjdXRlU3FsKGF0dGFjaCk7XG4gICAgICB0eC5leGVjdXRlU3FsKGxvY2FsKTtcbiAgICAgIHR4LmV4ZWN1dGVTcWwoYXR0YWNoQW5kUmV2LCBbXSwgZnVuY3Rpb24gKCkge1xuICAgICAgICB0eC5leGVjdXRlU3FsKEFUVEFDSF9BTkRfU0VRX1NUT1JFX1NFUV9JTkRFWF9TUUwpO1xuICAgICAgICB0eC5leGVjdXRlU3FsKEFUVEFDSF9BTkRfU0VRX1NUT1JFX0FUVEFDSF9JTkRFWF9TUUwpO1xuICAgICAgfSk7XG4gICAgICB0eC5leGVjdXRlU3FsKGRvYywgW10sIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdHguZXhlY3V0ZVNxbChET0NfU1RPUkVfV0lOTklOR1NFUV9JTkRFWF9TUUwpO1xuICAgICAgICB0eC5leGVjdXRlU3FsKHNlcSwgW10sIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICB0eC5leGVjdXRlU3FsKEJZX1NFUV9TVE9SRV9ERUxFVEVEX0lOREVYX1NRTCk7XG4gICAgICAgICAgdHguZXhlY3V0ZVNxbChCWV9TRVFfU1RPUkVfRE9DX0lEX1JFVl9JTkRFWF9TUUwpO1xuICAgICAgICAgIHR4LmV4ZWN1dGVTcWwobWV0YSwgW10sIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIC8vIG1hcmsgdGhlIGRiIHZlcnNpb24sIGFuZCBuZXcgZGJpZFxuICAgICAgICAgICAgdmFyIGluaXRTZXEgPSAnSU5TRVJUIElOVE8gJyArIE1FVEFfU1RPUkUgK1xuICAgICAgICAgICAgICAnIChkYl92ZXJzaW9uLCBkYmlkKSBWQUxVRVMgKD8sPyknO1xuICAgICAgICAgICAgaW5zdGFuY2VJZCA9IHV0aWxzLnV1aWQoKTtcbiAgICAgICAgICAgIHZhciBpbml0U2VxQXJncyA9IFtBREFQVEVSX1ZFUlNJT04sIGluc3RhbmNlSWRdO1xuICAgICAgICAgICAgdHguZXhlY3V0ZVNxbChpbml0U2VxLCBpbml0U2VxQXJncywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICBvbkdldEluc3RhbmNlSWQoKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH0gZWxzZSB7IC8vIHZlcnNpb24gPiAwXG5cbiAgICAgIHZhciBzZXR1cERvbmUgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHZhciBtaWdyYXRlZCA9IGRiVmVyc2lvbiA8IEFEQVBURVJfVkVSU0lPTjtcbiAgICAgICAgaWYgKG1pZ3JhdGVkKSB7XG4gICAgICAgICAgLy8gdXBkYXRlIHRoZSBkYiB2ZXJzaW9uIHdpdGhpbiB0aGlzIHRyYW5zYWN0aW9uXG4gICAgICAgICAgdHguZXhlY3V0ZVNxbCgnVVBEQVRFICcgKyBNRVRBX1NUT1JFICsgJyBTRVQgZGJfdmVyc2lvbiA9ICcgK1xuICAgICAgICAgICAgQURBUFRFUl9WRVJTSU9OKTtcbiAgICAgICAgfVxuICAgICAgICAvLyBub3RpZnkgZGIuaWQoKSBjYWxsZXJzXG4gICAgICAgIHZhciBzcWwgPSAnU0VMRUNUIGRiaWQgRlJPTSAnICsgTUVUQV9TVE9SRTtcbiAgICAgICAgdHguZXhlY3V0ZVNxbChzcWwsIFtdLCBmdW5jdGlvbiAodHgsIHJlc3VsdCkge1xuICAgICAgICAgIGluc3RhbmNlSWQgPSByZXN1bHQucm93cy5pdGVtKDApLmRiaWQ7XG4gICAgICAgICAgb25HZXRJbnN0YW5jZUlkKCk7XG4gICAgICAgIH0pO1xuICAgICAgfTtcblxuICAgICAgLy8gd291bGQgbG92ZSB0byB1c2UgcHJvbWlzZXMgaGVyZSwgYnV0IHRoZW4gd2Vic3FsXG4gICAgICAvLyBlbmRzIHRoZSB0cmFuc2FjdGlvbiBlYXJseVxuICAgICAgdmFyIHRhc2tzID0gW1xuICAgICAgICBydW5NaWdyYXRpb24yLFxuICAgICAgICBydW5NaWdyYXRpb24zLFxuICAgICAgICBydW5NaWdyYXRpb240LFxuICAgICAgICBydW5NaWdyYXRpb241LFxuICAgICAgICBydW5NaWdyYXRpb242LFxuICAgICAgICBydW5NaWdyYXRpb243LFxuICAgICAgICBzZXR1cERvbmVcbiAgICAgIF07XG5cbiAgICAgIC8vIHJ1biBlYWNoIG1pZ3JhdGlvbiBzZXF1ZW50aWFsbHlcbiAgICAgIHZhciBpID0gZGJWZXJzaW9uO1xuICAgICAgdmFyIG5leHRNaWdyYXRpb24gPSBmdW5jdGlvbiAodHgpIHtcbiAgICAgICAgdGFza3NbaSAtIDFdKHR4LCBuZXh0TWlncmF0aW9uKTtcbiAgICAgICAgaSsrO1xuICAgICAgfTtcbiAgICAgIG5leHRNaWdyYXRpb24odHgpO1xuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIHNldHVwKCkge1xuICAgIGRiLnRyYW5zYWN0aW9uKGZ1bmN0aW9uICh0eCkge1xuICAgICAgLy8gZmlyc3QgY2hlY2sgdGhlIGVuY29kaW5nXG4gICAgICBjaGVja0VuY29kaW5nKHR4LCBmdW5jdGlvbiAoKSB7XG4gICAgICAgIC8vIHRoZW4gZ2V0IHRoZSB2ZXJzaW9uXG4gICAgICAgIGZldGNoVmVyc2lvbih0eCk7XG4gICAgICB9KTtcbiAgICB9LCB1bmtub3duRXJyb3IoY2FsbGJhY2spLCBkYkNyZWF0ZWQpO1xuICB9XG5cbiAgZnVuY3Rpb24gZmV0Y2hWZXJzaW9uKHR4KSB7XG4gICAgdmFyIHNxbCA9ICdTRUxFQ1Qgc3FsIEZST00gc3FsaXRlX21hc3RlciBXSEVSRSB0YmxfbmFtZSA9ICcgKyBNRVRBX1NUT1JFO1xuICAgIHR4LmV4ZWN1dGVTcWwoc3FsLCBbXSwgZnVuY3Rpb24gKHR4LCByZXN1bHQpIHtcbiAgICAgIGlmICghcmVzdWx0LnJvd3MubGVuZ3RoKSB7XG4gICAgICAgIC8vIGRhdGFiYXNlIGhhc24ndCBldmVuIGJlZW4gY3JlYXRlZCB5ZXQgKHZlcnNpb24gMClcbiAgICAgICAgb25HZXRWZXJzaW9uKHR4LCAwKTtcbiAgICAgIH0gZWxzZSBpZiAoIS9kYl92ZXJzaW9uLy50ZXN0KHJlc3VsdC5yb3dzLml0ZW0oMCkuc3FsKSkge1xuICAgICAgICAvLyB0YWJsZSB3YXMgY3JlYXRlZCwgYnV0IHdpdGhvdXQgdGhlIG5ldyBkYl92ZXJzaW9uIGNvbHVtbixcbiAgICAgICAgLy8gc28gYWRkIGl0LlxuICAgICAgICB0eC5leGVjdXRlU3FsKCdBTFRFUiBUQUJMRSAnICsgTUVUQV9TVE9SRSArXG4gICAgICAgICAgJyBBREQgQ09MVU1OIGRiX3ZlcnNpb24gSU5URUdFUicsIFtdLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgLy8gYmVmb3JlIHZlcnNpb24gMiwgdGhpcyBjb2x1bW4gZGlkbid0IGV2ZW4gZXhpc3RcbiAgICAgICAgICBvbkdldFZlcnNpb24odHgsIDEpO1xuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSB7IC8vIGNvbHVtbiBleGlzdHMsIHdlIGNhbiBzYWZlbHkgZ2V0IGl0XG4gICAgICAgIHR4LmV4ZWN1dGVTcWwoJ1NFTEVDVCBkYl92ZXJzaW9uIEZST00gJyArIE1FVEFfU1RPUkUsXG4gICAgICAgICAgW10sIGZ1bmN0aW9uICh0eCwgcmVzdWx0KSB7XG4gICAgICAgICAgdmFyIGRiVmVyc2lvbiA9IHJlc3VsdC5yb3dzLml0ZW0oMCkuZGJfdmVyc2lvbjtcbiAgICAgICAgICBvbkdldFZlcnNpb24odHgsIGRiVmVyc2lvbik7XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgaWYgKHV0aWxzLmlzQ29yZG92YSgpKSB7XG4gICAgLy90byB3YWl0IHVudGlsIGN1c3RvbSBhcGkgaXMgbWFkZSBpbiBwb3VjaC5hZGFwdGVycyBiZWZvcmUgZG9pbmcgc2V0dXBcbiAgICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcihhcGkuX25hbWUgKyAnX3BvdWNoJywgZnVuY3Rpb24gY29yZG92YV9pbml0KCkge1xuICAgICAgd2luZG93LnJlbW92ZUV2ZW50TGlzdGVuZXIoYXBpLl9uYW1lICsgJ19wb3VjaCcsIGNvcmRvdmFfaW5pdCwgZmFsc2UpO1xuICAgICAgc2V0dXAoKTtcbiAgICB9LCBmYWxzZSk7XG4gIH0gZWxzZSB7XG4gICAgc2V0dXAoKTtcbiAgfVxuXG4gIGFwaS50eXBlID0gZnVuY3Rpb24gKCkge1xuICAgIHJldHVybiAnd2Vic3FsJztcbiAgfTtcblxuICBhcGkuX2lkID0gdXRpbHMudG9Qcm9taXNlKGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgIGNhbGxiYWNrKG51bGwsIGluc3RhbmNlSWQpO1xuICB9KTtcblxuICBhcGkuX2luZm8gPSBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICBkYi5yZWFkVHJhbnNhY3Rpb24oZnVuY3Rpb24gKHR4KSB7XG4gICAgICBjb3VudERvY3ModHgsIGZ1bmN0aW9uIChkb2NDb3VudCkge1xuICAgICAgICB2YXIgc3FsID0gJ1NFTEVDVCBNQVgoc2VxKSBBUyBzZXEgRlJPTSAnICsgQllfU0VRX1NUT1JFO1xuICAgICAgICB0eC5leGVjdXRlU3FsKHNxbCwgW10sIGZ1bmN0aW9uICh0eCwgcmVzKSB7XG4gICAgICAgICAgdmFyIHVwZGF0ZVNlcSA9IHJlcy5yb3dzLml0ZW0oMCkuc2VxIHx8IDA7XG4gICAgICAgICAgY2FsbGJhY2sobnVsbCwge1xuICAgICAgICAgICAgZG9jX2NvdW50OiBkb2NDb3VudCxcbiAgICAgICAgICAgIHVwZGF0ZV9zZXE6IHVwZGF0ZVNlcSxcbiAgICAgICAgICAgIC8vIGZvciBkZWJ1Z2dpbmdcbiAgICAgICAgICAgIHNxbGl0ZV9wbHVnaW46IGRiLl9zcWxpdGVQbHVnaW4sXG4gICAgICAgICAgICB3ZWJzcWxfZW5jb2Rpbmc6IGVuY29kaW5nXG4gICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfSwgdW5rbm93bkVycm9yKGNhbGxiYWNrKSk7XG4gIH07XG5cbiAgYXBpLl9idWxrRG9jcyA9IGZ1bmN0aW9uIChyZXEsIG9wdHMsIGNhbGxiYWNrKSB7XG4gICAgd2Vic3FsQnVsa0RvY3MocmVxLCBvcHRzLCBhcGksIGRiLCBXZWJTcWxQb3VjaC5DaGFuZ2VzLCBjYWxsYmFjayk7XG4gIH07XG5cbiAgYXBpLl9nZXQgPSBmdW5jdGlvbiAoaWQsIG9wdHMsIGNhbGxiYWNrKSB7XG4gICAgb3B0cyA9IHV0aWxzLmNsb25lKG9wdHMpO1xuICAgIHZhciBkb2M7XG4gICAgdmFyIG1ldGFkYXRhO1xuICAgIHZhciBlcnI7XG4gICAgaWYgKCFvcHRzLmN0eCkge1xuICAgICAgZGIucmVhZFRyYW5zYWN0aW9uKGZ1bmN0aW9uICh0eG4pIHtcbiAgICAgICAgb3B0cy5jdHggPSB0eG47XG4gICAgICAgIGFwaS5fZ2V0KGlkLCBvcHRzLCBjYWxsYmFjayk7XG4gICAgICB9KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdmFyIHR4ID0gb3B0cy5jdHg7XG5cbiAgICBmdW5jdGlvbiBmaW5pc2goKSB7XG4gICAgICBjYWxsYmFjayhlcnIsIHtkb2M6IGRvYywgbWV0YWRhdGE6IG1ldGFkYXRhLCBjdHg6IHR4fSk7XG4gICAgfVxuXG4gICAgdmFyIHNxbDtcbiAgICB2YXIgc3FsQXJncztcbiAgICBpZiAob3B0cy5yZXYpIHtcbiAgICAgIHNxbCA9IHNlbGVjdChcbiAgICAgICAgU0VMRUNUX0RPQ1MsXG4gICAgICAgIFtET0NfU1RPUkUsIEJZX1NFUV9TVE9SRV0sXG4gICAgICAgIERPQ19TVE9SRSArICcuaWQ9JyArIEJZX1NFUV9TVE9SRSArICcuZG9jX2lkJyxcbiAgICAgICAgW0JZX1NFUV9TVE9SRSArICcuZG9jX2lkPT8nLCBCWV9TRVFfU1RPUkUgKyAnLnJldj0/J10pO1xuICAgICAgc3FsQXJncyA9IFtpZCwgb3B0cy5yZXZdO1xuICAgIH0gZWxzZSB7XG4gICAgICBzcWwgPSBzZWxlY3QoXG4gICAgICAgIFNFTEVDVF9ET0NTLFxuICAgICAgICBbRE9DX1NUT1JFLCBCWV9TRVFfU1RPUkVdLFxuICAgICAgICBET0NfU1RPUkVfQU5EX0JZX1NFUV9KT0lORVIsXG4gICAgICAgIERPQ19TVE9SRSArICcuaWQ9PycpO1xuICAgICAgc3FsQXJncyA9IFtpZF07XG4gICAgfVxuICAgIHR4LmV4ZWN1dGVTcWwoc3FsLCBzcWxBcmdzLCBmdW5jdGlvbiAoYSwgcmVzdWx0cykge1xuICAgICAgaWYgKCFyZXN1bHRzLnJvd3MubGVuZ3RoKSB7XG4gICAgICAgIGVyciA9IGVycm9ycy5lcnJvcihlcnJvcnMuTUlTU0lOR19ET0MsICdtaXNzaW5nJyk7XG4gICAgICAgIHJldHVybiBmaW5pc2goKTtcbiAgICAgIH1cbiAgICAgIHZhciBpdGVtID0gcmVzdWx0cy5yb3dzLml0ZW0oMCk7XG4gICAgICBtZXRhZGF0YSA9IHV0aWxzLnNhZmVKc29uUGFyc2UoaXRlbS5tZXRhZGF0YSk7XG4gICAgICBpZiAoaXRlbS5kZWxldGVkICYmICFvcHRzLnJldikge1xuICAgICAgICBlcnIgPSBlcnJvcnMuZXJyb3IoZXJyb3JzLk1JU1NJTkdfRE9DLCAnZGVsZXRlZCcpO1xuICAgICAgICByZXR1cm4gZmluaXNoKCk7XG4gICAgICB9XG4gICAgICBkb2MgPSB1bnN0cmluZ2lmeURvYyhpdGVtLmRhdGEsIG1ldGFkYXRhLmlkLCBpdGVtLnJldik7XG4gICAgICBmaW5pc2goKTtcbiAgICB9KTtcbiAgfTtcblxuICBmdW5jdGlvbiBjb3VudERvY3ModHgsIGNhbGxiYWNrKSB7XG5cbiAgICBpZiAoYXBpLl9kb2NDb3VudCAhPT0gLTEpIHtcbiAgICAgIHJldHVybiBjYWxsYmFjayhhcGkuX2RvY0NvdW50KTtcbiAgICB9XG5cbiAgICAvLyBjb3VudCB0aGUgdG90YWwgcm93c1xuICAgIHZhciBzcWwgPSBzZWxlY3QoXG4gICAgICAnQ09VTlQoJyArIERPQ19TVE9SRSArICcuaWQpIEFTIFxcJ251bVxcJycsXG4gICAgICBbRE9DX1NUT1JFLCBCWV9TRVFfU1RPUkVdLFxuICAgICAgRE9DX1NUT1JFX0FORF9CWV9TRVFfSk9JTkVSLFxuICAgICAgQllfU0VRX1NUT1JFICsgJy5kZWxldGVkPTAnKTtcblxuICAgIHR4LmV4ZWN1dGVTcWwoc3FsLCBbXSwgZnVuY3Rpb24gKHR4LCByZXN1bHQpIHtcbiAgICAgIGFwaS5fZG9jQ291bnQgPSByZXN1bHQucm93cy5pdGVtKDApLm51bTtcbiAgICAgIGNhbGxiYWNrKGFwaS5fZG9jQ291bnQpO1xuICAgIH0pO1xuICB9XG5cbiAgYXBpLl9hbGxEb2NzID0gZnVuY3Rpb24gKG9wdHMsIGNhbGxiYWNrKSB7XG4gICAgdmFyIHJlc3VsdHMgPSBbXTtcbiAgICB2YXIgdG90YWxSb3dzO1xuXG4gICAgdmFyIHN0YXJ0ID0gJ3N0YXJ0a2V5JyBpbiBvcHRzID8gb3B0cy5zdGFydGtleSA6IGZhbHNlO1xuICAgIHZhciBlbmQgPSAnZW5ka2V5JyBpbiBvcHRzID8gb3B0cy5lbmRrZXkgOiBmYWxzZTtcbiAgICB2YXIga2V5ID0gJ2tleScgaW4gb3B0cyA/IG9wdHMua2V5IDogZmFsc2U7XG4gICAgdmFyIGRlc2NlbmRpbmcgPSAnZGVzY2VuZGluZycgaW4gb3B0cyA/IG9wdHMuZGVzY2VuZGluZyA6IGZhbHNlO1xuICAgIHZhciBsaW1pdCA9ICdsaW1pdCcgaW4gb3B0cyA/IG9wdHMubGltaXQgOiAtMTtcbiAgICB2YXIgb2Zmc2V0ID0gJ3NraXAnIGluIG9wdHMgPyBvcHRzLnNraXAgOiAwO1xuICAgIHZhciBpbmNsdXNpdmVFbmQgPSBvcHRzLmluY2x1c2l2ZV9lbmQgIT09IGZhbHNlO1xuXG4gICAgdmFyIHNxbEFyZ3MgPSBbXTtcbiAgICB2YXIgY3JpdGVyaWEgPSBbXTtcblxuICAgIGlmIChrZXkgIT09IGZhbHNlKSB7XG4gICAgICBjcml0ZXJpYS5wdXNoKERPQ19TVE9SRSArICcuaWQgPSA/Jyk7XG4gICAgICBzcWxBcmdzLnB1c2goa2V5KTtcbiAgICB9IGVsc2UgaWYgKHN0YXJ0ICE9PSBmYWxzZSB8fCBlbmQgIT09IGZhbHNlKSB7XG4gICAgICBpZiAoc3RhcnQgIT09IGZhbHNlKSB7XG4gICAgICAgIGNyaXRlcmlhLnB1c2goRE9DX1NUT1JFICsgJy5pZCAnICsgKGRlc2NlbmRpbmcgPyAnPD0nIDogJz49JykgKyAnID8nKTtcbiAgICAgICAgc3FsQXJncy5wdXNoKHN0YXJ0KTtcbiAgICAgIH1cbiAgICAgIGlmIChlbmQgIT09IGZhbHNlKSB7XG4gICAgICAgIHZhciBjb21wYXJhdG9yID0gZGVzY2VuZGluZyA/ICc+JyA6ICc8JztcbiAgICAgICAgaWYgKGluY2x1c2l2ZUVuZCkge1xuICAgICAgICAgIGNvbXBhcmF0b3IgKz0gJz0nO1xuICAgICAgICB9XG4gICAgICAgIGNyaXRlcmlhLnB1c2goRE9DX1NUT1JFICsgJy5pZCAnICsgY29tcGFyYXRvciArICcgPycpO1xuICAgICAgICBzcWxBcmdzLnB1c2goZW5kKTtcbiAgICAgIH1cbiAgICAgIGlmIChrZXkgIT09IGZhbHNlKSB7XG4gICAgICAgIGNyaXRlcmlhLnB1c2goRE9DX1NUT1JFICsgJy5pZCA9ID8nKTtcbiAgICAgICAgc3FsQXJncy5wdXNoKGtleSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKG9wdHMuZGVsZXRlZCAhPT0gJ29rJykge1xuICAgICAgLy8gcmVwb3J0IGRlbGV0ZWQgaWYga2V5cyBhcmUgc3BlY2lmaWVkXG4gICAgICBjcml0ZXJpYS5wdXNoKEJZX1NFUV9TVE9SRSArICcuZGVsZXRlZCA9IDAnKTtcbiAgICB9XG5cbiAgICBkYi5yZWFkVHJhbnNhY3Rpb24oZnVuY3Rpb24gKHR4KSB7XG5cbiAgICAgIC8vIGZpcnN0IGNvdW50IHVwIHRoZSB0b3RhbCByb3dzXG4gICAgICBjb3VudERvY3ModHgsIGZ1bmN0aW9uIChjb3VudCkge1xuICAgICAgICB0b3RhbFJvd3MgPSBjb3VudDtcblxuICAgICAgICBpZiAobGltaXQgPT09IDApIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICAvLyB0aGVuIGFjdHVhbGx5IGZldGNoIHRoZSBkb2N1bWVudHNcbiAgICAgICAgdmFyIHNxbCA9IHNlbGVjdChcbiAgICAgICAgICBTRUxFQ1RfRE9DUyxcbiAgICAgICAgICBbRE9DX1NUT1JFLCBCWV9TRVFfU1RPUkVdLFxuICAgICAgICAgIERPQ19TVE9SRV9BTkRfQllfU0VRX0pPSU5FUixcbiAgICAgICAgICBjcml0ZXJpYSxcbiAgICAgICAgICBET0NfU1RPUkUgKyAnLmlkICcgKyAoZGVzY2VuZGluZyA/ICdERVNDJyA6ICdBU0MnKVxuICAgICAgICAgICk7XG4gICAgICAgIHNxbCArPSAnIExJTUlUICcgKyBsaW1pdCArICcgT0ZGU0VUICcgKyBvZmZzZXQ7XG5cbiAgICAgICAgdHguZXhlY3V0ZVNxbChzcWwsIHNxbEFyZ3MsIGZ1bmN0aW9uICh0eCwgcmVzdWx0KSB7XG4gICAgICAgICAgZm9yICh2YXIgaSA9IDAsIGwgPSByZXN1bHQucm93cy5sZW5ndGg7IGkgPCBsOyBpKyspIHtcbiAgICAgICAgICAgIHZhciBpdGVtID0gcmVzdWx0LnJvd3MuaXRlbShpKTtcbiAgICAgICAgICAgIHZhciBtZXRhZGF0YSA9IHV0aWxzLnNhZmVKc29uUGFyc2UoaXRlbS5tZXRhZGF0YSk7XG4gICAgICAgICAgICB2YXIgaWQgPSBtZXRhZGF0YS5pZDtcbiAgICAgICAgICAgIHZhciBkYXRhID0gdW5zdHJpbmdpZnlEb2MoaXRlbS5kYXRhLCBpZCwgaXRlbS5yZXYpO1xuICAgICAgICAgICAgdmFyIHdpbm5pbmdSZXYgPSBkYXRhLl9yZXY7XG4gICAgICAgICAgICB2YXIgZG9jID0ge1xuICAgICAgICAgICAgICBpZDogaWQsXG4gICAgICAgICAgICAgIGtleTogaWQsXG4gICAgICAgICAgICAgIHZhbHVlOiB7cmV2OiB3aW5uaW5nUmV2fVxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIGlmIChvcHRzLmluY2x1ZGVfZG9jcykge1xuICAgICAgICAgICAgICBkb2MuZG9jID0gZGF0YTtcbiAgICAgICAgICAgICAgZG9jLmRvYy5fcmV2ID0gd2lubmluZ1JldjtcbiAgICAgICAgICAgICAgaWYgKG9wdHMuY29uZmxpY3RzKSB7XG4gICAgICAgICAgICAgICAgZG9jLmRvYy5fY29uZmxpY3RzID0gbWVyZ2UuY29sbGVjdENvbmZsaWN0cyhtZXRhZGF0YSk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgZmV0Y2hBdHRhY2htZW50c0lmTmVjZXNzYXJ5KGRvYy5kb2MsIG9wdHMsIGFwaSwgdHgpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGl0ZW0uZGVsZXRlZCkge1xuICAgICAgICAgICAgICBpZiAob3B0cy5kZWxldGVkID09PSAnb2snKSB7XG4gICAgICAgICAgICAgICAgZG9jLnZhbHVlLmRlbGV0ZWQgPSB0cnVlO1xuICAgICAgICAgICAgICAgIGRvYy5kb2MgPSBudWxsO1xuICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXN1bHRzLnB1c2goZG9jKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfSwgdW5rbm93bkVycm9yKGNhbGxiYWNrKSwgZnVuY3Rpb24gKCkge1xuICAgICAgY2FsbGJhY2sobnVsbCwge1xuICAgICAgICB0b3RhbF9yb3dzOiB0b3RhbFJvd3MsXG4gICAgICAgIG9mZnNldDogb3B0cy5za2lwLFxuICAgICAgICByb3dzOiByZXN1bHRzXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfTtcblxuICBhcGkuX2NoYW5nZXMgPSBmdW5jdGlvbiAob3B0cykge1xuICAgIG9wdHMgPSB1dGlscy5jbG9uZShvcHRzKTtcblxuICAgIGlmIChvcHRzLmNvbnRpbnVvdXMpIHtcbiAgICAgIHZhciBpZCA9IGFwaS5fbmFtZSArICc6JyArIHV0aWxzLnV1aWQoKTtcbiAgICAgIFdlYlNxbFBvdWNoLkNoYW5nZXMuYWRkTGlzdGVuZXIoYXBpLl9uYW1lLCBpZCwgYXBpLCBvcHRzKTtcbiAgICAgIFdlYlNxbFBvdWNoLkNoYW5nZXMubm90aWZ5KGFwaS5fbmFtZSk7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBjYW5jZWw6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICBXZWJTcWxQb3VjaC5DaGFuZ2VzLnJlbW92ZUxpc3RlbmVyKGFwaS5fbmFtZSwgaWQpO1xuICAgICAgICB9XG4gICAgICB9O1xuICAgIH1cblxuICAgIHZhciBkZXNjZW5kaW5nID0gb3B0cy5kZXNjZW5kaW5nO1xuXG4gICAgLy8gSWdub3JlIHRoZSBgc2luY2VgIHBhcmFtZXRlciB3aGVuIGBkZXNjZW5kaW5nYCBpcyB0cnVlXG4gICAgb3B0cy5zaW5jZSA9IG9wdHMuc2luY2UgJiYgIWRlc2NlbmRpbmcgPyBvcHRzLnNpbmNlIDogMDtcblxuICAgIHZhciBsaW1pdCA9ICdsaW1pdCcgaW4gb3B0cyA/IG9wdHMubGltaXQgOiAtMTtcbiAgICBpZiAobGltaXQgPT09IDApIHtcbiAgICAgIGxpbWl0ID0gMTsgLy8gcGVyIENvdWNoREIgX2NoYW5nZXMgc3BlY1xuICAgIH1cblxuICAgIHZhciByZXR1cm5Eb2NzO1xuICAgIGlmICgncmV0dXJuRG9jcycgaW4gb3B0cykge1xuICAgICAgcmV0dXJuRG9jcyA9IG9wdHMucmV0dXJuRG9jcztcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuRG9jcyA9IHRydWU7XG4gICAgfVxuICAgIHZhciByZXN1bHRzID0gW107XG4gICAgdmFyIG51bVJlc3VsdHMgPSAwO1xuXG4gICAgZnVuY3Rpb24gZmV0Y2hDaGFuZ2VzKCkge1xuXG4gICAgICB2YXIgc2VsZWN0U3RtdCA9XG4gICAgICAgIERPQ19TVE9SRSArICcuanNvbiBBUyBtZXRhZGF0YSwgJyArXG4gICAgICAgIERPQ19TVE9SRSArICcubWF4X3NlcSBBUyBtYXhTZXEsICcgK1xuICAgICAgICBCWV9TRVFfU1RPUkUgKyAnLmpzb24gQVMgd2lubmluZ0RvYywgJyArXG4gICAgICAgIEJZX1NFUV9TVE9SRSArICcucmV2IEFTIHdpbm5pbmdSZXYgJztcblxuICAgICAgdmFyIGZyb20gPSBET0NfU1RPUkUgKyAnIEpPSU4gJyArIEJZX1NFUV9TVE9SRTtcblxuICAgICAgdmFyIGpvaW5lciA9IERPQ19TVE9SRSArICcuaWQ9JyArIEJZX1NFUV9TVE9SRSArICcuZG9jX2lkJyArXG4gICAgICAgICcgQU5EICcgKyBET0NfU1RPUkUgKyAnLndpbm5pbmdzZXE9JyArIEJZX1NFUV9TVE9SRSArICcuc2VxJztcblxuICAgICAgdmFyIGNyaXRlcmlhID0gWydtYXhTZXEgPiA/J107XG4gICAgICB2YXIgc3FsQXJncyA9IFtvcHRzLnNpbmNlXTtcblxuICAgICAgaWYgKG9wdHMuZG9jX2lkcykge1xuICAgICAgICBjcml0ZXJpYS5wdXNoKERPQ19TVE9SRSArICcuaWQgSU4gJyArIHFNYXJrcyhvcHRzLmRvY19pZHMubGVuZ3RoKSk7XG4gICAgICAgIHNxbEFyZ3MgPSBzcWxBcmdzLmNvbmNhdChvcHRzLmRvY19pZHMpO1xuICAgICAgfVxuXG4gICAgICB2YXIgb3JkZXJCeSA9ICdtYXhTZXEgJyArIChkZXNjZW5kaW5nID8gJ0RFU0MnIDogJ0FTQycpO1xuXG4gICAgICB2YXIgc3FsID0gc2VsZWN0KHNlbGVjdFN0bXQsIGZyb20sIGpvaW5lciwgY3JpdGVyaWEsIG9yZGVyQnkpO1xuXG4gICAgICB2YXIgZmlsdGVyID0gdXRpbHMuZmlsdGVyQ2hhbmdlKG9wdHMpO1xuICAgICAgaWYgKCFvcHRzLnZpZXcgJiYgIW9wdHMuZmlsdGVyKSB7XG4gICAgICAgIC8vIHdlIGNhbiBqdXN0IGxpbWl0IGluIHRoZSBxdWVyeVxuICAgICAgICBzcWwgKz0gJyBMSU1JVCAnICsgbGltaXQ7XG4gICAgICB9XG5cbiAgICAgIHZhciBsYXN0U2VxID0gb3B0cy5zaW5jZSB8fCAwO1xuICAgICAgZGIucmVhZFRyYW5zYWN0aW9uKGZ1bmN0aW9uICh0eCkge1xuICAgICAgICB0eC5leGVjdXRlU3FsKHNxbCwgc3FsQXJncywgZnVuY3Rpb24gKHR4LCByZXN1bHQpIHtcbiAgICAgICAgICBmdW5jdGlvbiByZXBvcnRDaGFuZ2UoY2hhbmdlKSB7XG4gICAgICAgICAgICByZXR1cm4gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICBvcHRzLm9uQ2hhbmdlKGNoYW5nZSk7XG4gICAgICAgICAgICB9O1xuICAgICAgICAgIH1cbiAgICAgICAgICBmb3IgKHZhciBpID0gMCwgbCA9IHJlc3VsdC5yb3dzLmxlbmd0aDsgaSA8IGw7IGkrKykge1xuICAgICAgICAgICAgdmFyIGl0ZW0gPSByZXN1bHQucm93cy5pdGVtKGkpO1xuICAgICAgICAgICAgdmFyIG1ldGFkYXRhID0gdXRpbHMuc2FmZUpzb25QYXJzZShpdGVtLm1ldGFkYXRhKTtcbiAgICAgICAgICAgIGxhc3RTZXEgPSBpdGVtLm1heFNlcTtcblxuICAgICAgICAgICAgdmFyIGRvYyA9IHVuc3RyaW5naWZ5RG9jKGl0ZW0ud2lubmluZ0RvYywgbWV0YWRhdGEuaWQsXG4gICAgICAgICAgICAgIGl0ZW0ud2lubmluZ1Jldik7XG4gICAgICAgICAgICB2YXIgY2hhbmdlID0gb3B0cy5wcm9jZXNzQ2hhbmdlKGRvYywgbWV0YWRhdGEsIG9wdHMpO1xuICAgICAgICAgICAgY2hhbmdlLnNlcSA9IGl0ZW0ubWF4U2VxO1xuICAgICAgICAgICAgaWYgKGZpbHRlcihjaGFuZ2UpKSB7XG4gICAgICAgICAgICAgIG51bVJlc3VsdHMrKztcbiAgICAgICAgICAgICAgaWYgKHJldHVybkRvY3MpIHtcbiAgICAgICAgICAgICAgICByZXN1bHRzLnB1c2goY2hhbmdlKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAvLyBwcm9jZXNzIHRoZSBhdHRhY2htZW50IGltbWVkaWF0ZWx5XG4gICAgICAgICAgICAgIC8vIGZvciB0aGUgYmVuZWZpdCBvZiBsaXZlIGxpc3RlbmVyc1xuICAgICAgICAgICAgICBpZiAob3B0cy5hdHRhY2htZW50cyAmJiBvcHRzLmluY2x1ZGVfZG9jcykge1xuICAgICAgICAgICAgICAgIGZldGNoQXR0YWNobWVudHNJZk5lY2Vzc2FyeShkb2MsIG9wdHMsIGFwaSwgdHgsXG4gICAgICAgICAgICAgICAgICByZXBvcnRDaGFuZ2UoY2hhbmdlKSk7XG4gICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgcmVwb3J0Q2hhbmdlKGNoYW5nZSkoKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKG51bVJlc3VsdHMgPT09IGxpbWl0KSB7XG4gICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9LCB1bmtub3duRXJyb3Iob3B0cy5jb21wbGV0ZSksIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgaWYgKCFvcHRzLmNvbnRpbnVvdXMpIHtcbiAgICAgICAgICBvcHRzLmNvbXBsZXRlKG51bGwsIHtcbiAgICAgICAgICAgIHJlc3VsdHM6IHJlc3VsdHMsXG4gICAgICAgICAgICBsYXN0X3NlcTogbGFzdFNlcVxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBmZXRjaENoYW5nZXMoKTtcbiAgfTtcblxuICBhcGkuX2Nsb3NlID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgLy9XZWJTUUwgZGF0YWJhc2VzIGRvIG5vdCBuZWVkIHRvIGJlIGNsb3NlZFxuICAgIGNhbGxiYWNrKCk7XG4gIH07XG5cbiAgYXBpLl9nZXRBdHRhY2htZW50ID0gZnVuY3Rpb24gKGF0dGFjaG1lbnQsIG9wdHMsIGNhbGxiYWNrKSB7XG4gICAgdmFyIHJlcztcbiAgICB2YXIgdHggPSBvcHRzLmN0eDtcbiAgICB2YXIgZGlnZXN0ID0gYXR0YWNobWVudC5kaWdlc3Q7XG4gICAgdmFyIHR5cGUgPSBhdHRhY2htZW50LmNvbnRlbnRfdHlwZTtcbiAgICB2YXIgc3FsID0gJ1NFTEVDVCBlc2NhcGVkLCAnICtcbiAgICAgICdDQVNFIFdIRU4gZXNjYXBlZCA9IDEgVEhFTiBib2R5IEVMU0UgSEVYKGJvZHkpIEVORCBBUyBib2R5IEZST00gJyArXG4gICAgICBBVFRBQ0hfU1RPUkUgKyAnIFdIRVJFIGRpZ2VzdD0/JztcbiAgICB0eC5leGVjdXRlU3FsKHNxbCwgW2RpZ2VzdF0sIGZ1bmN0aW9uICh0eCwgcmVzdWx0KSB7XG4gICAgICAvLyB3ZWJzcWwgaGFzIGEgYnVnIHdoZXJlIFxcdTAwMDAgY2F1c2VzIGVhcmx5IHRydW5jYXRpb24gaW4gc3RyaW5nc1xuICAgICAgLy8gYW5kIGJsb2JzLiB0byB3b3JrIGFyb3VuZCB0aGlzLCB3ZSB1c2VkIHRvIHVzZSB0aGUgaGV4KCkgZnVuY3Rpb24sXG4gICAgICAvLyBidXQgdGhhdCdzIG5vdCBwZXJmb3JtYW50LiBhZnRlciBtaWdyYXRpb24gNiwgd2UgcmVtb3ZlIFxcdTAwMDBcbiAgICAgIC8vIGFuZCBhZGQgaXQgYmFjayBpbiBhZnRlcndhcmRzXG4gICAgICB2YXIgaXRlbSA9IHJlc3VsdC5yb3dzLml0ZW0oMCk7XG4gICAgICB2YXIgZGF0YSA9IGl0ZW0uZXNjYXBlZCA/IHdlYnNxbFV0aWxzLnVuZXNjYXBlQmxvYihpdGVtLmJvZHkpIDpcbiAgICAgICAgcGFyc2VIZXhTdHJpbmcoaXRlbS5ib2R5LCBlbmNvZGluZyk7XG4gICAgICBpZiAob3B0cy5lbmNvZGUpIHtcbiAgICAgICAgcmVzID0gYnRvYShkYXRhKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGRhdGEgPSB1dGlscy5maXhCaW5hcnkoZGF0YSk7XG4gICAgICAgIHJlcyA9IHV0aWxzLmNyZWF0ZUJsb2IoW2RhdGFdLCB7dHlwZTogdHlwZX0pO1xuICAgICAgfVxuICAgICAgY2FsbGJhY2sobnVsbCwgcmVzKTtcbiAgICB9KTtcbiAgfTtcblxuICBhcGkuX2dldFJldmlzaW9uVHJlZSA9IGZ1bmN0aW9uIChkb2NJZCwgY2FsbGJhY2spIHtcbiAgICBkYi5yZWFkVHJhbnNhY3Rpb24oZnVuY3Rpb24gKHR4KSB7XG4gICAgICB2YXIgc3FsID0gJ1NFTEVDVCBqc29uIEFTIG1ldGFkYXRhIEZST00gJyArIERPQ19TVE9SRSArICcgV0hFUkUgaWQgPSA/JztcbiAgICAgIHR4LmV4ZWN1dGVTcWwoc3FsLCBbZG9jSWRdLCBmdW5jdGlvbiAodHgsIHJlc3VsdCkge1xuICAgICAgICBpZiAoIXJlc3VsdC5yb3dzLmxlbmd0aCkge1xuICAgICAgICAgIGNhbGxiYWNrKGVycm9ycy5lcnJvcihlcnJvcnMuTUlTU0lOR19ET0MpKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB2YXIgZGF0YSA9IHV0aWxzLnNhZmVKc29uUGFyc2UocmVzdWx0LnJvd3MuaXRlbSgwKS5tZXRhZGF0YSk7XG4gICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGF0YS5yZXZfdHJlZSk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuICB9O1xuXG4gIGFwaS5fZG9Db21wYWN0aW9uID0gZnVuY3Rpb24gKGRvY0lkLCByZXZzLCBjYWxsYmFjaykge1xuICAgIGlmICghcmV2cy5sZW5ndGgpIHtcbiAgICAgIHJldHVybiBjYWxsYmFjaygpO1xuICAgIH1cbiAgICBkYi50cmFuc2FjdGlvbihmdW5jdGlvbiAodHgpIHtcblxuICAgICAgLy8gdXBkYXRlIGRvYyBzdG9yZVxuICAgICAgdmFyIHNxbCA9ICdTRUxFQ1QganNvbiBBUyBtZXRhZGF0YSBGUk9NICcgKyBET0NfU1RPUkUgKyAnIFdIRVJFIGlkID0gPyc7XG4gICAgICB0eC5leGVjdXRlU3FsKHNxbCwgW2RvY0lkXSwgZnVuY3Rpb24gKHR4LCByZXN1bHQpIHtcbiAgICAgICAgdmFyIG1ldGFkYXRhID0gdXRpbHMuc2FmZUpzb25QYXJzZShyZXN1bHQucm93cy5pdGVtKDApLm1ldGFkYXRhKTtcbiAgICAgICAgbWVyZ2UudHJhdmVyc2VSZXZUcmVlKG1ldGFkYXRhLnJldl90cmVlLCBmdW5jdGlvbiAoaXNMZWFmLCBwb3MsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldkhhc2gsIGN0eCwgb3B0cykge1xuICAgICAgICAgIHZhciByZXYgPSBwb3MgKyAnLScgKyByZXZIYXNoO1xuICAgICAgICAgIGlmIChyZXZzLmluZGV4T2YocmV2KSAhPT0gLTEpIHtcbiAgICAgICAgICAgIG9wdHMuc3RhdHVzID0gJ21pc3NpbmcnO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgdmFyIHNxbCA9ICdVUERBVEUgJyArIERPQ19TVE9SRSArICcgU0VUIGpzb24gPSA/IFdIRVJFIGlkID0gPyc7XG4gICAgICAgIHR4LmV4ZWN1dGVTcWwoc3FsLCBbdXRpbHMuc2FmZUpzb25TdHJpbmdpZnkobWV0YWRhdGEpLCBkb2NJZF0pO1xuICAgICAgfSk7XG5cbiAgICAgIGNvbXBhY3RSZXZzKHJldnMsIGRvY0lkLCB0eCk7XG4gICAgfSwgdW5rbm93bkVycm9yKGNhbGxiYWNrKSwgZnVuY3Rpb24gKCkge1xuICAgICAgY2FsbGJhY2soKTtcbiAgICB9KTtcbiAgfTtcblxuICBhcGkuX2dldExvY2FsID0gZnVuY3Rpb24gKGlkLCBjYWxsYmFjaykge1xuICAgIGRiLnJlYWRUcmFuc2FjdGlvbihmdW5jdGlvbiAodHgpIHtcbiAgICAgIHZhciBzcWwgPSAnU0VMRUNUIGpzb24sIHJldiBGUk9NICcgKyBMT0NBTF9TVE9SRSArICcgV0hFUkUgaWQ9Pyc7XG4gICAgICB0eC5leGVjdXRlU3FsKHNxbCwgW2lkXSwgZnVuY3Rpb24gKHR4LCByZXMpIHtcbiAgICAgICAgaWYgKHJlcy5yb3dzLmxlbmd0aCkge1xuICAgICAgICAgIHZhciBpdGVtID0gcmVzLnJvd3MuaXRlbSgwKTtcbiAgICAgICAgICB2YXIgZG9jID0gdW5zdHJpbmdpZnlEb2MoaXRlbS5qc29uLCBpZCwgaXRlbS5yZXYpO1xuICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRvYyk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY2FsbGJhY2soZXJyb3JzLmVycm9yKGVycm9ycy5NSVNTSU5HX0RPQykpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfTtcblxuICBhcGkuX3B1dExvY2FsID0gZnVuY3Rpb24gKGRvYywgb3B0cywgY2FsbGJhY2spIHtcbiAgICBpZiAodHlwZW9mIG9wdHMgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIGNhbGxiYWNrID0gb3B0cztcbiAgICAgIG9wdHMgPSB7fTtcbiAgICB9XG4gICAgZGVsZXRlIGRvYy5fcmV2aXNpb25zOyAvLyBpZ25vcmUgdGhpcywgdHJ1c3QgdGhlIHJldlxuICAgIHZhciBvbGRSZXYgPSBkb2MuX3JldjtcbiAgICB2YXIgaWQgPSBkb2MuX2lkO1xuICAgIHZhciBuZXdSZXY7XG4gICAgaWYgKCFvbGRSZXYpIHtcbiAgICAgIG5ld1JldiA9IGRvYy5fcmV2ID0gJzAtMSc7XG4gICAgfSBlbHNlIHtcbiAgICAgIG5ld1JldiA9IGRvYy5fcmV2ID0gJzAtJyArIChwYXJzZUludChvbGRSZXYuc3BsaXQoJy0nKVsxXSwgMTApICsgMSk7XG4gICAgfVxuICAgIHZhciBqc29uID0gc3RyaW5naWZ5RG9jKGRvYyk7XG5cbiAgICB2YXIgcmV0O1xuICAgIGZ1bmN0aW9uIHB1dExvY2FsKHR4KSB7XG4gICAgICB2YXIgc3FsO1xuICAgICAgdmFyIHZhbHVlcztcbiAgICAgIGlmIChvbGRSZXYpIHtcbiAgICAgICAgc3FsID0gJ1VQREFURSAnICsgTE9DQUxfU1RPUkUgKyAnIFNFVCByZXY9PywganNvbj0/ICcgK1xuICAgICAgICAgICdXSEVSRSBpZD0/IEFORCByZXY9Pyc7XG4gICAgICAgIHZhbHVlcyA9IFtuZXdSZXYsIGpzb24sIGlkLCBvbGRSZXZdO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgc3FsID0gJ0lOU0VSVCBJTlRPICcgKyBMT0NBTF9TVE9SRSArICcgKGlkLCByZXYsIGpzb24pIFZBTFVFUyAoPyw/LD8pJztcbiAgICAgICAgdmFsdWVzID0gW2lkLCBuZXdSZXYsIGpzb25dO1xuICAgICAgfVxuICAgICAgdHguZXhlY3V0ZVNxbChzcWwsIHZhbHVlcywgZnVuY3Rpb24gKHR4LCByZXMpIHtcbiAgICAgICAgaWYgKHJlcy5yb3dzQWZmZWN0ZWQpIHtcbiAgICAgICAgICByZXQgPSB7b2s6IHRydWUsIGlkOiBpZCwgcmV2OiBuZXdSZXZ9O1xuICAgICAgICAgIGlmIChvcHRzLmN0eCkgeyAvLyByZXR1cm4gaW1tZWRpYXRlbHlcbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIHJldCk7XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNhbGxiYWNrKGVycm9ycy5lcnJvcihlcnJvcnMuUkVWX0NPTkZMSUNUKSk7XG4gICAgICAgIH1cbiAgICAgIH0sIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgY2FsbGJhY2soZXJyb3JzLmVycm9yKGVycm9ycy5SRVZfQ09ORkxJQ1QpKTtcbiAgICAgICAgcmV0dXJuIGZhbHNlOyAvLyBhY2sgdGhhdCB3ZSBoYW5kbGVkIHRoZSBlcnJvclxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYgKG9wdHMuY3R4KSB7XG4gICAgICBwdXRMb2NhbChvcHRzLmN0eCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGRiLnRyYW5zYWN0aW9uKGZ1bmN0aW9uICh0eCkge1xuICAgICAgICBwdXRMb2NhbCh0eCk7XG4gICAgICB9LCB1bmtub3duRXJyb3IoY2FsbGJhY2spLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgIGlmIChyZXQpIHtcbiAgICAgICAgICBjYWxsYmFjayhudWxsLCByZXQpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG4gIH07XG5cbiAgYXBpLl9yZW1vdmVMb2NhbCA9IGZ1bmN0aW9uIChkb2MsIGNhbGxiYWNrKSB7XG4gICAgdmFyIHJldDtcbiAgICBkYi50cmFuc2FjdGlvbihmdW5jdGlvbiAodHgpIHtcbiAgICAgIHZhciBzcWwgPSAnREVMRVRFIEZST00gJyArIExPQ0FMX1NUT1JFICsgJyBXSEVSRSBpZD0/IEFORCByZXY9Pyc7XG4gICAgICB2YXIgcGFyYW1zID0gW2RvYy5faWQsIGRvYy5fcmV2XTtcbiAgICAgIHR4LmV4ZWN1dGVTcWwoc3FsLCBwYXJhbXMsIGZ1bmN0aW9uICh0eCwgcmVzKSB7XG4gICAgICAgIGlmICghcmVzLnJvd3NBZmZlY3RlZCkge1xuICAgICAgICAgIHJldHVybiBjYWxsYmFjayhlcnJvcnMuZXJyb3IoZXJyb3JzLk1JU1NJTkdfRE9DKSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0ID0ge29rOiB0cnVlLCBpZDogZG9jLl9pZCwgcmV2OiAnMC0wJ307XG4gICAgICB9KTtcbiAgICB9LCB1bmtub3duRXJyb3IoY2FsbGJhY2spLCBmdW5jdGlvbiAoKSB7XG4gICAgICBpZiAocmV0KSB7XG4gICAgICAgIGNhbGxiYWNrKG51bGwsIHJldCk7XG4gICAgICB9XG4gICAgfSk7XG4gIH07XG59XG5cbldlYlNxbFBvdWNoLnZhbGlkID0gd2Vic3FsVXRpbHMudmFsaWQ7XG5cbldlYlNxbFBvdWNoLmRlc3Ryb3kgPSB1dGlscy50b1Byb21pc2UoZnVuY3Rpb24gKG5hbWUsIG9wdHMsIGNhbGxiYWNrKSB7XG4gIFdlYlNxbFBvdWNoLkNoYW5nZXMucmVtb3ZlQWxsTGlzdGVuZXJzKG5hbWUpO1xuICB2YXIgc2l6ZSA9IGdldFNpemUob3B0cyk7XG4gIHZhciBkYiA9IG9wZW5EQih7XG4gICAgbmFtZTogbmFtZSxcbiAgICB2ZXJzaW9uOiBQT1VDSF9WRVJTSU9OLFxuICAgIGRlc2NyaXB0aW9uOiBuYW1lLFxuICAgIHNpemU6IHNpemUsXG4gICAgbG9jYXRpb246IG9wdHMubG9jYXRpb24sXG4gICAgY3JlYXRlRnJvbUxvY2F0aW9uOiBvcHRzLmNyZWF0ZUZyb21Mb2NhdGlvblxuICB9KTtcbiAgZGIudHJhbnNhY3Rpb24oZnVuY3Rpb24gKHR4KSB7XG4gICAgdmFyIHN0b3JlcyA9IFtET0NfU1RPUkUsIEJZX1NFUV9TVE9SRSwgQVRUQUNIX1NUT1JFLCBNRVRBX1NUT1JFLFxuICAgICAgTE9DQUxfU1RPUkUsIEFUVEFDSF9BTkRfU0VRX1NUT1JFXTtcbiAgICBzdG9yZXMuZm9yRWFjaChmdW5jdGlvbiAoc3RvcmUpIHtcbiAgICAgIHR4LmV4ZWN1dGVTcWwoJ0RST1AgVEFCTEUgSUYgRVhJU1RTICcgKyBzdG9yZSwgW10pO1xuICAgIH0pO1xuICB9LCB1bmtub3duRXJyb3IoY2FsbGJhY2spLCBmdW5jdGlvbiAoKSB7XG4gICAgaWYgKHV0aWxzLmhhc0xvY2FsU3RvcmFnZSgpKSB7XG4gICAgICBkZWxldGUgd2luZG93LmxvY2FsU3RvcmFnZVsnX3BvdWNoX193ZWJzcWxkYl8nICsgbmFtZV07XG4gICAgICBkZWxldGUgd2luZG93LmxvY2FsU3RvcmFnZVtuYW1lXTtcbiAgICB9XG4gICAgY2FsbGJhY2sobnVsbCwgeydvayc6IHRydWV9KTtcbiAgfSk7XG59KTtcblxuV2ViU3FsUG91Y2guQ2hhbmdlcyA9IG5ldyB1dGlscy5DaGFuZ2VzKCk7XG5cbm1vZHVsZS5leHBvcnRzID0gV2ViU3FsUG91Y2g7XG4iLCIndXNlIHN0cmljdCc7XG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzJyk7XG52YXIgbWVyZ2UgPSByZXF1aXJlKCcuL21lcmdlJyk7XG52YXIgZXJyb3JzID0gcmVxdWlyZSgnLi9kZXBzL2Vycm9ycycpO1xudmFyIEVFID0gcmVxdWlyZSgnZXZlbnRzJykuRXZlbnRFbWl0dGVyO1xudmFyIGV2YWxGaWx0ZXIgPSByZXF1aXJlKCcuL2V2YWxGaWx0ZXInKTtcbnZhciBldmFsVmlldyA9IHJlcXVpcmUoJy4vZXZhbFZpZXcnKTtcbm1vZHVsZS5leHBvcnRzID0gQ2hhbmdlcztcbnV0aWxzLmluaGVyaXRzKENoYW5nZXMsIEVFKTtcblxuZnVuY3Rpb24gQ2hhbmdlcyhkYiwgb3B0cywgY2FsbGJhY2spIHtcbiAgRUUuY2FsbCh0aGlzKTtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICB0aGlzLmRiID0gZGI7XG4gIG9wdHMgPSBvcHRzID8gdXRpbHMuY2xvbmUob3B0cykgOiB7fTtcbiAgdmFyIG9sZENvbXBsZXRlID0gY2FsbGJhY2sgfHwgb3B0cy5jb21wbGV0ZSB8fCBmdW5jdGlvbiAoKSB7fTtcbiAgdmFyIGNvbXBsZXRlID0gb3B0cy5jb21wbGV0ZSA9IHV0aWxzLm9uY2UoZnVuY3Rpb24gKGVyciwgcmVzcCkge1xuICAgIGlmIChlcnIpIHtcbiAgICAgIHNlbGYuZW1pdCgnZXJyb3InLCBlcnIpO1xuICAgIH0gZWxzZSB7XG4gICAgICBzZWxmLmVtaXQoJ2NvbXBsZXRlJywgcmVzcCk7XG4gICAgfVxuICAgIHNlbGYucmVtb3ZlQWxsTGlzdGVuZXJzKCk7XG4gICAgZGIucmVtb3ZlTGlzdGVuZXIoJ2Rlc3Ryb3llZCcsIG9uRGVzdHJveSk7XG4gIH0pO1xuICBpZiAob2xkQ29tcGxldGUpIHtcbiAgICBzZWxmLm9uKCdjb21wbGV0ZScsIGZ1bmN0aW9uIChyZXNwKSB7XG4gICAgICBvbGRDb21wbGV0ZShudWxsLCByZXNwKTtcbiAgICB9KTtcbiAgICBzZWxmLm9uKCdlcnJvcicsIGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgIG9sZENvbXBsZXRlKGVycik7XG4gICAgfSk7XG4gIH1cbiAgdmFyIG9sZE9uQ2hhbmdlID0gb3B0cy5vbkNoYW5nZTtcbiAgaWYgKG9sZE9uQ2hhbmdlKSB7XG4gICAgc2VsZi5vbignY2hhbmdlJywgb2xkT25DaGFuZ2UpO1xuICB9XG4gIGZ1bmN0aW9uIG9uRGVzdHJveSgpIHtcbiAgICBzZWxmLmNhbmNlbCgpO1xuICB9XG4gIGRiLm9uY2UoJ2Rlc3Ryb3llZCcsIG9uRGVzdHJveSk7XG5cbiAgb3B0cy5vbkNoYW5nZSA9IGZ1bmN0aW9uIChjaGFuZ2UpIHtcbiAgICBpZiAob3B0cy5pc0NhbmNlbGxlZCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBzZWxmLmVtaXQoJ2NoYW5nZScsIGNoYW5nZSk7XG4gICAgaWYgKHNlbGYuc3RhcnRTZXEgJiYgc2VsZi5zdGFydFNlcSA8PSBjaGFuZ2Uuc2VxKSB7XG4gICAgICBzZWxmLmVtaXQoJ3VwdG9kYXRlJyk7XG4gICAgICBzZWxmLnN0YXJ0U2VxID0gZmFsc2U7XG4gICAgfVxuICAgIGlmIChjaGFuZ2UuZGVsZXRlZCkge1xuICAgICAgc2VsZi5lbWl0KCdkZWxldGUnLCBjaGFuZ2UpO1xuICAgIH0gZWxzZSBpZiAoY2hhbmdlLmNoYW5nZXMubGVuZ3RoID09PSAxICYmXG4gICAgICBjaGFuZ2UuY2hhbmdlc1swXS5yZXYuc2xpY2UoMCwgMikgPT09ICcxLScpIHtcbiAgICAgIHNlbGYuZW1pdCgnY3JlYXRlJywgY2hhbmdlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgc2VsZi5lbWl0KCd1cGRhdGUnLCBjaGFuZ2UpO1xuICAgIH1cbiAgfTtcblxuICB2YXIgcHJvbWlzZSA9IG5ldyB1dGlscy5Qcm9taXNlKGZ1bmN0aW9uIChmdWxmaWxsLCByZWplY3QpIHtcbiAgICBvcHRzLmNvbXBsZXRlID0gZnVuY3Rpb24gKGVyciwgcmVzKSB7XG4gICAgICBpZiAoZXJyKSB7XG4gICAgICAgIHJlamVjdChlcnIpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZnVsZmlsbChyZXMpO1xuICAgICAgfVxuICAgIH07XG4gIH0pO1xuICBzZWxmLm9uY2UoJ2NhbmNlbCcsIGZ1bmN0aW9uICgpIHtcbiAgICBpZiAob2xkT25DaGFuZ2UpIHtcbiAgICAgIHNlbGYucmVtb3ZlTGlzdGVuZXIoJ2NoYW5nZScsIG9sZE9uQ2hhbmdlKTtcbiAgICB9XG4gICAgb3B0cy5jb21wbGV0ZShudWxsLCB7c3RhdHVzOiAnY2FuY2VsbGVkJ30pO1xuICB9KTtcbiAgdGhpcy50aGVuID0gcHJvbWlzZS50aGVuLmJpbmQocHJvbWlzZSk7XG4gIHRoaXNbJ2NhdGNoJ10gPSBwcm9taXNlWydjYXRjaCddLmJpbmQocHJvbWlzZSk7XG4gIHRoaXMudGhlbihmdW5jdGlvbiAocmVzdWx0KSB7XG4gICAgY29tcGxldGUobnVsbCwgcmVzdWx0KTtcbiAgfSwgY29tcGxldGUpO1xuXG5cblxuICBpZiAoIWRiLnRhc2txdWV1ZS5pc1JlYWR5KSB7XG4gICAgZGIudGFza3F1ZXVlLmFkZFRhc2soZnVuY3Rpb24gKCkge1xuICAgICAgaWYgKHNlbGYuaXNDYW5jZWxsZWQpIHtcbiAgICAgICAgc2VsZi5lbWl0KCdjYW5jZWwnKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHNlbGYuZG9DaGFuZ2VzKG9wdHMpO1xuICAgICAgfVxuICAgIH0pO1xuICB9IGVsc2Uge1xuICAgIHNlbGYuZG9DaGFuZ2VzKG9wdHMpO1xuICB9XG59XG5DaGFuZ2VzLnByb3RvdHlwZS5jYW5jZWwgPSBmdW5jdGlvbiAoKSB7XG4gIHRoaXMuaXNDYW5jZWxsZWQgPSB0cnVlO1xuICBpZiAodGhpcy5kYi50YXNrcXVldWUuaXNSZWFkeSkge1xuICAgIHRoaXMuZW1pdCgnY2FuY2VsJyk7XG4gIH1cbn07XG5mdW5jdGlvbiBwcm9jZXNzQ2hhbmdlKGRvYywgbWV0YWRhdGEsIG9wdHMpIHtcbiAgdmFyIGNoYW5nZUxpc3QgPSBbe3JldjogZG9jLl9yZXZ9XTtcbiAgaWYgKG9wdHMuc3R5bGUgPT09ICdhbGxfZG9jcycpIHtcbiAgICBjaGFuZ2VMaXN0ID0gbWVyZ2UuY29sbGVjdExlYXZlcyhtZXRhZGF0YS5yZXZfdHJlZSlcbiAgICAubWFwKGZ1bmN0aW9uICh4KSB7IHJldHVybiB7cmV2OiB4LnJldn07IH0pO1xuICB9XG4gIHZhciBjaGFuZ2UgPSB7XG4gICAgaWQ6IG1ldGFkYXRhLmlkLFxuICAgIGNoYW5nZXM6IGNoYW5nZUxpc3QsXG4gICAgZG9jOiBkb2NcbiAgfTtcblxuICBpZiAodXRpbHMuaXNEZWxldGVkKG1ldGFkYXRhLCBkb2MuX3JldikpIHtcbiAgICBjaGFuZ2UuZGVsZXRlZCA9IHRydWU7XG4gIH1cbiAgaWYgKG9wdHMuY29uZmxpY3RzKSB7XG4gICAgY2hhbmdlLmRvYy5fY29uZmxpY3RzID0gbWVyZ2UuY29sbGVjdENvbmZsaWN0cyhtZXRhZGF0YSk7XG4gICAgaWYgKCFjaGFuZ2UuZG9jLl9jb25mbGljdHMubGVuZ3RoKSB7XG4gICAgICBkZWxldGUgY2hhbmdlLmRvYy5fY29uZmxpY3RzO1xuICAgIH1cbiAgfVxuICByZXR1cm4gY2hhbmdlO1xufVxuXG5DaGFuZ2VzLnByb3RvdHlwZS5kb0NoYW5nZXMgPSBmdW5jdGlvbiAob3B0cykge1xuICB2YXIgc2VsZiA9IHRoaXM7XG4gIHZhciBjYWxsYmFjayA9IG9wdHMuY29tcGxldGU7XG5cbiAgb3B0cyA9IHV0aWxzLmNsb25lKG9wdHMpO1xuICBpZiAoJ2xpdmUnIGluIG9wdHMgJiYgISgnY29udGludW91cycgaW4gb3B0cykpIHtcbiAgICBvcHRzLmNvbnRpbnVvdXMgPSBvcHRzLmxpdmU7XG4gIH1cbiAgb3B0cy5wcm9jZXNzQ2hhbmdlID0gcHJvY2Vzc0NoYW5nZTtcblxuICBpZiAob3B0cy5zaW5jZSA9PT0gJ2xhdGVzdCcpIHtcbiAgICBvcHRzLnNpbmNlID0gJ25vdyc7XG4gIH1cbiAgaWYgKCFvcHRzLnNpbmNlKSB7XG4gICAgb3B0cy5zaW5jZSA9IDA7XG4gIH1cbiAgaWYgKG9wdHMuc2luY2UgPT09ICdub3cnKSB7XG4gICAgdGhpcy5kYi5pbmZvKCkudGhlbihmdW5jdGlvbiAoaW5mbykge1xuICAgICAgaWYgKHNlbGYuaXNDYW5jZWxsZWQpIHtcbiAgICAgICAgY2FsbGJhY2sobnVsbCwge3N0YXR1czogJ2NhbmNlbGxlZCd9KTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgb3B0cy5zaW5jZSA9IGluZm8udXBkYXRlX3NlcTtcbiAgICAgIHNlbGYuZG9DaGFuZ2VzKG9wdHMpO1xuICAgIH0sIGNhbGxiYWNrKTtcbiAgICByZXR1cm47XG4gIH1cblxuICBpZiAob3B0cy5jb250aW51b3VzICYmIG9wdHMuc2luY2UgIT09ICdub3cnKSB7XG4gICAgdGhpcy5kYi5pbmZvKCkudGhlbihmdW5jdGlvbiAoaW5mbykge1xuICAgICAgc2VsZi5zdGFydFNlcSA9IGluZm8udXBkYXRlX3NlcTtcbiAgICB9LCBmdW5jdGlvbiAoZXJyKSB7XG4gICAgICBpZiAoZXJyLmlkID09PSAnaWRiTnVsbCcpIHtcbiAgICAgICAgLy9kYiBjbG9zZWQgYmVmb3JlIHRoaXMgcmV0dXJuZWRcbiAgICAgICAgLy90aGF0cyBva1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICB0aHJvdyBlcnI7XG4gICAgfSk7XG4gIH1cblxuICBpZiAodGhpcy5kYi50eXBlKCkgIT09ICdodHRwJyAmJlxuICAgICAgb3B0cy5maWx0ZXIgJiYgdHlwZW9mIG9wdHMuZmlsdGVyID09PSAnc3RyaW5nJyAmJlxuICAgICAgIW9wdHMuZG9jX2lkcykge1xuICAgIHJldHVybiB0aGlzLmZpbHRlckNoYW5nZXMob3B0cyk7XG4gIH1cblxuICBpZiAoISgnZGVzY2VuZGluZycgaW4gb3B0cykpIHtcbiAgICBvcHRzLmRlc2NlbmRpbmcgPSBmYWxzZTtcbiAgfVxuXG4gIC8vIDAgYW5kIDEgc2hvdWxkIHJldHVybiAxIGRvY3VtZW50XG4gIG9wdHMubGltaXQgPSBvcHRzLmxpbWl0ID09PSAwID8gMSA6IG9wdHMubGltaXQ7XG4gIG9wdHMuY29tcGxldGUgPSBjYWxsYmFjaztcbiAgdmFyIG5ld1Byb21pc2UgPSB0aGlzLmRiLl9jaGFuZ2VzKG9wdHMpO1xuICBpZiAobmV3UHJvbWlzZSAmJiB0eXBlb2YgbmV3UHJvbWlzZS5jYW5jZWwgPT09ICdmdW5jdGlvbicpIHtcbiAgICB2YXIgY2FuY2VsID0gc2VsZi5jYW5jZWw7XG4gICAgc2VsZi5jYW5jZWwgPSB1dGlscy5nZXRBcmd1bWVudHMoZnVuY3Rpb24gKGFyZ3MpIHtcbiAgICAgIG5ld1Byb21pc2UuY2FuY2VsKCk7XG4gICAgICBjYW5jZWwuYXBwbHkodGhpcywgYXJncyk7XG4gICAgfSk7XG4gIH1cbn07XG5cbkNoYW5nZXMucHJvdG90eXBlLmZpbHRlckNoYW5nZXMgPSBmdW5jdGlvbiAob3B0cykge1xuICB2YXIgc2VsZiA9IHRoaXM7XG4gIHZhciBjYWxsYmFjayA9IG9wdHMuY29tcGxldGU7XG4gIGlmIChvcHRzLmZpbHRlciA9PT0gJ192aWV3Jykge1xuICAgIGlmICghb3B0cy52aWV3IHx8IHR5cGVvZiBvcHRzLnZpZXcgIT09ICdzdHJpbmcnKSB7XG4gICAgICB2YXIgZXJyID0gZXJyb3JzLmVycm9yKGVycm9ycy5CQURfUkVRVUVTVCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2B2aWV3YCBmaWx0ZXIgcGFyYW1ldGVyIGlzIG5vdCBwcm92aWRlZC4nKTtcbiAgICAgIGNhbGxiYWNrKGVycik7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIC8vIGZldGNoIGEgdmlldyBmcm9tIGEgZGVzaWduIGRvYywgbWFrZSBpdCBiZWhhdmUgbGlrZSBhIGZpbHRlclxuICAgIHZhciB2aWV3TmFtZSA9IG9wdHMudmlldy5zcGxpdCgnLycpO1xuICAgIHRoaXMuZGIuZ2V0KCdfZGVzaWduLycgKyB2aWV3TmFtZVswXSwgZnVuY3Rpb24gKGVyciwgZGRvYykge1xuICAgICAgaWYgKHNlbGYuaXNDYW5jZWxsZWQpIHtcbiAgICAgICAgY2FsbGJhY2sobnVsbCwge3N0YXR1czogJ2NhbmNlbGxlZCd9KTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgaWYgKGVycikge1xuICAgICAgICBjYWxsYmFjayhlcnJvcnMuZ2VuZXJhdGVFcnJvckZyb21SZXNwb25zZShlcnIpKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgaWYgKGRkb2MgJiYgZGRvYy52aWV3cyAmJiBkZG9jLnZpZXdzW3ZpZXdOYW1lWzFdXSkge1xuICAgICAgICBcbiAgICAgICAgdmFyIGZpbHRlciA9IGV2YWxWaWV3KGRkb2Mudmlld3Nbdmlld05hbWVbMV1dLm1hcCk7XG4gICAgICAgIG9wdHMuZmlsdGVyID0gZmlsdGVyO1xuICAgICAgICBzZWxmLmRvQ2hhbmdlcyhvcHRzKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgdmFyIG1zZyA9IGRkb2Mudmlld3MgPyAnbWlzc2luZyBqc29uIGtleTogJyArIHZpZXdOYW1lWzFdIDpcbiAgICAgICAgJ21pc3NpbmcganNvbiBrZXk6IHZpZXdzJztcbiAgICAgIGlmICghZXJyKSB7XG4gICAgICAgIGVyciA9IGVycm9ycy5lcnJvcihlcnJvcnMuTUlTU0lOR19ET0MsIG1zZyk7XG4gICAgICB9XG4gICAgICBjYWxsYmFjayhlcnIpO1xuICAgICAgcmV0dXJuO1xuICAgIH0pO1xuICB9IGVsc2Uge1xuICAgIC8vIGZldGNoIGEgZmlsdGVyIGZyb20gYSBkZXNpZ24gZG9jXG4gICAgdmFyIGZpbHRlck5hbWUgPSBvcHRzLmZpbHRlci5zcGxpdCgnLycpO1xuICAgIHRoaXMuZGIuZ2V0KCdfZGVzaWduLycgKyBmaWx0ZXJOYW1lWzBdLCBmdW5jdGlvbiAoZXJyLCBkZG9jKSB7XG4gICAgICBpZiAoc2VsZi5pc0NhbmNlbGxlZCkge1xuICAgICAgICBjYWxsYmFjayhudWxsLCB7c3RhdHVzOiAnY2FuY2VsbGVkJ30pO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBpZiAoZXJyKSB7XG4gICAgICAgIGNhbGxiYWNrKGVycm9ycy5nZW5lcmF0ZUVycm9yRnJvbVJlc3BvbnNlKGVycikpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBpZiAoZGRvYyAmJiBkZG9jLmZpbHRlcnMgJiYgZGRvYy5maWx0ZXJzW2ZpbHRlck5hbWVbMV1dKSB7XG4gICAgICAgIHZhciBmaWx0ZXIgPSBldmFsRmlsdGVyKGRkb2MuZmlsdGVyc1tmaWx0ZXJOYW1lWzFdXSk7XG4gICAgICAgIG9wdHMuZmlsdGVyID0gZmlsdGVyO1xuICAgICAgICBzZWxmLmRvQ2hhbmdlcyhvcHRzKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdmFyIG1zZyA9IChkZG9jICYmIGRkb2MuZmlsdGVycykgPyAnbWlzc2luZyBqc29uIGtleTogJyArIGZpbHRlck5hbWVbMV1cbiAgICAgICAgICA6ICdtaXNzaW5nIGpzb24ga2V5OiBmaWx0ZXJzJztcbiAgICAgICAgaWYgKCFlcnIpIHtcbiAgICAgICAgICBlcnIgPSBlcnJvcnMuZXJyb3IoZXJyb3JzLk1JU1NJTkdfRE9DLCBtc2cpO1xuICAgICAgICB9XG4gICAgICAgIGNhbGxiYWNrKGVycik7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxufTsiLCIndXNlIHN0cmljdCc7XG5cbnZhciB1dGlscyA9IHJlcXVpcmUoJy4vdXRpbHMnKTtcbnZhciBwb3VjaENvbGxhdGUgPSByZXF1aXJlKCdwb3VjaGRiLWNvbGxhdGUnKTtcbnZhciBjb2xsYXRlID0gcG91Y2hDb2xsYXRlLmNvbGxhdGU7XG5cbmZ1bmN0aW9uIHVwZGF0ZUNoZWNrcG9pbnQoZGIsIGlkLCBjaGVja3BvaW50LCByZXR1cm5WYWx1ZSkge1xuICByZXR1cm4gZGIuZ2V0KGlkKVtcImNhdGNoXCJdKGZ1bmN0aW9uIChlcnIpIHtcbiAgICBpZiAoZXJyLnN0YXR1cyA9PT0gNDA0KSB7XG4gICAgICBpZiAoZGIudHlwZSgpID09PSAnaHR0cCcpIHtcbiAgICAgICAgdXRpbHMuZXhwbGFpbjQwNChcbiAgICAgICAgICAnUG91Y2hEQiBpcyBqdXN0IGNoZWNraW5nIGlmIGEgcmVtb3RlIGNoZWNrcG9pbnQgZXhpc3RzLicpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHtfaWQ6IGlkfTtcbiAgICB9XG4gICAgdGhyb3cgZXJyO1xuICB9KS50aGVuKGZ1bmN0aW9uIChkb2MpIHtcbiAgICBpZiAocmV0dXJuVmFsdWUuY2FuY2VsbGVkKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGRvYy5sYXN0X3NlcSA9IGNoZWNrcG9pbnQ7XG4gICAgcmV0dXJuIGRiLnB1dChkb2MpW1wiY2F0Y2hcIl0oZnVuY3Rpb24gKGVycikge1xuICAgICAgaWYgKGVyci5zdGF0dXMgPT09IDQwOSkge1xuICAgICAgICAvLyByZXRyeTsgc29tZW9uZSBpcyB0cnlpbmcgdG8gd3JpdGUgYSBjaGVja3BvaW50IHNpbXVsdGFuZW91c2x5XG4gICAgICAgIHJldHVybiB1cGRhdGVDaGVja3BvaW50KGRiLCBpZCwgY2hlY2twb2ludCwgcmV0dXJuVmFsdWUpO1xuICAgICAgfVxuICAgICAgdGhyb3cgZXJyO1xuICAgIH0pO1xuICB9KTtcbn1cblxuZnVuY3Rpb24gQ2hlY2twb2ludGVyKHNyYywgdGFyZ2V0LCBpZCwgcmV0dXJuVmFsdWUpIHtcbiAgdGhpcy5zcmMgPSBzcmM7XG4gIHRoaXMudGFyZ2V0ID0gdGFyZ2V0O1xuICB0aGlzLmlkID0gaWQ7XG4gIHRoaXMucmV0dXJuVmFsdWUgPSByZXR1cm5WYWx1ZTtcbn1cblxuQ2hlY2twb2ludGVyLnByb3RvdHlwZS53cml0ZUNoZWNrcG9pbnQgPSBmdW5jdGlvbiAoY2hlY2twb2ludCkge1xuICB2YXIgc2VsZiA9IHRoaXM7XG4gIHJldHVybiB0aGlzLnVwZGF0ZVRhcmdldChjaGVja3BvaW50KS50aGVuKGZ1bmN0aW9uICgpIHtcbiAgICByZXR1cm4gc2VsZi51cGRhdGVTb3VyY2UoY2hlY2twb2ludCk7XG4gIH0pO1xufTtcblxuQ2hlY2twb2ludGVyLnByb3RvdHlwZS51cGRhdGVUYXJnZXQgPSBmdW5jdGlvbiAoY2hlY2twb2ludCkge1xuICByZXR1cm4gdXBkYXRlQ2hlY2twb2ludCh0aGlzLnRhcmdldCwgdGhpcy5pZCwgY2hlY2twb2ludCwgdGhpcy5yZXR1cm5WYWx1ZSk7XG59O1xuXG5DaGVja3BvaW50ZXIucHJvdG90eXBlLnVwZGF0ZVNvdXJjZSA9IGZ1bmN0aW9uIChjaGVja3BvaW50KSB7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgaWYgKHRoaXMucmVhZE9ubHlTb3VyY2UpIHtcbiAgICByZXR1cm4gdXRpbHMuUHJvbWlzZS5yZXNvbHZlKHRydWUpO1xuICB9XG4gIHJldHVybiB1cGRhdGVDaGVja3BvaW50KHRoaXMuc3JjLCB0aGlzLmlkLCBjaGVja3BvaW50LCB0aGlzLnJldHVyblZhbHVlKVtcbiAgICBcImNhdGNoXCJdKGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgIHZhciBpc0ZvcmJpZGRlbiA9IHR5cGVvZiBlcnIuc3RhdHVzID09PSAnbnVtYmVyJyAmJlxuICAgICAgICBNYXRoLmZsb29yKGVyci5zdGF0dXMgLyAxMDApID09PSA0O1xuICAgICAgaWYgKGlzRm9yYmlkZGVuKSB7XG4gICAgICAgIHNlbGYucmVhZE9ubHlTb3VyY2UgPSB0cnVlO1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIH1cbiAgICAgIHRocm93IGVycjtcbiAgICB9KTtcbn07XG5cbkNoZWNrcG9pbnRlci5wcm90b3R5cGUuZ2V0Q2hlY2twb2ludCA9IGZ1bmN0aW9uICgpIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICByZXR1cm4gc2VsZi50YXJnZXQuZ2V0KHNlbGYuaWQpLnRoZW4oZnVuY3Rpb24gKHRhcmdldERvYykge1xuICAgIHJldHVybiBzZWxmLnNyYy5nZXQoc2VsZi5pZCkudGhlbihmdW5jdGlvbiAoc291cmNlRG9jKSB7XG4gICAgICBpZiAoY29sbGF0ZSh0YXJnZXREb2MubGFzdF9zZXEsIHNvdXJjZURvYy5sYXN0X3NlcSkgPT09IDApIHtcbiAgICAgICAgcmV0dXJuIHNvdXJjZURvYy5sYXN0X3NlcTtcbiAgICAgIH1cbiAgICAgIHJldHVybiAwO1xuICAgIH0sIGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgIGlmIChlcnIuc3RhdHVzID09PSA0MDQgJiYgdGFyZ2V0RG9jLmxhc3Rfc2VxKSB7XG4gICAgICAgIHJldHVybiBzZWxmLnNyYy5wdXQoe1xuICAgICAgICAgIF9pZDogc2VsZi5pZCxcbiAgICAgICAgICBsYXN0X3NlcTogMFxuICAgICAgICB9KS50aGVuKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICByZXR1cm4gMDtcbiAgICAgICAgfSwgZnVuY3Rpb24gKGVycikge1xuICAgICAgICAgIGlmIChlcnIuc3RhdHVzID09PSA0MDEpIHtcbiAgICAgICAgICAgIHNlbGYucmVhZE9ubHlTb3VyY2UgPSB0cnVlO1xuICAgICAgICAgICAgcmV0dXJuIHRhcmdldERvYy5sYXN0X3NlcTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuIDA7XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgdGhyb3cgZXJyO1xuICAgIH0pO1xuICB9KVtcImNhdGNoXCJdKGZ1bmN0aW9uIChlcnIpIHtcbiAgICBpZiAoZXJyLnN0YXR1cyAhPT0gNDA0KSB7XG4gICAgICB0aHJvdyBlcnI7XG4gICAgfVxuICAgIHJldHVybiAwO1xuICB9KTtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gQ2hlY2twb2ludGVyO1xuIiwiLypnbG9iYWxzIGNvcmRvdmEgKi9cblwidXNlIHN0cmljdFwiO1xuXG52YXIgQWRhcHRlciA9IHJlcXVpcmUoJy4vYWRhcHRlcicpO1xudmFyIHV0aWxzID0gcmVxdWlyZSgnLi91dGlscycpO1xudmFyIFRhc2tRdWV1ZSA9IHJlcXVpcmUoJy4vdGFza3F1ZXVlJyk7XG52YXIgUHJvbWlzZSA9IHV0aWxzLlByb21pc2U7XG5cbmZ1bmN0aW9uIGRlZmF1bHRDYWxsYmFjayhlcnIpIHtcbiAgaWYgKGVyciAmJiBnbG9iYWwuZGVidWcpIHtcbiAgICBjb25zb2xlLmVycm9yKGVycik7XG4gIH1cbn1cblxudXRpbHMuaW5oZXJpdHMoUG91Y2hEQiwgQWRhcHRlcik7XG5mdW5jdGlvbiBQb3VjaERCKG5hbWUsIG9wdHMsIGNhbGxiYWNrKSB7XG5cbiAgaWYgKCEodGhpcyBpbnN0YW5jZW9mIFBvdWNoREIpKSB7XG4gICAgcmV0dXJuIG5ldyBQb3VjaERCKG5hbWUsIG9wdHMsIGNhbGxiYWNrKTtcbiAgfVxuICB2YXIgc2VsZiA9IHRoaXM7XG4gIGlmICh0eXBlb2Ygb3B0cyA9PT0gJ2Z1bmN0aW9uJyB8fCB0eXBlb2Ygb3B0cyA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBjYWxsYmFjayA9IG9wdHM7XG4gICAgb3B0cyA9IHt9O1xuICB9XG5cbiAgaWYgKG5hbWUgJiYgdHlwZW9mIG5hbWUgPT09ICdvYmplY3QnKSB7XG4gICAgb3B0cyA9IG5hbWU7XG4gICAgbmFtZSA9IHVuZGVmaW5lZDtcbiAgfVxuICBpZiAodHlwZW9mIGNhbGxiYWNrID09PSAndW5kZWZpbmVkJykge1xuICAgIGNhbGxiYWNrID0gZGVmYXVsdENhbGxiYWNrO1xuICB9XG4gIG9wdHMgPSBvcHRzIHx8IHt9O1xuICB0aGlzLl9fb3B0cyA9IG9wdHM7XG4gIHZhciBvbGRDQiA9IGNhbGxiYWNrO1xuICBzZWxmLmF1dG9fY29tcGFjdGlvbiA9IG9wdHMuYXV0b19jb21wYWN0aW9uO1xuICBzZWxmLnByZWZpeCA9IFBvdWNoREIucHJlZml4O1xuICBBZGFwdGVyLmNhbGwoc2VsZik7XG4gIHNlbGYudGFza3F1ZXVlID0gbmV3IFRhc2tRdWV1ZSgpO1xuICB2YXIgcHJvbWlzZSA9IG5ldyBQcm9taXNlKGZ1bmN0aW9uIChmdWxmaWxsLCByZWplY3QpIHtcbiAgICBjYWxsYmFjayA9IGZ1bmN0aW9uIChlcnIsIHJlc3ApIHtcbiAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgcmV0dXJuIHJlamVjdChlcnIpO1xuICAgICAgfVxuICAgICAgZGVsZXRlIHJlc3AudGhlbjtcbiAgICAgIGZ1bGZpbGwocmVzcCk7XG4gICAgfTtcbiAgXG4gICAgb3B0cyA9IHV0aWxzLmNsb25lKG9wdHMpO1xuICAgIHZhciBvcmlnaW5hbE5hbWUgPSBvcHRzLm5hbWUgfHwgbmFtZTtcbiAgICB2YXIgYmFja2VuZCwgZXJyb3I7XG4gICAgKGZ1bmN0aW9uICgpIHtcbiAgICAgIHRyeSB7XG5cbiAgICAgICAgaWYgKHR5cGVvZiBvcmlnaW5hbE5hbWUgIT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgZXJyb3IgPSBuZXcgRXJyb3IoJ01pc3NpbmcvaW52YWxpZCBEQiBuYW1lJyk7XG4gICAgICAgICAgZXJyb3IuY29kZSA9IDQwMDtcbiAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfVxuXG4gICAgICAgIGJhY2tlbmQgPSBQb3VjaERCLnBhcnNlQWRhcHRlcihvcmlnaW5hbE5hbWUsIG9wdHMpO1xuICAgICAgICBcbiAgICAgICAgb3B0cy5vcmlnaW5hbE5hbWUgPSBvcmlnaW5hbE5hbWU7XG4gICAgICAgIG9wdHMubmFtZSA9IGJhY2tlbmQubmFtZTtcbiAgICAgICAgaWYgKG9wdHMucHJlZml4ICYmIGJhY2tlbmQuYWRhcHRlciAhPT0gJ2h0dHAnICYmXG4gICAgICAgICAgICBiYWNrZW5kLmFkYXB0ZXIgIT09ICdodHRwcycpIHtcbiAgICAgICAgICBvcHRzLm5hbWUgPSBvcHRzLnByZWZpeCArIG9wdHMubmFtZTtcbiAgICAgICAgfVxuICAgICAgICBvcHRzLmFkYXB0ZXIgPSBvcHRzLmFkYXB0ZXIgfHwgYmFja2VuZC5hZGFwdGVyO1xuICAgICAgICBzZWxmLl9hZGFwdGVyID0gb3B0cy5hZGFwdGVyO1xuICAgICAgICBzZWxmLl9kYl9uYW1lID0gb3JpZ2luYWxOYW1lO1xuICAgICAgICBpZiAoIVBvdWNoREIuYWRhcHRlcnNbb3B0cy5hZGFwdGVyXSkge1xuICAgICAgICAgIGVycm9yID0gbmV3IEVycm9yKCdBZGFwdGVyIGlzIG1pc3NpbmcnKTtcbiAgICAgICAgICBlcnJvci5jb2RlID0gNDA0O1xuICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCFQb3VjaERCLmFkYXB0ZXJzW29wdHMuYWRhcHRlcl0udmFsaWQoKSkge1xuICAgICAgICAgIGVycm9yID0gbmV3IEVycm9yKCdJbnZhbGlkIEFkYXB0ZXInKTtcbiAgICAgICAgICBlcnJvci5jb2RlID0gNDA0O1xuICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgc2VsZi50YXNrcXVldWUuZmFpbChlcnIpO1xuICAgICAgICBzZWxmLmNoYW5nZXMgPSB1dGlscy50b1Byb21pc2UoZnVuY3Rpb24gKG9wdHMpIHtcbiAgICAgICAgICBpZiAob3B0cy5jb21wbGV0ZSkge1xuICAgICAgICAgICAgb3B0cy5jb21wbGV0ZShlcnIpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSgpKTtcbiAgICBpZiAoZXJyb3IpIHtcbiAgICAgIHJldHVybiByZWplY3QoZXJyb3IpOyAvLyBjb25zdHJ1Y3RvciBlcnJvciwgc2VlIGFib3ZlXG4gICAgfVxuICAgIHNlbGYuYWRhcHRlciA9IG9wdHMuYWRhcHRlcjtcblxuICAgIC8vIG5lZWRzIGFjY2VzcyB0byBQb3VjaERCO1xuICAgIHNlbGYucmVwbGljYXRlID0ge307XG5cbiAgICBzZWxmLnJlcGxpY2F0ZS5mcm9tID0gZnVuY3Rpb24gKHVybCwgb3B0cywgY2FsbGJhY2spIHtcbiAgICAgIHJldHVybiBzZWxmLmNvbnN0cnVjdG9yLnJlcGxpY2F0ZSh1cmwsIHNlbGYsIG9wdHMsIGNhbGxiYWNrKTtcbiAgICB9O1xuXG4gICAgc2VsZi5yZXBsaWNhdGUudG8gPSBmdW5jdGlvbiAodXJsLCBvcHRzLCBjYWxsYmFjaykge1xuICAgICAgcmV0dXJuIHNlbGYuY29uc3RydWN0b3IucmVwbGljYXRlKHNlbGYsIHVybCwgb3B0cywgY2FsbGJhY2spO1xuICAgIH07XG5cbiAgICBzZWxmLnN5bmMgPSBmdW5jdGlvbiAoZGJOYW1lLCBvcHRzLCBjYWxsYmFjaykge1xuICAgICAgcmV0dXJuIHNlbGYuY29uc3RydWN0b3Iuc3luYyhzZWxmLCBkYk5hbWUsIG9wdHMsIGNhbGxiYWNrKTtcbiAgICB9O1xuXG4gICAgc2VsZi5yZXBsaWNhdGUuc3luYyA9IHNlbGYuc3luYztcblxuICAgIHNlbGYuZGVzdHJveSA9IHV0aWxzLmFkYXB0ZXJGdW4oJ2Rlc3Ryb3knLCBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICAgIHZhciBzZWxmID0gdGhpcztcbiAgICAgIHZhciBvcHRzID0gdGhpcy5fX29wdHMgfHwge307XG4gICAgICBzZWxmLmluZm8oZnVuY3Rpb24gKGVyciwgaW5mbykge1xuICAgICAgICBpZiAoZXJyKSB7XG4gICAgICAgICAgcmV0dXJuIGNhbGxiYWNrKGVycik7XG4gICAgICAgIH1cbiAgICAgICAgb3B0cy5pbnRlcm5hbCA9IHRydWU7XG4gICAgICAgIHNlbGYuY29uc3RydWN0b3IuZGVzdHJveShpbmZvLmRiX25hbWUsIG9wdHMsIGNhbGxiYWNrKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgUG91Y2hEQi5hZGFwdGVyc1tvcHRzLmFkYXB0ZXJdLmNhbGwoc2VsZiwgb3B0cywgZnVuY3Rpb24gKGVycikge1xuICAgICAgaWYgKGVycikge1xuICAgICAgICBpZiAoY2FsbGJhY2spIHtcbiAgICAgICAgICBzZWxmLnRhc2txdWV1ZS5mYWlsKGVycik7XG4gICAgICAgICAgY2FsbGJhY2soZXJyKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBmdW5jdGlvbiBkZXN0cnVjdGlvbkxpc3RlbmVyKGV2ZW50KSB7XG4gICAgICAgIGlmIChldmVudCA9PT0gJ2Rlc3Ryb3llZCcpIHtcbiAgICAgICAgICBzZWxmLmVtaXQoJ2Rlc3Ryb3llZCcpO1xuICAgICAgICAgIFBvdWNoREIucmVtb3ZlTGlzdGVuZXIob3JpZ2luYWxOYW1lLCBkZXN0cnVjdGlvbkxpc3RlbmVyKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgUG91Y2hEQi5vbihvcmlnaW5hbE5hbWUsIGRlc3RydWN0aW9uTGlzdGVuZXIpO1xuICAgICAgc2VsZi5lbWl0KCdjcmVhdGVkJywgc2VsZik7XG4gICAgICBQb3VjaERCLmVtaXQoJ2NyZWF0ZWQnLCBvcHRzLm9yaWdpbmFsTmFtZSk7XG4gICAgICBzZWxmLnRhc2txdWV1ZS5yZWFkeShzZWxmKTtcbiAgICAgIGNhbGxiYWNrKG51bGwsIHNlbGYpO1xuICAgIH0pO1xuXG4gICAgaWYgKG9wdHMuc2tpcFNldHVwKSB7XG4gICAgICBzZWxmLnRhc2txdWV1ZS5yZWFkeShzZWxmKTtcbiAgICAgIHByb2Nlc3MubmV4dFRpY2soZnVuY3Rpb24gKCkge1xuICAgICAgICBjYWxsYmFjayhudWxsLCBzZWxmKTtcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGlmICh1dGlscy5pc0NvcmRvdmEoKSkge1xuICAgICAgLy90byBpbmZvcm0gd2Vic3FsIGFkYXB0ZXIgdGhhdCB3ZSBjYW4gdXNlIGFwaVxuICAgICAgY29yZG92YS5maXJlV2luZG93RXZlbnQob3B0cy5uYW1lICsgXCJfcG91Y2hcIiwge30pO1xuICAgIH1cbiAgfSk7XG4gIHByb21pc2UudGhlbihmdW5jdGlvbiAocmVzcCkge1xuICAgIG9sZENCKG51bGwsIHJlc3ApO1xuICB9LCBvbGRDQik7XG4gIHNlbGYudGhlbiA9IHByb21pc2UudGhlbi5iaW5kKHByb21pc2UpO1xuICBzZWxmW1wiY2F0Y2hcIl0gPSBwcm9taXNlW1wiY2F0Y2hcIl0uYmluZChwcm9taXNlKTtcbn1cblxuUG91Y2hEQi5kZWJ1ZyA9IHJlcXVpcmUoJ2RlYnVnJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gUG91Y2hEQjtcbiIsIlwidXNlIHN0cmljdFwiO1xuXG52YXIgcmVxdWVzdCA9IHJlcXVpcmUoJ3JlcXVlc3QnKTtcblxudmFyIGJ1ZmZlciA9IHJlcXVpcmUoJy4vYnVmZmVyJyk7XG52YXIgZXJyb3JzID0gcmVxdWlyZSgnLi9lcnJvcnMnKTtcbnZhciB1dGlscyA9IHJlcXVpcmUoJy4uL3V0aWxzJyk7XG5cbmZ1bmN0aW9uIGFqYXgob3B0aW9ucywgYWRhcHRlckNhbGxiYWNrKSB7XG5cbiAgdmFyIHJlcXVlc3RDb21wbGV0ZWQgPSBmYWxzZTtcbiAgdmFyIGNhbGxiYWNrID0gdXRpbHMuZ2V0QXJndW1lbnRzKGZ1bmN0aW9uIChhcmdzKSB7XG4gICAgaWYgKHJlcXVlc3RDb21wbGV0ZWQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgYWRhcHRlckNhbGxiYWNrLmFwcGx5KHRoaXMsIGFyZ3MpO1xuICAgIHJlcXVlc3RDb21wbGV0ZWQgPSB0cnVlO1xuICB9KTtcblxuICBpZiAodHlwZW9mIG9wdGlvbnMgPT09IFwiZnVuY3Rpb25cIikge1xuICAgIGNhbGxiYWNrID0gb3B0aW9ucztcbiAgICBvcHRpb25zID0ge307XG4gIH1cblxuICBvcHRpb25zID0gdXRpbHMuY2xvbmUob3B0aW9ucyk7XG5cbiAgdmFyIGRlZmF1bHRPcHRpb25zID0ge1xuICAgIG1ldGhvZCA6IFwiR0VUXCIsXG4gICAgaGVhZGVyczoge30sXG4gICAganNvbjogdHJ1ZSxcbiAgICBwcm9jZXNzRGF0YTogdHJ1ZSxcbiAgICB0aW1lb3V0OiAxMDAwMCxcbiAgICBjYWNoZTogZmFsc2VcbiAgfTtcblxuICBvcHRpb25zID0gdXRpbHMuZXh0ZW5kKHRydWUsIGRlZmF1bHRPcHRpb25zLCBvcHRpb25zKTtcblxuXG4gIGZ1bmN0aW9uIG9uU3VjY2VzcyhvYmosIHJlc3AsIGNiKSB7XG4gICAgaWYgKCFvcHRpb25zLmJpbmFyeSAmJiAhb3B0aW9ucy5qc29uICYmIG9wdGlvbnMucHJvY2Vzc0RhdGEgJiZcbiAgICAgIHR5cGVvZiBvYmogIT09ICdzdHJpbmcnKSB7XG4gICAgICBvYmogPSBKU09OLnN0cmluZ2lmeShvYmopO1xuICAgIH0gZWxzZSBpZiAoIW9wdGlvbnMuYmluYXJ5ICYmIG9wdGlvbnMuanNvbiAmJiB0eXBlb2Ygb2JqID09PSAnc3RyaW5nJykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgb2JqID0gSlNPTi5wYXJzZShvYmopO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAvLyBQcm9iYWJseSBhIG1hbGZvcm1lZCBKU09OIGZyb20gc2VydmVyXG4gICAgICAgIHJldHVybiBjYihlKTtcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKEFycmF5LmlzQXJyYXkob2JqKSkge1xuICAgICAgb2JqID0gb2JqLm1hcChmdW5jdGlvbiAodikge1xuICAgICAgICBpZiAodi5lcnJvciB8fCB2Lm1pc3NpbmcpIHtcbiAgICAgICAgICByZXR1cm4gZXJyb3JzLmdlbmVyYXRlRXJyb3JGcm9tUmVzcG9uc2Uodik7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmV0dXJuIHY7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cbiAgICBjYihudWxsLCBvYmosIHJlc3ApO1xuICB9XG5cbiAgZnVuY3Rpb24gb25FcnJvcihlcnIsIGNiKSB7XG4gICAgdmFyIGVyclBhcnNlZCwgZXJyT2JqO1xuICAgIGlmIChlcnIuY29kZSAmJiBlcnIuc3RhdHVzKSB7XG4gICAgICB2YXIgZXJyMiA9IG5ldyBFcnJvcihlcnIubWVzc2FnZSB8fCBlcnIuY29kZSk7XG4gICAgICBlcnIyLnN0YXR1cyA9IGVyci5zdGF0dXM7XG4gICAgICByZXR1cm4gY2IoZXJyMik7XG4gICAgfVxuICAgIHRyeSB7XG4gICAgICBlcnJQYXJzZWQgPSBKU09OLnBhcnNlKGVyci5yZXNwb25zZVRleHQpO1xuICAgICAgLy93b3VsZCBwcmVmZXIgbm90IHRvIGhhdmUgYSB0cnkvY2F0Y2ggY2xhdXNlXG4gICAgICBlcnJPYmogPSBlcnJvcnMuZ2VuZXJhdGVFcnJvckZyb21SZXNwb25zZShlcnJQYXJzZWQpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGVyck9iaiA9IGVycm9ycy5nZW5lcmF0ZUVycm9yRnJvbVJlc3BvbnNlKGVycik7XG4gICAgfVxuICAgIGNiKGVyck9iaik7XG4gIH1cblxuXG4gIGlmIChvcHRpb25zLmpzb24pIHtcbiAgICBpZiAoIW9wdGlvbnMuYmluYXJ5KSB7XG4gICAgICBvcHRpb25zLmhlYWRlcnMuQWNjZXB0ID0gJ2FwcGxpY2F0aW9uL2pzb24nO1xuICAgIH1cbiAgICBvcHRpb25zLmhlYWRlcnNbJ0NvbnRlbnQtVHlwZSddID0gb3B0aW9ucy5oZWFkZXJzWydDb250ZW50LVR5cGUnXSB8fFxuICAgICAgJ2FwcGxpY2F0aW9uL2pzb24nO1xuICB9XG5cbiAgaWYgKG9wdGlvbnMuYmluYXJ5KSB7XG4gICAgb3B0aW9ucy5lbmNvZGluZyA9IG51bGw7XG4gICAgb3B0aW9ucy5qc29uID0gZmFsc2U7XG4gIH1cblxuICBpZiAoIW9wdGlvbnMucHJvY2Vzc0RhdGEpIHtcbiAgICBvcHRpb25zLmpzb24gPSBmYWxzZTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGRlZmF1bHRCb2R5KGRhdGEpIHtcbiAgICBpZiAocHJvY2Vzcy5icm93c2VyKSB7XG4gICAgICByZXR1cm4gJyc7XG4gICAgfVxuICAgIHJldHVybiBuZXcgYnVmZmVyKCcnLCAnYmluYXJ5Jyk7XG4gIH1cblxuICByZXR1cm4gcmVxdWVzdChvcHRpb25zLCBmdW5jdGlvbiAoZXJyLCByZXNwb25zZSwgYm9keSkge1xuICAgIGlmIChlcnIpIHtcbiAgICAgIGVyci5zdGF0dXMgPSByZXNwb25zZSA/IHJlc3BvbnNlLnN0YXR1c0NvZGUgOiA0MDA7XG4gICAgICByZXR1cm4gb25FcnJvcihlcnIsIGNhbGxiYWNrKTtcbiAgICB9XG5cbiAgICB2YXIgZXJyb3I7XG4gICAgdmFyIGNvbnRlbnRfdHlwZSA9IHJlc3BvbnNlLmhlYWRlcnMgJiYgcmVzcG9uc2UuaGVhZGVyc1snY29udGVudC10eXBlJ107XG4gICAgdmFyIGRhdGEgPSBib2R5IHx8IGRlZmF1bHRCb2R5KCk7XG5cbiAgICAvLyBDb3VjaERCIGRvZXNuJ3QgYWx3YXlzIHJldHVybiB0aGUgcmlnaHQgY29udGVudC10eXBlIGZvciBKU09OIGRhdGEsIHNvXG4gICAgLy8gd2UgY2hlY2sgZm9yIF57IGFuZCB9JCAoaWdub3JpbmcgbGVhZGluZy90cmFpbGluZyB3aGl0ZXNwYWNlKVxuICAgIGlmICghb3B0aW9ucy5iaW5hcnkgJiYgKG9wdGlvbnMuanNvbiB8fCAhb3B0aW9ucy5wcm9jZXNzRGF0YSkgJiZcbiAgICAgICAgdHlwZW9mIGRhdGEgIT09ICdvYmplY3QnICYmXG4gICAgICAgICgvanNvbi8udGVzdChjb250ZW50X3R5cGUpIHx8XG4gICAgICAgICAoL15bXFxzXSpcXHsvLnRlc3QoZGF0YSkgJiYgL1xcfVtcXHNdKiQvLnRlc3QoZGF0YSkpKSkge1xuICAgICAgZGF0YSA9IEpTT04ucGFyc2UoZGF0YSk7XG4gICAgfVxuXG4gICAgaWYgKHJlc3BvbnNlLnN0YXR1c0NvZGUgPj0gMjAwICYmIHJlc3BvbnNlLnN0YXR1c0NvZGUgPCAzMDApIHtcbiAgICAgIG9uU3VjY2VzcyhkYXRhLCByZXNwb25zZSwgY2FsbGJhY2spO1xuICAgIH0gZWxzZSB7XG4gICAgICBpZiAob3B0aW9ucy5iaW5hcnkpIHtcbiAgICAgICAgZGF0YSA9IEpTT04ucGFyc2UoZGF0YS50b1N0cmluZygpKTtcbiAgICAgIH1cbiAgICAgIGVycm9yID0gZXJyb3JzLmdlbmVyYXRlRXJyb3JGcm9tUmVzcG9uc2UoZGF0YSk7XG4gICAgICBlcnJvci5zdGF0dXMgPSByZXNwb25zZS5zdGF0dXNDb2RlO1xuICAgICAgY2FsbGJhY2soZXJyb3IpO1xuICAgIH1cbiAgfSk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gYWpheDtcbiIsIlwidXNlIHN0cmljdFwiO1xuXG4vL0Fic3RyYWN0cyBjb25zdHJ1Y3RpbmcgYSBCbG9iIG9iamVjdCwgc28gaXQgYWxzbyB3b3JrcyBpbiBvbGRlclxuLy9icm93c2VycyB0aGF0IGRvbid0IHN1cHBvcnQgdGhlIG5hdGl2ZSBCbG9iIGNvbnN0cnVjdG9yLiAoaS5lLlxuLy9vbGQgUXRXZWJLaXQgdmVyc2lvbnMsIGF0IGxlYXN0KS5cbmZ1bmN0aW9uIGNyZWF0ZUJsb2IocGFydHMsIHByb3BlcnRpZXMpIHtcbiAgcGFydHMgPSBwYXJ0cyB8fCBbXTtcbiAgcHJvcGVydGllcyA9IHByb3BlcnRpZXMgfHwge307XG4gIHRyeSB7XG4gICAgcmV0dXJuIG5ldyBCbG9iKHBhcnRzLCBwcm9wZXJ0aWVzKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGlmIChlLm5hbWUgIT09IFwiVHlwZUVycm9yXCIpIHtcbiAgICAgIHRocm93IGU7XG4gICAgfVxuICAgIHZhciBCbG9iQnVpbGRlciA9IGdsb2JhbC5CbG9iQnVpbGRlciB8fFxuICAgICAgICAgICAgICAgICAgICAgIGdsb2JhbC5NU0Jsb2JCdWlsZGVyIHx8XG4gICAgICAgICAgICAgICAgICAgICAgZ2xvYmFsLk1vekJsb2JCdWlsZGVyIHx8XG4gICAgICAgICAgICAgICAgICAgICAgZ2xvYmFsLldlYktpdEJsb2JCdWlsZGVyO1xuICAgIHZhciBidWlsZGVyID0gbmV3IEJsb2JCdWlsZGVyKCk7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBwYXJ0cy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgYnVpbGRlci5hcHBlbmQocGFydHNbaV0pO1xuICAgIH1cbiAgICByZXR1cm4gYnVpbGRlci5nZXRCbG9iKHByb3BlcnRpZXMudHlwZSk7XG4gIH1cbn1cblxubW9kdWxlLmV4cG9ydHMgPSBjcmVhdGVCbG9iO1xuXG4iLCIvLyBoZXkgZ3Vlc3Mgd2hhdCwgd2UgZG9uJ3QgbmVlZCB0aGlzIGluIHRoZSBicm93c2VyXG5tb2R1bGUuZXhwb3J0cyA9IHt9OyIsIlwidXNlIHN0cmljdFwiO1xuXG52YXIgaW5oZXJpdHMgPSByZXF1aXJlKCdpbmhlcml0cycpO1xuaW5oZXJpdHMoUG91Y2hFcnJvciwgRXJyb3IpO1xuXG5mdW5jdGlvbiBQb3VjaEVycm9yKG9wdHMpIHtcbiAgRXJyb3IuY2FsbChvcHRzLnJlYXNvbik7XG4gIHRoaXMuc3RhdHVzID0gb3B0cy5zdGF0dXM7XG4gIHRoaXMubmFtZSA9IG9wdHMuZXJyb3I7XG4gIHRoaXMubWVzc2FnZSA9IG9wdHMucmVhc29uO1xuICB0aGlzLmVycm9yID0gdHJ1ZTtcbn1cblxuUG91Y2hFcnJvci5wcm90b3R5cGUudG9TdHJpbmcgPSBmdW5jdGlvbiAoKSB7XG4gIHJldHVybiBKU09OLnN0cmluZ2lmeSh7XG4gICAgc3RhdHVzOiB0aGlzLnN0YXR1cyxcbiAgICBuYW1lOiB0aGlzLm5hbWUsXG4gICAgbWVzc2FnZTogdGhpcy5tZXNzYWdlXG4gIH0pO1xufTtcblxuZXhwb3J0cy5VTkFVVEhPUklaRUQgPSBuZXcgUG91Y2hFcnJvcih7XG4gIHN0YXR1czogNDAxLFxuICBlcnJvcjogJ3VuYXV0aG9yaXplZCcsXG4gIHJlYXNvbjogXCJOYW1lIG9yIHBhc3N3b3JkIGlzIGluY29ycmVjdC5cIlxufSk7XG5cbmV4cG9ydHMuTUlTU0lOR19CVUxLX0RPQ1MgPSBuZXcgUG91Y2hFcnJvcih7XG4gIHN0YXR1czogNDAwLFxuICBlcnJvcjogJ2JhZF9yZXF1ZXN0JyxcbiAgcmVhc29uOiBcIk1pc3NpbmcgSlNPTiBsaXN0IG9mICdkb2NzJ1wiXG59KTtcblxuZXhwb3J0cy5NSVNTSU5HX0RPQyA9IG5ldyBQb3VjaEVycm9yKHtcbiAgc3RhdHVzOiA0MDQsXG4gIGVycm9yOiAnbm90X2ZvdW5kJyxcbiAgcmVhc29uOiAnbWlzc2luZydcbn0pO1xuXG5leHBvcnRzLlJFVl9DT05GTElDVCA9IG5ldyBQb3VjaEVycm9yKHtcbiAgc3RhdHVzOiA0MDksXG4gIGVycm9yOiAnY29uZmxpY3QnLFxuICByZWFzb246ICdEb2N1bWVudCB1cGRhdGUgY29uZmxpY3QnXG59KTtcblxuZXhwb3J0cy5JTlZBTElEX0lEID0gbmV3IFBvdWNoRXJyb3Ioe1xuICBzdGF0dXM6IDQwMCxcbiAgZXJyb3I6ICdpbnZhbGlkX2lkJyxcbiAgcmVhc29uOiAnX2lkIGZpZWxkIG11c3QgY29udGFpbiBhIHN0cmluZydcbn0pO1xuXG5leHBvcnRzLk1JU1NJTkdfSUQgPSBuZXcgUG91Y2hFcnJvcih7XG4gIHN0YXR1czogNDEyLFxuICBlcnJvcjogJ21pc3NpbmdfaWQnLFxuICByZWFzb246ICdfaWQgaXMgcmVxdWlyZWQgZm9yIHB1dHMnXG59KTtcblxuZXhwb3J0cy5SRVNFUlZFRF9JRCA9IG5ldyBQb3VjaEVycm9yKHtcbiAgc3RhdHVzOiA0MDAsXG4gIGVycm9yOiAnYmFkX3JlcXVlc3QnLFxuICByZWFzb246ICdPbmx5IHJlc2VydmVkIGRvY3VtZW50IGlkcyBtYXkgc3RhcnQgd2l0aCB1bmRlcnNjb3JlLidcbn0pO1xuXG5leHBvcnRzLk5PVF9PUEVOID0gbmV3IFBvdWNoRXJyb3Ioe1xuICBzdGF0dXM6IDQxMixcbiAgZXJyb3I6ICdwcmVjb25kaXRpb25fZmFpbGVkJyxcbiAgcmVhc29uOiAnRGF0YWJhc2Ugbm90IG9wZW4nXG59KTtcblxuZXhwb3J0cy5VTktOT1dOX0VSUk9SID0gbmV3IFBvdWNoRXJyb3Ioe1xuICBzdGF0dXM6IDUwMCxcbiAgZXJyb3I6ICd1bmtub3duX2Vycm9yJyxcbiAgcmVhc29uOiAnRGF0YWJhc2UgZW5jb3VudGVyZWQgYW4gdW5rbm93biBlcnJvcidcbn0pO1xuXG5leHBvcnRzLkJBRF9BUkcgPSBuZXcgUG91Y2hFcnJvcih7XG4gIHN0YXR1czogNTAwLFxuICBlcnJvcjogJ2JhZGFyZycsXG4gIHJlYXNvbjogJ1NvbWUgcXVlcnkgYXJndW1lbnQgaXMgaW52YWxpZCdcbn0pO1xuXG5leHBvcnRzLklOVkFMSURfUkVRVUVTVCA9IG5ldyBQb3VjaEVycm9yKHtcbiAgc3RhdHVzOiA0MDAsXG4gIGVycm9yOiAnaW52YWxpZF9yZXF1ZXN0JyxcbiAgcmVhc29uOiAnUmVxdWVzdCB3YXMgaW52YWxpZCdcbn0pO1xuXG5leHBvcnRzLlFVRVJZX1BBUlNFX0VSUk9SID0gbmV3IFBvdWNoRXJyb3Ioe1xuICBzdGF0dXM6IDQwMCxcbiAgZXJyb3I6ICdxdWVyeV9wYXJzZV9lcnJvcicsXG4gIHJlYXNvbjogJ1NvbWUgcXVlcnkgcGFyYW1ldGVyIGlzIGludmFsaWQnXG59KTtcblxuZXhwb3J0cy5ET0NfVkFMSURBVElPTiA9IG5ldyBQb3VjaEVycm9yKHtcbiAgc3RhdHVzOiA1MDAsXG4gIGVycm9yOiAnZG9jX3ZhbGlkYXRpb24nLFxuICByZWFzb246ICdCYWQgc3BlY2lhbCBkb2N1bWVudCBtZW1iZXInXG59KTtcblxuZXhwb3J0cy5CQURfUkVRVUVTVCA9IG5ldyBQb3VjaEVycm9yKHtcbiAgc3RhdHVzOiA0MDAsXG4gIGVycm9yOiAnYmFkX3JlcXVlc3QnLFxuICByZWFzb246ICdTb21ldGhpbmcgd3Jvbmcgd2l0aCB0aGUgcmVxdWVzdCdcbn0pO1xuXG5leHBvcnRzLk5PVF9BTl9PQkpFQ1QgPSBuZXcgUG91Y2hFcnJvcih7XG4gIHN0YXR1czogNDAwLFxuICBlcnJvcjogJ2JhZF9yZXF1ZXN0JyxcbiAgcmVhc29uOiAnRG9jdW1lbnQgbXVzdCBiZSBhIEpTT04gb2JqZWN0J1xufSk7XG5cbmV4cG9ydHMuREJfTUlTU0lORyA9IG5ldyBQb3VjaEVycm9yKHtcbiAgc3RhdHVzOiA0MDQsXG4gIGVycm9yOiAnbm90X2ZvdW5kJyxcbiAgcmVhc29uOiAnRGF0YWJhc2Ugbm90IGZvdW5kJ1xufSk7XG5cbmV4cG9ydHMuSURCX0VSUk9SID0gbmV3IFBvdWNoRXJyb3Ioe1xuICBzdGF0dXM6IDUwMCxcbiAgZXJyb3I6ICdpbmRleGVkX2RiX3dlbnRfYmFkJyxcbiAgcmVhc29uOiAndW5rbm93bidcbn0pO1xuXG5leHBvcnRzLldTUV9FUlJPUiA9IG5ldyBQb3VjaEVycm9yKHtcbiAgc3RhdHVzOiA1MDAsXG4gIGVycm9yOiAnd2ViX3NxbF93ZW50X2JhZCcsXG4gIHJlYXNvbjogJ3Vua25vd24nXG59KTtcblxuZXhwb3J0cy5MREJfRVJST1IgPSBuZXcgUG91Y2hFcnJvcih7XG4gIHN0YXR1czogNTAwLFxuICBlcnJvcjogJ2xldmVsREJfd2VudF93ZW50X2JhZCcsXG4gIHJlYXNvbjogJ3Vua25vd24nXG59KTtcblxuZXhwb3J0cy5GT1JCSURERU4gPSBuZXcgUG91Y2hFcnJvcih7XG4gIHN0YXR1czogNDAzLFxuICBlcnJvcjogJ2ZvcmJpZGRlbicsXG4gIHJlYXNvbjogJ0ZvcmJpZGRlbiBieSBkZXNpZ24gZG9jIHZhbGlkYXRlX2RvY191cGRhdGUgZnVuY3Rpb24nXG59KTtcblxuZXhwb3J0cy5JTlZBTElEX1JFViA9IG5ldyBQb3VjaEVycm9yKHtcbiAgc3RhdHVzOiA0MDAsXG4gIGVycm9yOiAnYmFkX3JlcXVlc3QnLFxuICByZWFzb246ICdJbnZhbGlkIHJldiBmb3JtYXQnXG59KTtcblxuZXhwb3J0cy5GSUxFX0VYSVNUUyA9IG5ldyBQb3VjaEVycm9yKHtcbiAgc3RhdHVzOiA0MTIsXG4gIGVycm9yOiAnZmlsZV9leGlzdHMnLFxuICByZWFzb246ICdUaGUgZGF0YWJhc2UgY291bGQgbm90IGJlIGNyZWF0ZWQsIHRoZSBmaWxlIGFscmVhZHkgZXhpc3RzLidcbn0pO1xuXG5leHBvcnRzLk1JU1NJTkdfU1RVQiA9IG5ldyBQb3VjaEVycm9yKHtcbiAgc3RhdHVzOiA0MTIsXG4gIGVycm9yOiAnbWlzc2luZ19zdHViJ1xufSk7XG5cbmV4cG9ydHMuZXJyb3IgPSBmdW5jdGlvbiAoZXJyb3IsIHJlYXNvbiwgbmFtZSkge1xuICBmdW5jdGlvbiBDdXN0b21Qb3VjaEVycm9yKHJlYXNvbikge1xuICAgIC8vIGluaGVyaXQgZXJyb3IgcHJvcGVydGllcyBmcm9tIG91ciBwYXJlbnQgZXJyb3IgbWFudWFsbHlcbiAgICAvLyBzbyBhcyB0byBhbGxvdyBwcm9wZXIgSlNPTiBwYXJzaW5nLlxuICAgIC8qIGpzaGludCBpZ25vcmU6c3RhcnQgKi9cbiAgICBmb3IgKHZhciBwIGluIGVycm9yKSB7XG4gICAgICBpZiAodHlwZW9mIGVycm9yW3BdICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIHRoaXNbcF0gPSBlcnJvcltwXTtcbiAgICAgIH1cbiAgICB9XG4gICAgLyoganNoaW50IGlnbm9yZTplbmQgKi9cbiAgICBpZiAobmFtZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLm5hbWUgPSBuYW1lO1xuICAgIH1cbiAgICBpZiAocmVhc29uICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMucmVhc29uID0gcmVhc29uO1xuICAgIH1cbiAgfVxuICBDdXN0b21Qb3VjaEVycm9yLnByb3RvdHlwZSA9IFBvdWNoRXJyb3IucHJvdG90eXBlO1xuICByZXR1cm4gbmV3IEN1c3RvbVBvdWNoRXJyb3IocmVhc29uKTtcbn07XG5cbi8vIEZpbmQgb25lIG9mIHRoZSBlcnJvcnMgZGVmaW5lZCBhYm92ZSBiYXNlZCBvbiB0aGUgdmFsdWVcbi8vIG9mIHRoZSBzcGVjaWZpZWQgcHJvcGVydHkuXG4vLyBJZiByZWFzb24gaXMgcHJvdmlkZWQgcHJlZmVyIHRoZSBlcnJvciBtYXRjaGluZyB0aGF0IHJlYXNvbi5cbi8vIFRoaXMgaXMgZm9yIGRpZmZlcmVudGlhdGluZyBiZXR3ZWVuIGVycm9ycyB3aXRoIHRoZSBzYW1lIG5hbWUgYW5kIHN0YXR1cyxcbi8vIGVnLCBiYWRfcmVxdWVzdC5cbmV4cG9ydHMuZ2V0RXJyb3JUeXBlQnlQcm9wID0gZnVuY3Rpb24gKHByb3AsIHZhbHVlLCByZWFzb24pIHtcbiAgdmFyIGVycm9ycyA9IGV4cG9ydHM7XG4gIHZhciBrZXlzID0gT2JqZWN0LmtleXMoZXJyb3JzKS5maWx0ZXIoZnVuY3Rpb24gKGtleSkge1xuICAgIHZhciBlcnJvciA9IGVycm9yc1trZXldO1xuICAgIHJldHVybiB0eXBlb2YgZXJyb3IgIT09ICdmdW5jdGlvbicgJiYgZXJyb3JbcHJvcF0gPT09IHZhbHVlO1xuICB9KTtcbiAgdmFyIGtleSA9IHJlYXNvbiAmJiBrZXlzLmZpbHRlcihmdW5jdGlvbiAoa2V5KSB7XG4gICAgICAgIHZhciBlcnJvciA9IGVycm9yc1trZXldO1xuICAgICAgICByZXR1cm4gZXJyb3IubWVzc2FnZSA9PT0gcmVhc29uO1xuICAgICAgfSlbMF0gfHwga2V5c1swXTtcbiAgcmV0dXJuIChrZXkpID8gZXJyb3JzW2tleV0gOiBudWxsO1xufTtcblxuZXhwb3J0cy5nZW5lcmF0ZUVycm9yRnJvbVJlc3BvbnNlID0gZnVuY3Rpb24gKHJlcykge1xuICB2YXIgZXJyb3IsIGVyck5hbWUsIGVyclR5cGUsIGVyck1zZywgZXJyUmVhc29uO1xuICB2YXIgZXJyb3JzID0gZXhwb3J0cztcblxuICBlcnJOYW1lID0gKHJlcy5lcnJvciA9PT0gdHJ1ZSAmJiB0eXBlb2YgcmVzLm5hbWUgPT09ICdzdHJpbmcnKSA/XG4gICAgICAgICAgICAgIHJlcy5uYW1lIDpcbiAgICAgICAgICAgICAgcmVzLmVycm9yO1xuICBlcnJSZWFzb24gPSByZXMucmVhc29uO1xuICBlcnJUeXBlID0gZXJyb3JzLmdldEVycm9yVHlwZUJ5UHJvcCgnbmFtZScsIGVyck5hbWUsIGVyclJlYXNvbik7XG5cbiAgaWYgKHJlcy5taXNzaW5nIHx8XG4gICAgICBlcnJSZWFzb24gPT09ICdtaXNzaW5nJyB8fFxuICAgICAgZXJyUmVhc29uID09PSAnZGVsZXRlZCcgfHxcbiAgICAgIGVyck5hbWUgPT09ICdub3RfZm91bmQnKSB7XG4gICAgZXJyVHlwZSA9IGVycm9ycy5NSVNTSU5HX0RPQztcbiAgfSBlbHNlIGlmIChlcnJOYW1lID09PSAnZG9jX3ZhbGlkYXRpb24nKSB7XG4gICAgLy8gZG9jIHZhbGlkYXRpb24gbmVlZHMgc3BlY2lhbCB0cmVhdG1lbnQgc2luY2VcbiAgICAvLyByZXMucmVhc29uIGRlcGVuZHMgb24gdGhlIHZhbGlkYXRpb24gZXJyb3IuXG4gICAgLy8gc2VlIHV0aWxzLmpzXG4gICAgZXJyVHlwZSA9IGVycm9ycy5ET0NfVkFMSURBVElPTjtcbiAgICBlcnJNc2cgPSBlcnJSZWFzb247XG4gIH0gZWxzZSBpZiAoZXJyTmFtZSA9PT0gJ2JhZF9yZXF1ZXN0JyAmJiBlcnJUeXBlLm1lc3NhZ2UgIT09IGVyclJlYXNvbikge1xuICAgIC8vIGlmIGJhZF9yZXF1ZXN0IGVycm9yIGFscmVhZHkgZm91bmQgYmFzZWQgb24gcmVhc29uIGRvbid0IG92ZXJyaWRlLlxuXG4gICAgLy8gYXR0YWNobWVudCBlcnJvcnMuXG4gICAgaWYgKGVyclJlYXNvbi5pbmRleE9mKCd1bmtub3duIHN0dWIgYXR0YWNobWVudCcpID09PSAwKSB7XG4gICAgICBlcnJUeXBlID0gZXJyb3JzLk1JU1NJTkdfU1RVQjtcbiAgICAgIGVyck1zZyA9IGVyclJlYXNvbjtcbiAgICB9IGVsc2Uge1xuICAgICAgZXJyVHlwZSA9IGVycm9ycy5CQURfUkVRVUVTVDtcbiAgICB9XG4gIH1cblxuICAvLyBmYWxsYmFjayB0byBlcnJvciBieSBzdGF0eXMgb3IgdW5rbm93biBlcnJvci5cbiAgaWYgKCFlcnJUeXBlKSB7XG4gICAgZXJyVHlwZSA9IGVycm9ycy5nZXRFcnJvclR5cGVCeVByb3AoJ3N0YXR1cycsIHJlcy5zdGF0dXMsIGVyclJlYXNvbikgfHxcbiAgICAgICAgICAgICAgICBlcnJvcnMuVU5LTk9XTl9FUlJPUjtcbiAgfVxuXG4gIGVycm9yID0gZXJyb3JzLmVycm9yKGVyclR5cGUsIGVyclJlYXNvbiwgZXJyTmFtZSk7XG5cbiAgLy8gS2VlcCBjdXN0b20gbWVzc2FnZS5cbiAgaWYgKGVyck1zZykge1xuICAgIGVycm9yLm1lc3NhZ2UgPSBlcnJNc2c7XG4gIH1cblxuICAvLyBLZWVwIGhlbHBmdWwgcmVzcG9uc2UgZGF0YSBpbiBvdXIgZXJyb3IgbWVzc2FnZXMuXG4gIGlmIChyZXMuaWQpIHtcbiAgICBlcnJvci5pZCA9IHJlcy5pZDtcbiAgfVxuICBpZiAocmVzLnN0YXR1cykge1xuICAgIGVycm9yLnN0YXR1cyA9IHJlcy5zdGF0dXM7XG4gIH1cbiAgaWYgKHJlcy5zdGF0dXNUZXh0KSB7XG4gICAgZXJyb3IubmFtZSA9IHJlcy5zdGF0dXNUZXh0O1xuICB9XG4gIGlmIChyZXMubWlzc2luZykge1xuICAgIGVycm9yLm1pc3NpbmcgPSByZXMubWlzc2luZztcbiAgfVxuXG4gIHJldHVybiBlcnJvcjtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBjcnlwdG8gPSByZXF1aXJlKCdjcnlwdG8nKTtcbnZhciBNZDUgPSByZXF1aXJlKCdzcGFyay1tZDUnKTtcbnZhciBzZXRJbW1lZGlhdGVTaGltID0gZ2xvYmFsLnNldEltbWVkaWF0ZSB8fCBnbG9iYWwuc2V0VGltZW91dDtcbnZhciBNRDVfQ0hVTktfU0laRSA9IDMyNzY4O1xuXG4vLyBjb252ZXJ0IGEgNjQtYml0IGludCB0byBhIGJpbmFyeSBzdHJpbmdcbmZ1bmN0aW9uIGludFRvU3RyaW5nKGludCkge1xuICB2YXIgYnl0ZXMgPSBbXG4gICAgKGludCAmIDB4ZmYpLFxuICAgICgoaW50ID4+PiA4KSAmIDB4ZmYpLFxuICAgICgoaW50ID4+PiAxNikgJiAweGZmKSxcbiAgICAoKGludCA+Pj4gMjQpICYgMHhmZilcbiAgXTtcbiAgcmV0dXJuIGJ5dGVzLm1hcChmdW5jdGlvbiAoYnl0ZSkge1xuICAgIHJldHVybiBTdHJpbmcuZnJvbUNoYXJDb2RlKGJ5dGUpO1xuICB9KS5qb2luKCcnKTtcbn1cblxuLy8gY29udmVydCBhbiBhcnJheSBvZiA2NC1iaXQgaW50cyBpbnRvXG4vLyBhIGJhc2U2NC1lbmNvZGVkIHN0cmluZ1xuZnVuY3Rpb24gcmF3VG9CYXNlNjQocmF3KSB7XG4gIHZhciByZXMgPSAnJztcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCByYXcubGVuZ3RoOyBpKyspIHtcbiAgICByZXMgKz0gaW50VG9TdHJpbmcocmF3W2ldKTtcbiAgfVxuICByZXR1cm4gYnRvYShyZXMpO1xufVxuXG5mdW5jdGlvbiBhcHBlbmRCdWZmZXIoYnVmZmVyLCBkYXRhLCBzdGFydCwgZW5kKSB7XG4gIGlmIChzdGFydCA+IDAgfHwgZW5kIDwgZGF0YS5ieXRlTGVuZ3RoKSB7XG4gICAgLy8gb25seSBjcmVhdGUgYSBzdWJhcnJheSBpZiB3ZSByZWFsbHkgbmVlZCB0b1xuICAgIGRhdGEgPSBuZXcgVWludDhBcnJheShkYXRhLCBzdGFydCxcbiAgICAgIE1hdGgubWluKGVuZCwgZGF0YS5ieXRlTGVuZ3RoKSAtIHN0YXJ0KTtcbiAgfVxuICBidWZmZXIuYXBwZW5kKGRhdGEpO1xufVxuXG5mdW5jdGlvbiBhcHBlbmRTdHJpbmcoYnVmZmVyLCBkYXRhLCBzdGFydCwgZW5kKSB7XG4gIGlmIChzdGFydCA+IDAgfHwgZW5kIDwgZGF0YS5sZW5ndGgpIHtcbiAgICAvLyBvbmx5IGNyZWF0ZSBhIHN1YnN0cmluZyBpZiB3ZSByZWFsbHkgbmVlZCB0b1xuICAgIGRhdGEgPSBkYXRhLnN1YnN0cmluZyhzdGFydCwgZW5kKTtcbiAgfVxuICBidWZmZXIuYXBwZW5kQmluYXJ5KGRhdGEpO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChkYXRhLCBjYWxsYmFjaykge1xuICBpZiAoIXByb2Nlc3MuYnJvd3Nlcikge1xuICAgIHZhciBiYXNlNjQgPSBjcnlwdG8uY3JlYXRlSGFzaCgnbWQ1JykudXBkYXRlKGRhdGEpLmRpZ2VzdCgnYmFzZTY0Jyk7XG4gICAgY2FsbGJhY2sobnVsbCwgYmFzZTY0KTtcbiAgICByZXR1cm47XG4gIH1cbiAgdmFyIGlucHV0SXNTdHJpbmcgPSB0eXBlb2YgZGF0YSA9PT0gJ3N0cmluZyc7XG4gIHZhciBsZW4gPSBpbnB1dElzU3RyaW5nID8gZGF0YS5sZW5ndGggOiBkYXRhLmJ5dGVMZW5ndGg7XG4gIHZhciBjaHVua1NpemUgPSBNYXRoLm1pbihNRDVfQ0hVTktfU0laRSwgbGVuKTtcbiAgdmFyIGNodW5rcyA9IE1hdGguY2VpbChsZW4gLyBjaHVua1NpemUpO1xuICB2YXIgY3VycmVudENodW5rID0gMDtcbiAgdmFyIGJ1ZmZlciA9IGlucHV0SXNTdHJpbmcgPyBuZXcgTWQ1KCkgOiBuZXcgTWQ1LkFycmF5QnVmZmVyKCk7XG5cbiAgdmFyIGFwcGVuZCA9IGlucHV0SXNTdHJpbmcgPyBhcHBlbmRTdHJpbmcgOiBhcHBlbmRCdWZmZXI7XG5cbiAgZnVuY3Rpb24gbG9hZE5leHRDaHVuaygpIHtcbiAgICB2YXIgc3RhcnQgPSBjdXJyZW50Q2h1bmsgKiBjaHVua1NpemU7XG4gICAgdmFyIGVuZCA9IHN0YXJ0ICsgY2h1bmtTaXplO1xuICAgIGN1cnJlbnRDaHVuaysrO1xuICAgIGlmIChjdXJyZW50Q2h1bmsgPCBjaHVua3MpIHtcbiAgICAgIGFwcGVuZChidWZmZXIsIGRhdGEsIHN0YXJ0LCBlbmQpO1xuICAgICAgc2V0SW1tZWRpYXRlU2hpbShsb2FkTmV4dENodW5rKTtcbiAgICB9IGVsc2Uge1xuICAgICAgYXBwZW5kKGJ1ZmZlciwgZGF0YSwgc3RhcnQsIGVuZCk7XG4gICAgICB2YXIgcmF3ID0gYnVmZmVyLmVuZCh0cnVlKTtcbiAgICAgIHZhciBiYXNlNjQgPSByYXdUb0Jhc2U2NChyYXcpO1xuICAgICAgY2FsbGJhY2sobnVsbCwgYmFzZTY0KTtcbiAgICAgIGJ1ZmZlci5kZXN0cm95KCk7XG4gICAgfVxuICB9XG4gIGxvYWROZXh0Q2h1bmsoKTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBlcnJvcnMgPSByZXF1aXJlKCcuL2Vycm9ycycpO1xudmFyIHV1aWQgPSByZXF1aXJlKCcuL3V1aWQnKTtcblxuZnVuY3Rpb24gdG9PYmplY3QoYXJyYXkpIHtcbiAgcmV0dXJuIGFycmF5LnJlZHVjZShmdW5jdGlvbiAob2JqLCBpdGVtKSB7XG4gICAgb2JqW2l0ZW1dID0gdHJ1ZTtcbiAgICByZXR1cm4gb2JqO1xuICB9LCB7fSk7XG59XG4vLyBMaXN0IG9mIHRvcCBsZXZlbCByZXNlcnZlZCB3b3JkcyBmb3IgZG9jXG52YXIgcmVzZXJ2ZWRXb3JkcyA9IHRvT2JqZWN0KFtcbiAgJ19pZCcsXG4gICdfcmV2JyxcbiAgJ19hdHRhY2htZW50cycsXG4gICdfZGVsZXRlZCcsXG4gICdfcmV2aXNpb25zJyxcbiAgJ19yZXZzX2luZm8nLFxuICAnX2NvbmZsaWN0cycsXG4gICdfZGVsZXRlZF9jb25mbGljdHMnLFxuICAnX2xvY2FsX3NlcScsXG4gICdfcmV2X3RyZWUnLFxuICAvL3JlcGxpY2F0aW9uIGRvY3VtZW50c1xuICAnX3JlcGxpY2F0aW9uX2lkJyxcbiAgJ19yZXBsaWNhdGlvbl9zdGF0ZScsXG4gICdfcmVwbGljYXRpb25fc3RhdGVfdGltZScsXG4gICdfcmVwbGljYXRpb25fc3RhdGVfcmVhc29uJyxcbiAgJ19yZXBsaWNhdGlvbl9zdGF0cycsXG4gIC8vIFNwZWNpZmljIHRvIENvdWNoYmFzZSBTeW5jIEdhdGV3YXlcbiAgJ19yZW1vdmVkJ1xuXSk7XG5cbi8vIExpc3Qgb2YgcmVzZXJ2ZWQgd29yZHMgdGhhdCBzaG91bGQgZW5kIHVwIHRoZSBkb2N1bWVudFxudmFyIGRhdGFXb3JkcyA9IHRvT2JqZWN0KFtcbiAgJ19hdHRhY2htZW50cycsXG4gIC8vcmVwbGljYXRpb24gZG9jdW1lbnRzXG4gICdfcmVwbGljYXRpb25faWQnLFxuICAnX3JlcGxpY2F0aW9uX3N0YXRlJyxcbiAgJ19yZXBsaWNhdGlvbl9zdGF0ZV90aW1lJyxcbiAgJ19yZXBsaWNhdGlvbl9zdGF0ZV9yZWFzb24nLFxuICAnX3JlcGxpY2F0aW9uX3N0YXRzJ1xuXSk7XG5cbi8vIERldGVybWluZSBpZCBhbiBJRCBpcyB2YWxpZFxuLy8gICAtIGludmFsaWQgSURzIGJlZ2luIHdpdGggYW4gdW5kZXJlc2NvcmUgdGhhdCBkb2VzIG5vdCBiZWdpbiAnX2Rlc2lnbicgb3Jcbi8vICAgICAnX2xvY2FsJ1xuLy8gICAtIGFueSBvdGhlciBzdHJpbmcgdmFsdWUgaXMgYSB2YWxpZCBpZFxuLy8gUmV0dXJucyB0aGUgc3BlY2lmaWMgZXJyb3Igb2JqZWN0IGZvciBlYWNoIGNhc2VcbmV4cG9ydHMuaW52YWxpZElkRXJyb3IgPSBmdW5jdGlvbiAoaWQpIHtcbiAgdmFyIGVycjtcbiAgaWYgKCFpZCkge1xuICAgIGVyciA9IGVycm9ycy5lcnJvcihlcnJvcnMuTUlTU0lOR19JRCk7XG4gIH0gZWxzZSBpZiAodHlwZW9mIGlkICE9PSAnc3RyaW5nJykge1xuICAgIGVyciA9IGVycm9ycy5lcnJvcihlcnJvcnMuSU5WQUxJRF9JRCk7XG4gIH0gZWxzZSBpZiAoL15fLy50ZXN0KGlkKSAmJiAhKC9eXyhkZXNpZ258bG9jYWwpLykudGVzdChpZCkpIHtcbiAgICBlcnIgPSBlcnJvcnMuZXJyb3IoZXJyb3JzLlJFU0VSVkVEX0lEKTtcbiAgfVxuICBpZiAoZXJyKSB7XG4gICAgdGhyb3cgZXJyO1xuICB9XG59O1xuXG5mdW5jdGlvbiBwYXJzZVJldmlzaW9uSW5mbyhyZXYpIHtcbiAgaWYgKCEvXlxcZCtcXC0uLy50ZXN0KHJldikpIHtcbiAgICByZXR1cm4gZXJyb3JzLmVycm9yKGVycm9ycy5JTlZBTElEX1JFVik7XG4gIH1cbiAgdmFyIGlkeCA9IHJldi5pbmRleE9mKCctJyk7XG4gIHZhciBsZWZ0ID0gcmV2LnN1YnN0cmluZygwLCBpZHgpO1xuICB2YXIgcmlnaHQgPSByZXYuc3Vic3RyaW5nKGlkeCArIDEpO1xuICByZXR1cm4ge1xuICAgIHByZWZpeDogcGFyc2VJbnQobGVmdCwgMTApLFxuICAgIGlkOiByaWdodFxuICB9O1xufVxuXG5mdW5jdGlvbiBtYWtlUmV2VHJlZUZyb21SZXZpc2lvbnMocmV2aXNpb25zLCBvcHRzKSB7XG4gIHZhciBwb3MgPSByZXZpc2lvbnMuc3RhcnQgLSByZXZpc2lvbnMuaWRzLmxlbmd0aCArIDE7XG5cbiAgdmFyIHJldmlzaW9uSWRzID0gcmV2aXNpb25zLmlkcztcbiAgdmFyIGlkcyA9IFtyZXZpc2lvbklkc1swXSwgb3B0cywgW11dO1xuXG4gIGZvciAodmFyIGkgPSAxLCBsZW4gPSByZXZpc2lvbklkcy5sZW5ndGg7IGkgPCBsZW47IGkrKykge1xuICAgIGlkcyA9IFtyZXZpc2lvbklkc1tpXSwge3N0YXR1czogJ21pc3NpbmcnfSwgW2lkc11dO1xuICB9XG5cbiAgcmV0dXJuIFt7XG4gICAgcG9zOiBwb3MsXG4gICAgaWRzOiBpZHNcbiAgfV07XG59XG5cbi8vIFByZXByb2Nlc3MgZG9jdW1lbnRzLCBwYXJzZSB0aGVpciByZXZpc2lvbnMsIGFzc2lnbiBhbiBpZCBhbmQgYVxuLy8gcmV2aXNpb24gZm9yIG5ldyB3cml0ZXMgdGhhdCBhcmUgbWlzc2luZyB0aGVtLCBldGNcbmV4cG9ydHMucGFyc2VEb2MgPSBmdW5jdGlvbiAoZG9jLCBuZXdFZGl0cykge1xuXG4gIHZhciBuUmV2TnVtO1xuICB2YXIgbmV3UmV2SWQ7XG4gIHZhciByZXZJbmZvO1xuICB2YXIgb3B0cyA9IHtzdGF0dXM6ICdhdmFpbGFibGUnfTtcbiAgaWYgKGRvYy5fZGVsZXRlZCkge1xuICAgIG9wdHMuZGVsZXRlZCA9IHRydWU7XG4gIH1cblxuICBpZiAobmV3RWRpdHMpIHtcbiAgICBpZiAoIWRvYy5faWQpIHtcbiAgICAgIGRvYy5faWQgPSB1dWlkKCk7XG4gICAgfVxuICAgIG5ld1JldklkID0gdXVpZCgzMiwgMTYpLnRvTG93ZXJDYXNlKCk7XG4gICAgaWYgKGRvYy5fcmV2KSB7XG4gICAgICByZXZJbmZvID0gcGFyc2VSZXZpc2lvbkluZm8oZG9jLl9yZXYpO1xuICAgICAgaWYgKHJldkluZm8uZXJyb3IpIHtcbiAgICAgICAgcmV0dXJuIHJldkluZm87XG4gICAgICB9XG4gICAgICBkb2MuX3Jldl90cmVlID0gW3tcbiAgICAgICAgcG9zOiByZXZJbmZvLnByZWZpeCxcbiAgICAgICAgaWRzOiBbcmV2SW5mby5pZCwge3N0YXR1czogJ21pc3NpbmcnfSwgW1tuZXdSZXZJZCwgb3B0cywgW11dXV1cbiAgICAgIH1dO1xuICAgICAgblJldk51bSA9IHJldkluZm8ucHJlZml4ICsgMTtcbiAgICB9IGVsc2Uge1xuICAgICAgZG9jLl9yZXZfdHJlZSA9IFt7XG4gICAgICAgIHBvczogMSxcbiAgICAgICAgaWRzIDogW25ld1JldklkLCBvcHRzLCBbXV1cbiAgICAgIH1dO1xuICAgICAgblJldk51bSA9IDE7XG4gICAgfVxuICB9IGVsc2Uge1xuICAgIGlmIChkb2MuX3JldmlzaW9ucykge1xuICAgICAgZG9jLl9yZXZfdHJlZSA9IG1ha2VSZXZUcmVlRnJvbVJldmlzaW9ucyhkb2MuX3JldmlzaW9ucywgb3B0cyk7XG4gICAgICBuUmV2TnVtID0gZG9jLl9yZXZpc2lvbnMuc3RhcnQ7XG4gICAgICBuZXdSZXZJZCA9IGRvYy5fcmV2aXNpb25zLmlkc1swXTtcbiAgICB9XG4gICAgaWYgKCFkb2MuX3Jldl90cmVlKSB7XG4gICAgICByZXZJbmZvID0gcGFyc2VSZXZpc2lvbkluZm8oZG9jLl9yZXYpO1xuICAgICAgaWYgKHJldkluZm8uZXJyb3IpIHtcbiAgICAgICAgcmV0dXJuIHJldkluZm87XG4gICAgICB9XG4gICAgICBuUmV2TnVtID0gcmV2SW5mby5wcmVmaXg7XG4gICAgICBuZXdSZXZJZCA9IHJldkluZm8uaWQ7XG4gICAgICBkb2MuX3Jldl90cmVlID0gW3tcbiAgICAgICAgcG9zOiBuUmV2TnVtLFxuICAgICAgICBpZHM6IFtuZXdSZXZJZCwgb3B0cywgW11dXG4gICAgICB9XTtcbiAgICB9XG4gIH1cblxuICBleHBvcnRzLmludmFsaWRJZEVycm9yKGRvYy5faWQpO1xuXG4gIGRvYy5fcmV2ID0gblJldk51bSArICctJyArIG5ld1JldklkO1xuXG4gIHZhciByZXN1bHQgPSB7bWV0YWRhdGEgOiB7fSwgZGF0YSA6IHt9fTtcbiAgZm9yICh2YXIga2V5IGluIGRvYykge1xuICAgIGlmIChkb2MuaGFzT3duUHJvcGVydHkoa2V5KSkge1xuICAgICAgdmFyIHNwZWNpYWxLZXkgPSBrZXlbMF0gPT09ICdfJztcbiAgICAgIGlmIChzcGVjaWFsS2V5ICYmICFyZXNlcnZlZFdvcmRzW2tleV0pIHtcbiAgICAgICAgdmFyIGVycm9yID0gZXJyb3JzLmVycm9yKGVycm9ycy5ET0NfVkFMSURBVElPTiwga2V5KTtcbiAgICAgICAgZXJyb3IubWVzc2FnZSA9IGVycm9ycy5ET0NfVkFMSURBVElPTi5tZXNzYWdlICsgJzogJyArIGtleTtcbiAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICB9IGVsc2UgaWYgKHNwZWNpYWxLZXkgJiYgIWRhdGFXb3Jkc1trZXldKSB7XG4gICAgICAgIHJlc3VsdC5tZXRhZGF0YVtrZXkuc2xpY2UoMSldID0gZG9jW2tleV07XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXN1bHQuZGF0YVtrZXldID0gZG9jW2tleV07XG4gICAgICB9XG4gICAgfVxuICB9XG4gIHJldHVybiByZXN1bHQ7XG59OyIsIid1c2Ugc3RyaWN0JztcblxuLy9cbi8vIFBhcnNpbmcgaGV4IHN0cmluZ3MuIFllYWguXG4vL1xuLy8gU28gYmFzaWNhbGx5IHdlIG5lZWQgdGhpcyBiZWNhdXNlIG9mIGEgYnVnIGluIFdlYlNRTDpcbi8vIGh0dHBzOi8vY29kZS5nb29nbGUuY29tL3AvY2hyb21pdW0vaXNzdWVzL2RldGFpbD9pZD00MjI2OTBcbi8vIGh0dHBzOi8vYnVncy53ZWJraXQub3JnL3Nob3dfYnVnLmNnaT9pZD0xMzc2Mzdcbi8vXG4vLyBVVEYtOCBhbmQgVVRGLTE2IGFyZSBwcm92aWRlZCBhcyBzZXBhcmF0ZSBmdW5jdGlvbnNcbi8vIGZvciBtZWFnZXIgcGVyZm9ybWFuY2UgaW1wcm92ZW1lbnRzXG4vL1xuXG5mdW5jdGlvbiBkZWNvZGVVdGY4KHN0cikge1xuICByZXR1cm4gZGVjb2RlVVJJQ29tcG9uZW50KHdpbmRvdy5lc2NhcGUoc3RyKSk7XG59XG5cbmZ1bmN0aW9uIGhleFRvSW50KGNoYXJDb2RlKSB7XG4gIC8vICcwJy0nOScgaXMgNDgtNTdcbiAgLy8gJ0EnLSdGJyBpcyA2NS03MFxuICAvLyBTUUxpdGUgd2lsbCBvbmx5IGdpdmUgdXMgdXBwZXJjYXNlIGhleFxuICByZXR1cm4gY2hhckNvZGUgPCA2NSA/IChjaGFyQ29kZSAtIDQ4KSA6IChjaGFyQ29kZSAtIDU1KTtcbn1cblxuXG4vLyBFeGFtcGxlOlxuLy8gcHJhZ21hIGVuY29kaW5nPXV0Zjg7XG4vLyBzZWxlY3QgaGV4KCdBJyk7XG4vLyByZXR1cm5zICc0MSdcbmZ1bmN0aW9uIHBhcnNlSGV4VXRmOChzdHIsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIHJlc3VsdCA9ICcnO1xuICB3aGlsZSAoc3RhcnQgPCBlbmQpIHtcbiAgICByZXN1bHQgKz0gU3RyaW5nLmZyb21DaGFyQ29kZShcbiAgICAgIChoZXhUb0ludChzdHIuY2hhckNvZGVBdChzdGFydCsrKSkgPDwgNCkgfFxuICAgICAgICBoZXhUb0ludChzdHIuY2hhckNvZGVBdChzdGFydCsrKSkpO1xuICB9XG4gIHJldHVybiByZXN1bHQ7XG59XG5cbi8vIEV4YW1wbGU6XG4vLyBwcmFnbWEgZW5jb2Rpbmc9dXRmMTY7XG4vLyBzZWxlY3QgaGV4KCdBJyk7XG4vLyByZXR1cm5zICc0MTAwJ1xuLy8gbm90aWNlIHRoYXQgdGhlIDAwIGNvbWVzIGFmdGVyIHRoZSA0MSAoaS5lLiBpdCdzIHN3aXp6bGVkKVxuZnVuY3Rpb24gcGFyc2VIZXhVdGYxNihzdHIsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIHJlc3VsdCA9ICcnO1xuICB3aGlsZSAoc3RhcnQgPCBlbmQpIHtcbiAgICAvLyBVVEYtMTYsIHNvIHN3aXp6bGUgdGhlIGJ5dGVzXG4gICAgcmVzdWx0ICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoXG4gICAgICAoaGV4VG9JbnQoc3RyLmNoYXJDb2RlQXQoc3RhcnQgKyAyKSkgPDwgMTIpIHxcbiAgICAgICAgKGhleFRvSW50KHN0ci5jaGFyQ29kZUF0KHN0YXJ0ICsgMykpIDw8IDgpIHxcbiAgICAgICAgKGhleFRvSW50KHN0ci5jaGFyQ29kZUF0KHN0YXJ0KSkgPDwgNCkgfFxuICAgICAgICBoZXhUb0ludChzdHIuY2hhckNvZGVBdChzdGFydCArIDEpKSk7XG4gICAgc3RhcnQgKz0gNDtcbiAgfVxuICByZXR1cm4gcmVzdWx0O1xufVxuXG5mdW5jdGlvbiBwYXJzZUhleFN0cmluZyhzdHIsIGVuY29kaW5nKSB7XG4gIGlmIChlbmNvZGluZyA9PT0gJ1VURi04Jykge1xuICAgIHJldHVybiBkZWNvZGVVdGY4KHBhcnNlSGV4VXRmOChzdHIsIDAsIHN0ci5sZW5ndGgpKTtcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gcGFyc2VIZXhVdGYxNihzdHIsIDAsIHN0ci5sZW5ndGgpO1xuICB9XG59XG5cbm1vZHVsZS5leHBvcnRzID0gcGFyc2VIZXhTdHJpbmc7IiwiJ3VzZSBzdHJpY3QnO1xuXG4vLyBvcmlnaW5hbGx5IHBhcnNlVXJpIDEuMi4yLCBub3cgcGF0Y2hlZCBieSB1c1xuLy8gKGMpIFN0ZXZlbiBMZXZpdGhhbiA8c3RldmVubGV2aXRoYW4uY29tPlxuLy8gTUlUIExpY2Vuc2VcbnZhciBvcHRpb25zID0ge1xuICBzdHJpY3RNb2RlOiBmYWxzZSxcbiAga2V5OiBbXCJzb3VyY2VcIiwgXCJwcm90b2NvbFwiLCBcImF1dGhvcml0eVwiLCBcInVzZXJJbmZvXCIsIFwidXNlclwiLCBcInBhc3N3b3JkXCIsXG4gICAgXCJob3N0XCIsIFwicG9ydFwiLCBcInJlbGF0aXZlXCIsIFwicGF0aFwiLCBcImRpcmVjdG9yeVwiLCBcImZpbGVcIiwgXCJxdWVyeVwiLFxuICAgIFwiYW5jaG9yXCJdLFxuICBxOiAgIHtcbiAgICBuYW1lOiAgIFwicXVlcnlLZXlcIixcbiAgICBwYXJzZXI6IC8oPzpefCYpKFteJj1dKik9PyhbXiZdKikvZ1xuICB9LFxuICBwYXJzZXI6IHtcbiAgICAvKiBqc2hpbnQgbWF4bGVuOiBmYWxzZSAqL1xuICAgIHN0cmljdDogL14oPzooW146XFwvPyNdKyk6KT8oPzpcXC9cXC8oKD86KChbXjpAXSopKD86OihbXjpAXSopKT8pP0ApPyhbXjpcXC8/I10qKSg/OjooXFxkKikpPykpPygoKCg/OltePyNcXC9dKlxcLykqKShbXj8jXSopKSg/OlxcPyhbXiNdKikpPyg/OiMoLiopKT8pLyxcbiAgICBsb29zZTogIC9eKD86KD8hW146QF0rOlteOkBcXC9dKkApKFteOlxcLz8jLl0rKTopPyg/OlxcL1xcLyk/KCg/OigoW146QF0qKSg/OjooW146QF0qKSk/KT9AKT8oW146XFwvPyNdKikoPzo6KFxcZCopKT8pKCgoXFwvKD86W14/I10oPyFbXj8jXFwvXSpcXC5bXj8jXFwvLl0rKD86Wz8jXXwkKSkpKlxcLz8pPyhbXj8jXFwvXSopKSg/OlxcPyhbXiNdKikpPyg/OiMoLiopKT8pL1xuICB9XG59O1xuZnVuY3Rpb24gcGFyc2VVcmkoc3RyKSB7XG4gIHZhciBvID0gb3B0aW9ucztcbiAgdmFyIG0gPSBvLnBhcnNlcltvLnN0cmljdE1vZGUgPyBcInN0cmljdFwiIDogXCJsb29zZVwiXS5leGVjKHN0cik7XG4gIHZhciB1cmkgPSB7fTtcbiAgdmFyIGkgPSAxNDtcblxuICB3aGlsZSAoaS0tKSB7XG4gICAgdmFyIGtleSA9IG8ua2V5W2ldO1xuICAgIHZhciB2YWx1ZSA9IG1baV0gfHwgXCJcIjtcbiAgICB2YXIgZW5jb2RlZCA9IFsndXNlcicsICdwYXNzd29yZCddLmluZGV4T2Yoa2V5KSAhPT0gLTE7XG4gICAgdXJpW2tleV0gPSBlbmNvZGVkID8gZGVjb2RlVVJJQ29tcG9uZW50KHZhbHVlKSA6IHZhbHVlO1xuICB9XG5cbiAgdXJpW28ucS5uYW1lXSA9IHt9O1xuICB1cmlbby5rZXlbMTJdXS5yZXBsYWNlKG8ucS5wYXJzZXIsIGZ1bmN0aW9uICgkMCwgJDEsICQyKSB7XG4gICAgaWYgKCQxKSB7XG4gICAgICB1cmlbby5xLm5hbWVdWyQxXSA9ICQyO1xuICAgIH1cbiAgfSk7XG5cbiAgcmV0dXJuIHVyaTtcbn1cblxuXG5tb2R1bGUuZXhwb3J0cyA9IHBhcnNlVXJpOyIsIid1c2Ugc3RyaWN0JztcblxudmFyIGNyZWF0ZUJsb2IgPSByZXF1aXJlKCcuL2Jsb2IuanMnKTtcbnZhciB1dGlscyA9IHJlcXVpcmUoJy4uL3V0aWxzJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24ob3B0aW9ucywgY2FsbGJhY2spIHtcblxuICB2YXIgeGhyLCB0aW1lciwgaGFzVXBsb2FkO1xuXG4gIHZhciBhYm9ydFJlcSA9IGZ1bmN0aW9uICgpIHtcbiAgICB4aHIuYWJvcnQoKTtcbiAgfTtcblxuICBpZiAob3B0aW9ucy54aHIpIHtcbiAgICB4aHIgPSBuZXcgb3B0aW9ucy54aHIoKTtcbiAgfSBlbHNlIHtcbiAgICB4aHIgPSBuZXcgWE1MSHR0cFJlcXVlc3QoKTtcbiAgfVxuXG4gIC8vIGNhY2hlLWJ1c3Rlciwgc3BlY2lmaWNhbGx5IGRlc2lnbmVkIHRvIHdvcmsgYXJvdW5kIElFJ3MgYWdncmVzc2l2ZSBjYWNoaW5nXG4gIC8vIHNlZSBodHRwOi8vd3d3LmRhc2hiYXkuY29tLzIwMTEvMDUvaW50ZXJuZXQtZXhwbG9yZXItY2FjaGVzLWFqYXgvXG4gIGlmIChvcHRpb25zLm1ldGhvZCA9PT0gJ0dFVCcgJiYgIW9wdGlvbnMuY2FjaGUpIHtcbiAgICB2YXIgaGFzQXJncyA9IG9wdGlvbnMudXJsLmluZGV4T2YoJz8nKSAhPT0gLTE7XG4gICAgb3B0aW9ucy51cmwgKz0gKGhhc0FyZ3MgPyAnJicgOiAnPycpICsgJ19ub25jZT0nICsgRGF0ZS5ub3coKTtcbiAgfVxuXG4gIHhoci5vcGVuKG9wdGlvbnMubWV0aG9kLCBvcHRpb25zLnVybCk7XG4gIHhoci53aXRoQ3JlZGVudGlhbHMgPSB0cnVlO1xuXG4gIGlmIChvcHRpb25zLmpzb24pIHtcbiAgICBvcHRpb25zLmhlYWRlcnMuQWNjZXB0ID0gJ2FwcGxpY2F0aW9uL2pzb24nO1xuICAgIG9wdGlvbnMuaGVhZGVyc1snQ29udGVudC1UeXBlJ10gPSBvcHRpb25zLmhlYWRlcnNbJ0NvbnRlbnQtVHlwZSddIHx8XG4gICAgICAnYXBwbGljYXRpb24vanNvbic7XG4gICAgaWYgKG9wdGlvbnMuYm9keSAmJlxuICAgICAgICBvcHRpb25zLnByb2Nlc3NEYXRhICYmXG4gICAgICAgIHR5cGVvZiBvcHRpb25zLmJvZHkgIT09IFwic3RyaW5nXCIpIHtcbiAgICAgIG9wdGlvbnMuYm9keSA9IEpTT04uc3RyaW5naWZ5KG9wdGlvbnMuYm9keSk7XG4gICAgfVxuICB9XG5cbiAgaWYgKG9wdGlvbnMuYmluYXJ5KSB7XG4gICAgeGhyLnJlc3BvbnNlVHlwZSA9ICdhcnJheWJ1ZmZlcic7XG4gIH1cblxuICBpZiAoISgnYm9keScgaW4gb3B0aW9ucykpIHtcbiAgICBvcHRpb25zLmJvZHkgPSBudWxsO1xuICB9XG5cbiAgZm9yICh2YXIga2V5IGluIG9wdGlvbnMuaGVhZGVycykge1xuICAgIGlmIChvcHRpb25zLmhlYWRlcnMuaGFzT3duUHJvcGVydHkoa2V5KSkge1xuICAgICAgeGhyLnNldFJlcXVlc3RIZWFkZXIoa2V5LCBvcHRpb25zLmhlYWRlcnNba2V5XSk7XG4gICAgfVxuICB9XG5cbiAgaWYgKG9wdGlvbnMudGltZW91dCA+IDApIHtcbiAgICB0aW1lciA9IHNldFRpbWVvdXQoYWJvcnRSZXEsIG9wdGlvbnMudGltZW91dCk7XG4gICAgeGhyLm9ucHJvZ3Jlc3MgPSBmdW5jdGlvbiAoKSB7XG4gICAgICBjbGVhclRpbWVvdXQodGltZXIpO1xuICAgICAgdGltZXIgPSBzZXRUaW1lb3V0KGFib3J0UmVxLCBvcHRpb25zLnRpbWVvdXQpO1xuICAgIH07XG4gICAgaWYgKHR5cGVvZiBoYXNVcGxvYWQgPT09ICd1bmRlZmluZWQnKSB7XG4gICAgICAvLyBJRSB0aHJvd3MgYW4gZXJyb3IgaWYgeW91IHRyeSB0byBhY2Nlc3MgaXQgZGlyZWN0bHlcbiAgICAgIGhhc1VwbG9hZCA9IE9iamVjdC5rZXlzKHhocikuaW5kZXhPZigndXBsb2FkJykgIT09IC0xO1xuICAgIH1cbiAgICBpZiAoaGFzVXBsb2FkKSB7IC8vIGRvZXMgbm90IGV4aXN0IGluIGllOVxuICAgICAgeGhyLnVwbG9hZC5vbnByb2dyZXNzID0geGhyLm9ucHJvZ3Jlc3M7XG4gICAgfVxuICB9XG5cbiAgeGhyLm9ucmVhZHlzdGF0ZWNoYW5nZSA9IGZ1bmN0aW9uICgpIHtcbiAgICBpZiAoeGhyLnJlYWR5U3RhdGUgIT09IDQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgcmVzcG9uc2UgPSB7XG4gICAgICBzdGF0dXNDb2RlOiB4aHIuc3RhdHVzXG4gICAgfTtcblxuICAgIGlmICh4aHIuc3RhdHVzID49IDIwMCAmJiB4aHIuc3RhdHVzIDwgMzAwKSB7XG4gICAgICB2YXIgZGF0YTtcbiAgICAgIGlmIChvcHRpb25zLmJpbmFyeSkge1xuICAgICAgICBkYXRhID0gY3JlYXRlQmxvYihbeGhyLnJlc3BvbnNlIHx8ICcnXSwge1xuICAgICAgICAgIHR5cGU6IHhoci5nZXRSZXNwb25zZUhlYWRlcignQ29udGVudC1UeXBlJylcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBkYXRhID0geGhyLnJlc3BvbnNlVGV4dDtcbiAgICAgIH1cbiAgICAgIGNhbGxiYWNrKG51bGwsIHJlc3BvbnNlLCBkYXRhKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdmFyIGVyciA9IHt9O1xuICAgICAgdHJ5IHtcbiAgICAgICAgZXJyID0gSlNPTi5wYXJzZSh4aHIucmVzcG9uc2UpO1xuICAgICAgfSBjYXRjaChlKSB7fVxuICAgICAgY2FsbGJhY2soZXJyLCByZXNwb25zZSk7XG4gICAgfVxuICB9O1xuXG4gIGlmIChvcHRpb25zLmJvZHkgJiYgKG9wdGlvbnMuYm9keSBpbnN0YW5jZW9mIEJsb2IpKSB7XG4gICAgdXRpbHMucmVhZEFzQmluYXJ5U3RyaW5nKG9wdGlvbnMuYm9keSwgZnVuY3Rpb24gKGJpbmFyeSkge1xuICAgICAgeGhyLnNlbmQodXRpbHMuZml4QmluYXJ5KGJpbmFyeSkpO1xuICAgIH0pO1xuICB9IGVsc2Uge1xuICAgIHhoci5zZW5kKG9wdGlvbnMuYm9keSk7XG4gIH1cblxuICByZXR1cm4ge2Fib3J0OiBhYm9ydFJlcX07XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgdXBzZXJ0ID0gcmVxdWlyZSgncG91Y2hkYi11cHNlcnQnKS51cHNlcnQ7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKGRiLCBkb2MsIGRpZmZGdW4sIGNiKSB7XG4gIHJldHVybiB1cHNlcnQuY2FsbChkYiwgZG9jLCBkaWZmRnVuLCBjYik7XG59O1xuIiwiXCJ1c2Ugc3RyaWN0XCI7XG5cbi8vIEJFR0lOIE1hdGgudXVpZC5qc1xuXG4vKiFcbk1hdGgudXVpZC5qcyAodjEuNClcbmh0dHA6Ly93d3cuYnJvb2ZhLmNvbVxubWFpbHRvOnJvYmVydEBicm9vZmEuY29tXG5cbkNvcHlyaWdodCAoYykgMjAxMCBSb2JlcnQgS2llZmZlclxuRHVhbCBsaWNlbnNlZCB1bmRlciB0aGUgTUlUIGFuZCBHUEwgbGljZW5zZXMuXG4qL1xuXG4vKlxuICogR2VuZXJhdGUgYSByYW5kb20gdXVpZC5cbiAqXG4gKiBVU0FHRTogTWF0aC51dWlkKGxlbmd0aCwgcmFkaXgpXG4gKiAgIGxlbmd0aCAtIHRoZSBkZXNpcmVkIG51bWJlciBvZiBjaGFyYWN0ZXJzXG4gKiAgIHJhZGl4ICAtIHRoZSBudW1iZXIgb2YgYWxsb3dhYmxlIHZhbHVlcyBmb3IgZWFjaCBjaGFyYWN0ZXIuXG4gKlxuICogRVhBTVBMRVM6XG4gKiAgIC8vIE5vIGFyZ3VtZW50cyAgLSByZXR1cm5zIFJGQzQxMjIsIHZlcnNpb24gNCBJRFxuICogICA+Pj4gTWF0aC51dWlkKClcbiAqICAgXCI5MjMyOUQzOS02RjVDLTQ1MjAtQUJGQy1BQUI2NDU0NEUxNzJcIlxuICpcbiAqICAgLy8gT25lIGFyZ3VtZW50IC0gcmV0dXJucyBJRCBvZiB0aGUgc3BlY2lmaWVkIGxlbmd0aFxuICogICA+Pj4gTWF0aC51dWlkKDE1KSAgICAgLy8gMTUgY2hhcmFjdGVyIElEIChkZWZhdWx0IGJhc2U9NjIpXG4gKiAgIFwiVmN5ZHhnbHR4clZaU1RWXCJcbiAqXG4gKiAgIC8vIFR3byBhcmd1bWVudHMgLSByZXR1cm5zIElEIG9mIHRoZSBzcGVjaWZpZWQgbGVuZ3RoLCBhbmQgcmFkaXguIFxuICogICAvLyAoUmFkaXggbXVzdCBiZSA8PSA2MilcbiAqICAgPj4+IE1hdGgudXVpZCg4LCAyKSAgLy8gOCBjaGFyYWN0ZXIgSUQgKGJhc2U9MilcbiAqICAgXCIwMTAwMTAxMFwiXG4gKiAgID4+PiBNYXRoLnV1aWQoOCwgMTApIC8vIDggY2hhcmFjdGVyIElEIChiYXNlPTEwKVxuICogICBcIjQ3NDczMDQ2XCJcbiAqICAgPj4+IE1hdGgudXVpZCg4LCAxNikgLy8gOCBjaGFyYWN0ZXIgSUQgKGJhc2U9MTYpXG4gKiAgIFwiMDk4RjREMzVcIlxuICovXG52YXIgY2hhcnMgPSAoXG4gICcwMTIzNDU2Nzg5QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVonICtcbiAgJ2FiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6J1xuKS5zcGxpdCgnJyk7XG5mdW5jdGlvbiBnZXRWYWx1ZShyYWRpeCkge1xuICByZXR1cm4gMCB8IE1hdGgucmFuZG9tKCkgKiByYWRpeDtcbn1cbmZ1bmN0aW9uIHV1aWQobGVuLCByYWRpeCkge1xuICByYWRpeCA9IHJhZGl4IHx8IGNoYXJzLmxlbmd0aDtcbiAgdmFyIG91dCA9ICcnO1xuICB2YXIgaSA9IC0xO1xuXG4gIGlmIChsZW4pIHtcbiAgICAvLyBDb21wYWN0IGZvcm1cbiAgICB3aGlsZSAoKytpIDwgbGVuKSB7XG4gICAgICBvdXQgKz0gY2hhcnNbZ2V0VmFsdWUocmFkaXgpXTtcbiAgICB9XG4gICAgcmV0dXJuIG91dDtcbiAgfVxuICAgIC8vIHJmYzQxMjIsIHZlcnNpb24gNCBmb3JtXG4gICAgLy8gRmlsbCBpbiByYW5kb20gZGF0YS4gIEF0IGk9PTE5IHNldCB0aGUgaGlnaCBiaXRzIG9mIGNsb2NrIHNlcXVlbmNlIGFzXG4gICAgLy8gcGVyIHJmYzQxMjIsIHNlYy4gNC4xLjVcbiAgd2hpbGUgKCsraSA8IDM2KSB7XG4gICAgc3dpdGNoIChpKSB7XG4gICAgICBjYXNlIDg6XG4gICAgICBjYXNlIDEzOlxuICAgICAgY2FzZSAxODpcbiAgICAgIGNhc2UgMjM6XG4gICAgICAgIG91dCArPSAnLSc7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAxOTpcbiAgICAgICAgb3V0ICs9IGNoYXJzWyhnZXRWYWx1ZSgxNikgJiAweDMpIHwgMHg4XTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICBvdXQgKz0gY2hhcnNbZ2V0VmFsdWUoMTYpXTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gb3V0O1xufVxuXG5cblxubW9kdWxlLmV4cG9ydHMgPSB1dWlkO1xuXG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gZXZhbEZpbHRlcjtcbmZ1bmN0aW9uIGV2YWxGaWx0ZXIoaW5wdXQpIHtcbiAgLypqc2hpbnQgZXZpbDogdHJ1ZSAqL1xuICByZXR1cm4gZXZhbChbXG4gICAgJyhmdW5jdGlvbiAoKSB7IHJldHVybiAnLFxuICAgIGlucHV0LFxuICAgICcgfSkoKSdcbiAgXS5qb2luKCcnKSk7XG59IiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGV2YWxWaWV3O1xuZnVuY3Rpb24gZXZhbFZpZXcoaW5wdXQpIHtcbiAgLypqc2hpbnQgZXZpbDogdHJ1ZSAqL1xuICByZXR1cm4gZXZhbChbXG4gICAgJyhmdW5jdGlvbiAoKSB7JyxcbiAgICAnICByZXR1cm4gZnVuY3Rpb24gKGRvYykgeycsXG4gICAgJyAgICB2YXIgZW1pdHRlZCA9IGZhbHNlOycsXG4gICAgJyAgICB2YXIgZW1pdCA9IGZ1bmN0aW9uIChhLCBiKSB7JyxcbiAgICAnICAgICAgZW1pdHRlZCA9IHRydWU7JyxcbiAgICAnICAgIH07JyxcbiAgICAnICAgIHZhciB2aWV3ID0gJyArIGlucHV0ICsgJzsnLFxuICAgICcgICAgdmlldyhkb2MpOycsXG4gICAgJyAgICBpZiAoZW1pdHRlZCkgeycsXG4gICAgJyAgICAgIHJldHVybiB0cnVlOycsXG4gICAgJyAgICB9JyxcbiAgICAnICB9JyxcbiAgICAnfSkoKSdcbiAgXS5qb2luKCdcXG4nKSk7XG59IiwiXCJ1c2Ugc3RyaWN0XCI7XG5cbnZhciBQb3VjaERCID0gcmVxdWlyZSgnLi9zZXR1cCcpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFBvdWNoREI7XG5cblBvdWNoREIuYWpheCA9IHJlcXVpcmUoJy4vZGVwcy9hamF4Jyk7XG5Qb3VjaERCLnV0aWxzID0gcmVxdWlyZSgnLi91dGlscycpO1xuUG91Y2hEQi5FcnJvcnMgPSByZXF1aXJlKCcuL2RlcHMvZXJyb3JzJyk7XG5Qb3VjaERCLnJlcGxpY2F0ZSA9IHJlcXVpcmUoJy4vcmVwbGljYXRlJykucmVwbGljYXRlO1xuUG91Y2hEQi5zeW5jID0gcmVxdWlyZSgnLi9zeW5jJyk7XG5Qb3VjaERCLnZlcnNpb24gPSByZXF1aXJlKCcuL3ZlcnNpb24nKTtcbnZhciBodHRwQWRhcHRlciA9IHJlcXVpcmUoJy4vYWRhcHRlcnMvaHR0cC9odHRwJyk7XG5Qb3VjaERCLmFkYXB0ZXIoJ2h0dHAnLCBodHRwQWRhcHRlcik7XG5Qb3VjaERCLmFkYXB0ZXIoJ2h0dHBzJywgaHR0cEFkYXB0ZXIpO1xuXG5Qb3VjaERCLmFkYXB0ZXIoJ2lkYicsIHJlcXVpcmUoJy4vYWRhcHRlcnMvaWRiL2lkYicpKTtcblBvdWNoREIuYWRhcHRlcignd2Vic3FsJywgcmVxdWlyZSgnLi9hZGFwdGVycy93ZWJzcWwvd2Vic3FsJykpO1xuUG91Y2hEQi5wbHVnaW4ocmVxdWlyZSgncG91Y2hkYi1tYXByZWR1Y2UnKSk7XG5cbmlmICghcHJvY2Vzcy5icm93c2VyKSB7XG4gIHZhciBsZGJBZGFwdGVyID0gcmVxdWlyZSgnLi9hZGFwdGVycy9sZXZlbGRiL2xldmVsZGInKTtcbiAgUG91Y2hEQi5hZGFwdGVyKCdsZGInLCBsZGJBZGFwdGVyKTtcbiAgUG91Y2hEQi5hZGFwdGVyKCdsZXZlbGRiJywgbGRiQWRhcHRlcik7XG59XG4iLCIndXNlIHN0cmljdCc7XG52YXIgZXh0ZW5kID0gcmVxdWlyZSgncG91Y2hkYi1leHRlbmQnKTtcblxuXG4vLyBmb3IgYSBiZXR0ZXIgb3ZlcnZpZXcgb2Ygd2hhdCB0aGlzIGlzIGRvaW5nLCByZWFkOlxuLy8gaHR0cHM6Ly9naXRodWIuY29tL2FwYWNoZS9jb3VjaGRiL2Jsb2IvbWFzdGVyL3NyYy9jb3VjaGRiL2NvdWNoX2tleV90cmVlLmVybFxuLy9cbi8vIEJ1dCBmb3IgYSBxdWljayBpbnRybywgQ291Y2hEQiB1c2VzIGEgcmV2aXNpb24gdHJlZSB0byBzdG9yZSBhIGRvY3VtZW50c1xuLy8gaGlzdG9yeSwgQSAtPiBCIC0+IEMsIHdoZW4gYSBkb2N1bWVudCBoYXMgY29uZmxpY3RzLCB0aGF0IGlzIGEgYnJhbmNoIGluIHRoZVxuLy8gdHJlZSwgQSAtPiAoQjEgfCBCMiAtPiBDKSwgV2Ugc3RvcmUgdGhlc2UgYXMgYSBuZXN0ZWQgYXJyYXkgaW4gdGhlIGZvcm1hdFxuLy9cbi8vIEtleVRyZWUgPSBbUGF0aCAuLi4gXVxuLy8gUGF0aCA9IHtwb3M6IHBvc2l0aW9uX2Zyb21fcm9vdCwgaWRzOiBUcmVlfVxuLy8gVHJlZSA9IFtLZXksIE9wdHMsIFtUcmVlLCAuLi5dXSwgaW4gcGFydGljdWxhciBzaW5nbGUgbm9kZTogW0tleSwgW11dXG5cbi8vIGNsYXNzaWMgYmluYXJ5IHNlYXJjaFxuZnVuY3Rpb24gYmluYXJ5U2VhcmNoKGFyciwgaXRlbSwgY29tcGFyYXRvcikge1xuICB2YXIgbG93ID0gMDtcbiAgdmFyIGhpZ2ggPSBhcnIubGVuZ3RoO1xuICB2YXIgbWlkO1xuICB3aGlsZSAobG93IDwgaGlnaCkge1xuICAgIG1pZCA9IChsb3cgKyBoaWdoKSA+Pj4gMTtcbiAgICBpZiAoY29tcGFyYXRvcihhcnJbbWlkXSwgaXRlbSkgPCAwKSB7XG4gICAgICBsb3cgPSBtaWQgKyAxO1xuICAgIH0gZWxzZSB7XG4gICAgICBoaWdoID0gbWlkO1xuICAgIH1cbiAgfVxuICByZXR1cm4gbG93O1xufVxuXG4vLyBhc3N1bWluZyB0aGUgYXJyIGlzIHNvcnRlZCwgaW5zZXJ0IHRoZSBpdGVtIGluIHRoZSBwcm9wZXIgcGxhY2VcbmZ1bmN0aW9uIGluc2VydFNvcnRlZChhcnIsIGl0ZW0sIGNvbXBhcmF0b3IpIHtcbiAgdmFyIGlkeCA9IGJpbmFyeVNlYXJjaChhcnIsIGl0ZW0sIGNvbXBhcmF0b3IpO1xuICBhcnIuc3BsaWNlKGlkeCwgMCwgaXRlbSk7XG59XG5cbi8vIFR1cm4gYSBwYXRoIGFzIGEgZmxhdCBhcnJheSBpbnRvIGEgdHJlZSB3aXRoIGEgc2luZ2xlIGJyYW5jaFxuZnVuY3Rpb24gcGF0aFRvVHJlZShwYXRoKSB7XG4gIHZhciBkb2MgPSBwYXRoLnNoaWZ0KCk7XG4gIHZhciByb290ID0gW2RvYy5pZCwgZG9jLm9wdHMsIFtdXTtcbiAgdmFyIGxlYWYgPSByb290O1xuICB2YXIgbmxlYWY7XG5cbiAgd2hpbGUgKHBhdGgubGVuZ3RoKSB7XG4gICAgZG9jID0gcGF0aC5zaGlmdCgpO1xuICAgIG5sZWFmID0gW2RvYy5pZCwgZG9jLm9wdHMsIFtdXTtcbiAgICBsZWFmWzJdLnB1c2gobmxlYWYpO1xuICAgIGxlYWYgPSBubGVhZjtcbiAgfVxuICByZXR1cm4gcm9vdDtcbn1cblxuLy8gY29tcGFyZSB0aGUgSURzIG9mIHR3byB0cmVlc1xuZnVuY3Rpb24gY29tcGFyZVRyZWUoYSwgYikge1xuICByZXR1cm4gYVswXSA8IGJbMF0gPyAtMSA6IDE7XG59XG5cbi8vIE1lcmdlIHR3byB0cmVlcyB0b2dldGhlclxuLy8gVGhlIHJvb3RzIG9mIHRyZWUxIGFuZCB0cmVlMiBtdXN0IGJlIHRoZSBzYW1lIHJldmlzaW9uXG5mdW5jdGlvbiBtZXJnZVRyZWUoaW5fdHJlZTEsIGluX3RyZWUyKSB7XG4gIHZhciBxdWV1ZSA9IFt7dHJlZTE6IGluX3RyZWUxLCB0cmVlMjogaW5fdHJlZTJ9XTtcbiAgdmFyIGNvbmZsaWN0cyA9IGZhbHNlO1xuICB3aGlsZSAocXVldWUubGVuZ3RoID4gMCkge1xuICAgIHZhciBpdGVtID0gcXVldWUucG9wKCk7XG4gICAgdmFyIHRyZWUxID0gaXRlbS50cmVlMTtcbiAgICB2YXIgdHJlZTIgPSBpdGVtLnRyZWUyO1xuXG4gICAgaWYgKHRyZWUxWzFdLnN0YXR1cyB8fCB0cmVlMlsxXS5zdGF0dXMpIHtcbiAgICAgIHRyZWUxWzFdLnN0YXR1cyA9XG4gICAgICAgICh0cmVlMVsxXS5zdGF0dXMgPT09ICAnYXZhaWxhYmxlJyB8fFxuICAgICAgICAgdHJlZTJbMV0uc3RhdHVzID09PSAnYXZhaWxhYmxlJykgPyAnYXZhaWxhYmxlJyA6ICdtaXNzaW5nJztcbiAgICB9XG5cbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHRyZWUyWzJdLmxlbmd0aDsgaSsrKSB7XG4gICAgICBpZiAoIXRyZWUxWzJdWzBdKSB7XG4gICAgICAgIGNvbmZsaWN0cyA9ICduZXdfbGVhZic7XG4gICAgICAgIHRyZWUxWzJdWzBdID0gdHJlZTJbMl1baV07XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICB2YXIgbWVyZ2VkID0gZmFsc2U7XG4gICAgICBmb3IgKHZhciBqID0gMDsgaiA8IHRyZWUxWzJdLmxlbmd0aDsgaisrKSB7XG4gICAgICAgIGlmICh0cmVlMVsyXVtqXVswXSA9PT0gdHJlZTJbMl1baV1bMF0pIHtcbiAgICAgICAgICBxdWV1ZS5wdXNoKHt0cmVlMTogdHJlZTFbMl1bal0sIHRyZWUyOiB0cmVlMlsyXVtpXX0pO1xuICAgICAgICAgIG1lcmdlZCA9IHRydWU7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmICghbWVyZ2VkKSB7XG4gICAgICAgIGNvbmZsaWN0cyA9ICduZXdfYnJhbmNoJztcbiAgICAgICAgaW5zZXJ0U29ydGVkKHRyZWUxWzJdLCB0cmVlMlsyXVtpXSwgY29tcGFyZVRyZWUpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuICByZXR1cm4ge2NvbmZsaWN0czogY29uZmxpY3RzLCB0cmVlOiBpbl90cmVlMX07XG59XG5cbmZ1bmN0aW9uIGRvTWVyZ2UodHJlZSwgcGF0aCwgZG9udEV4cGFuZCkge1xuICB2YXIgcmVzdHJlZSA9IFtdO1xuICB2YXIgY29uZmxpY3RzID0gZmFsc2U7XG4gIHZhciBtZXJnZWQgPSBmYWxzZTtcbiAgdmFyIHJlcztcblxuICBpZiAoIXRyZWUubGVuZ3RoKSB7XG4gICAgcmV0dXJuIHt0cmVlOiBbcGF0aF0sIGNvbmZsaWN0czogJ25ld19sZWFmJ307XG4gIH1cblxuICB0cmVlLmZvckVhY2goZnVuY3Rpb24gKGJyYW5jaCkge1xuICAgIGlmIChicmFuY2gucG9zID09PSBwYXRoLnBvcyAmJiBicmFuY2guaWRzWzBdID09PSBwYXRoLmlkc1swXSkge1xuICAgICAgLy8gUGF0aHMgc3RhcnQgYXQgdGhlIHNhbWUgcG9zaXRpb24gYW5kIGhhdmUgdGhlIHNhbWUgcm9vdCwgc28gdGhleSBuZWVkXG4gICAgICAvLyBtZXJnZWRcbiAgICAgIHJlcyA9IG1lcmdlVHJlZShicmFuY2guaWRzLCBwYXRoLmlkcyk7XG4gICAgICByZXN0cmVlLnB1c2goe3BvczogYnJhbmNoLnBvcywgaWRzOiByZXMudHJlZX0pO1xuICAgICAgY29uZmxpY3RzID0gY29uZmxpY3RzIHx8IHJlcy5jb25mbGljdHM7XG4gICAgICBtZXJnZWQgPSB0cnVlO1xuICAgIH0gZWxzZSBpZiAoZG9udEV4cGFuZCAhPT0gdHJ1ZSkge1xuICAgICAgLy8gVGhlIHBhdGhzIHN0YXJ0IGF0IGEgZGlmZmVyZW50IHBvc2l0aW9uLCB0YWtlIHRoZSBlYXJsaWVzdCBwYXRoIGFuZFxuICAgICAgLy8gdHJhdmVyc2UgdXAgdW50aWwgaXQgYXMgYXQgdGhlIHNhbWUgcG9pbnQgZnJvbSByb290IGFzIHRoZSBwYXRoIHdlXG4gICAgICAvLyB3YW50IHRvIG1lcmdlLiAgSWYgdGhlIGtleXMgbWF0Y2ggd2UgcmV0dXJuIHRoZSBsb25nZXIgcGF0aCB3aXRoIHRoZVxuICAgICAgLy8gb3RoZXIgbWVyZ2VkIEFmdGVyIHN0ZW1taW5nIHdlIGRvbnQgd2FudCB0byBleHBhbmQgdGhlIHRyZWVzXG5cbiAgICAgIHZhciB0MSA9IGJyYW5jaC5wb3MgPCBwYXRoLnBvcyA/IGJyYW5jaCA6IHBhdGg7XG4gICAgICB2YXIgdDIgPSBicmFuY2gucG9zIDwgcGF0aC5wb3MgPyBwYXRoIDogYnJhbmNoO1xuICAgICAgdmFyIGRpZmYgPSB0Mi5wb3MgLSB0MS5wb3M7XG5cbiAgICAgIHZhciBjYW5kaWRhdGVQYXJlbnRzID0gW107XG5cbiAgICAgIHZhciB0cmVlcyA9IFtdO1xuICAgICAgdHJlZXMucHVzaCh7aWRzOiB0MS5pZHMsIGRpZmY6IGRpZmYsIHBhcmVudDogbnVsbCwgcGFyZW50SWR4OiBudWxsfSk7XG4gICAgICB3aGlsZSAodHJlZXMubGVuZ3RoID4gMCkge1xuICAgICAgICB2YXIgaXRlbSA9IHRyZWVzLnBvcCgpO1xuICAgICAgICBpZiAoaXRlbS5kaWZmID09PSAwKSB7XG4gICAgICAgICAgaWYgKGl0ZW0uaWRzWzBdID09PSB0Mi5pZHNbMF0pIHtcbiAgICAgICAgICAgIGNhbmRpZGF0ZVBhcmVudHMucHVzaChpdGVtKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFpdGVtLmlkcykge1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIC8qanNoaW50IGxvb3BmdW5jOnRydWUgKi9cbiAgICAgICAgaXRlbS5pZHNbMl0uZm9yRWFjaChmdW5jdGlvbiAoZWwsIGlkeCkge1xuICAgICAgICAgIHRyZWVzLnB1c2goXG4gICAgICAgICAgICB7aWRzOiBlbCwgZGlmZjogaXRlbS5kaWZmIC0gMSwgcGFyZW50OiBpdGVtLmlkcywgcGFyZW50SWR4OiBpZHh9KTtcbiAgICAgICAgfSk7XG4gICAgICB9XG5cbiAgICAgIHZhciBlbCA9IGNhbmRpZGF0ZVBhcmVudHNbMF07XG5cbiAgICAgIGlmICghZWwpIHtcbiAgICAgICAgcmVzdHJlZS5wdXNoKGJyYW5jaCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXMgPSBtZXJnZVRyZWUoZWwuaWRzLCB0Mi5pZHMpO1xuICAgICAgICBlbC5wYXJlbnRbMl1bZWwucGFyZW50SWR4XSA9IHJlcy50cmVlO1xuICAgICAgICByZXN0cmVlLnB1c2goe3BvczogdDEucG9zLCBpZHM6IHQxLmlkc30pO1xuICAgICAgICBjb25mbGljdHMgPSBjb25mbGljdHMgfHwgcmVzLmNvbmZsaWN0cztcbiAgICAgICAgbWVyZ2VkID0gdHJ1ZTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgcmVzdHJlZS5wdXNoKGJyYW5jaCk7XG4gICAgfVxuICB9KTtcblxuICAvLyBXZSBkaWRudCBmaW5kXG4gIGlmICghbWVyZ2VkKSB7XG4gICAgcmVzdHJlZS5wdXNoKHBhdGgpO1xuICB9XG5cbiAgcmVzdHJlZS5zb3J0KGZ1bmN0aW9uIChhLCBiKSB7XG4gICAgcmV0dXJuIGEucG9zIC0gYi5wb3M7XG4gIH0pO1xuXG4gIHJldHVybiB7XG4gICAgdHJlZTogcmVzdHJlZSxcbiAgICBjb25mbGljdHM6IGNvbmZsaWN0cyB8fCAnaW50ZXJuYWxfbm9kZSdcbiAgfTtcbn1cblxuLy8gVG8gZW5zdXJlIHdlIGRvbnQgZ3JvdyB0aGUgcmV2aXNpb24gdHJlZSBpbmZpbml0ZWx5LCB3ZSBzdGVtIG9sZCByZXZpc2lvbnNcbmZ1bmN0aW9uIHN0ZW0odHJlZSwgZGVwdGgpIHtcbiAgLy8gRmlyc3Qgd2UgYnJlYWsgb3V0IHRoZSB0cmVlIGludG8gYSBjb21wbGV0ZSBsaXN0IG9mIHJvb3QgdG8gbGVhZiBwYXRocyxcbiAgLy8gd2UgY3V0IG9mZiB0aGUgc3RhcnQgb2YgdGhlIHBhdGggYW5kIGdlbmVyYXRlIGEgbmV3IHNldCBvZiBmbGF0IHRyZWVzXG4gIHZhciBzdGVtbWVkUGF0aHMgPSBQb3VjaE1lcmdlLnJvb3RUb0xlYWYodHJlZSkubWFwKGZ1bmN0aW9uIChwYXRoKSB7XG4gICAgdmFyIHN0ZW1tZWQgPSBwYXRoLmlkcy5zbGljZSgtZGVwdGgpO1xuICAgIHJldHVybiB7XG4gICAgICBwb3M6IHBhdGgucG9zICsgKHBhdGguaWRzLmxlbmd0aCAtIHN0ZW1tZWQubGVuZ3RoKSxcbiAgICAgIGlkczogcGF0aFRvVHJlZShzdGVtbWVkKVxuICAgIH07XG4gIH0pO1xuICAvLyBUaGVuIHdlIHJlbWVyZ2UgYWxsIHRob3NlIGZsYXQgdHJlZXMgdG9nZXRoZXIsIGVuc3VyaW5nIHRoYXQgd2UgZG9udFxuICAvLyBjb25uZWN0IHRyZWVzIHRoYXQgd291bGQgZ28gYmV5b25kIHRoZSBkZXB0aCBsaW1pdFxuICByZXR1cm4gc3RlbW1lZFBhdGhzLnJlZHVjZShmdW5jdGlvbiAocHJldiwgY3VycmVudCkge1xuICAgIHJldHVybiBkb01lcmdlKHByZXYsIGN1cnJlbnQsIHRydWUpLnRyZWU7XG4gIH0sIFtzdGVtbWVkUGF0aHMuc2hpZnQoKV0pO1xufVxuXG52YXIgUG91Y2hNZXJnZSA9IHt9O1xuXG5Qb3VjaE1lcmdlLm1lcmdlID0gZnVuY3Rpb24gKHRyZWUsIHBhdGgsIGRlcHRoKSB7XG4gIC8vIFVnaCwgbmljZXIgd2F5IHRvIG5vdCBtb2RpZnkgYXJndW1lbnRzIGluIHBsYWNlP1xuICB0cmVlID0gZXh0ZW5kKHRydWUsIFtdLCB0cmVlKTtcbiAgcGF0aCA9IGV4dGVuZCh0cnVlLCB7fSwgcGF0aCk7XG4gIHZhciBuZXdUcmVlID0gZG9NZXJnZSh0cmVlLCBwYXRoKTtcbiAgcmV0dXJuIHtcbiAgICB0cmVlOiBzdGVtKG5ld1RyZWUudHJlZSwgZGVwdGgpLFxuICAgIGNvbmZsaWN0czogbmV3VHJlZS5jb25mbGljdHNcbiAgfTtcbn07XG5cbi8vIFdlIGZldGNoIGFsbCBsZWFmcyBvZiB0aGUgcmV2aXNpb24gdHJlZSwgYW5kIHNvcnQgdGhlbSBiYXNlZCBvbiB0cmVlIGxlbmd0aFxuLy8gYW5kIHdoZXRoZXIgdGhleSB3ZXJlIGRlbGV0ZWQsIHVuZGVsZXRlZCBkb2N1bWVudHMgd2l0aCB0aGUgbG9uZ2VzdCByZXZpc2lvblxuLy8gdHJlZSAobW9zdCBlZGl0cykgd2luXG4vLyBUaGUgZmluYWwgc29ydCBhbGdvcml0aG0gaXMgc2xpZ2h0bHkgZG9jdW1lbnRlZCBpbiBhIHNpZGViYXIgaGVyZTpcbi8vIGh0dHA6Ly9ndWlkZS5jb3VjaGRiLm9yZy9kcmFmdC9jb25mbGljdHMuaHRtbFxuUG91Y2hNZXJnZS53aW5uaW5nUmV2ID0gZnVuY3Rpb24gKG1ldGFkYXRhKSB7XG4gIHZhciBsZWFmcyA9IFtdO1xuICBQb3VjaE1lcmdlLnRyYXZlcnNlUmV2VHJlZShtZXRhZGF0YS5yZXZfdHJlZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGZ1bmN0aW9uIChpc0xlYWYsIHBvcywgaWQsIHNvbWV0aGluZywgb3B0cykge1xuICAgIGlmIChpc0xlYWYpIHtcbiAgICAgIGxlYWZzLnB1c2goe3BvczogcG9zLCBpZDogaWQsIGRlbGV0ZWQ6ICEhb3B0cy5kZWxldGVkfSk7XG4gICAgfVxuICB9KTtcbiAgbGVhZnMuc29ydChmdW5jdGlvbiAoYSwgYikge1xuICAgIGlmIChhLmRlbGV0ZWQgIT09IGIuZGVsZXRlZCkge1xuICAgICAgcmV0dXJuIGEuZGVsZXRlZCA+IGIuZGVsZXRlZCA/IDEgOiAtMTtcbiAgICB9XG4gICAgaWYgKGEucG9zICE9PSBiLnBvcykge1xuICAgICAgcmV0dXJuIGIucG9zIC0gYS5wb3M7XG4gICAgfVxuICAgIHJldHVybiBhLmlkIDwgYi5pZCA/IDEgOiAtMTtcbiAgfSk7XG5cbiAgcmV0dXJuIGxlYWZzWzBdLnBvcyArICctJyArIGxlYWZzWzBdLmlkO1xufTtcblxuLy8gUHJldHR5IG11Y2ggYWxsIGJlbG93IGNhbiBiZSBjb21iaW5lZCBpbnRvIGEgaGlnaGVyIG9yZGVyIGZ1bmN0aW9uIHRvXG4vLyB0cmF2ZXJzZSByZXZpc2lvbnNcbi8vIFRoZSByZXR1cm4gdmFsdWUgZnJvbSB0aGUgY2FsbGJhY2sgd2lsbCBiZSBwYXNzZWQgYXMgY29udGV4dCB0byBhbGxcbi8vIGNoaWxkcmVuIG9mIHRoYXQgbm9kZVxuUG91Y2hNZXJnZS50cmF2ZXJzZVJldlRyZWUgPSBmdW5jdGlvbiAocmV2cywgY2FsbGJhY2spIHtcbiAgdmFyIHRvVmlzaXQgPSByZXZzLnNsaWNlKCk7XG5cbiAgdmFyIG5vZGU7XG4gIHdoaWxlICgobm9kZSA9IHRvVmlzaXQucG9wKCkpKSB7XG4gICAgdmFyIHBvcyA9IG5vZGUucG9zO1xuICAgIHZhciB0cmVlID0gbm9kZS5pZHM7XG4gICAgdmFyIGJyYW5jaGVzID0gdHJlZVsyXTtcbiAgICB2YXIgbmV3Q3R4ID1cbiAgICAgIGNhbGxiYWNrKGJyYW5jaGVzLmxlbmd0aCA9PT0gMCwgcG9zLCB0cmVlWzBdLCBub2RlLmN0eCwgdHJlZVsxXSk7XG4gICAgZm9yICh2YXIgaSA9IDAsIGxlbiA9IGJyYW5jaGVzLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgICB0b1Zpc2l0LnB1c2goe3BvczogcG9zICsgMSwgaWRzOiBicmFuY2hlc1tpXSwgY3R4OiBuZXdDdHh9KTtcbiAgICB9XG4gIH1cbn07XG5cblBvdWNoTWVyZ2UuY29sbGVjdExlYXZlcyA9IGZ1bmN0aW9uIChyZXZzKSB7XG4gIHZhciBsZWF2ZXMgPSBbXTtcbiAgUG91Y2hNZXJnZS50cmF2ZXJzZVJldlRyZWUocmV2cywgZnVuY3Rpb24gKGlzTGVhZiwgcG9zLCBpZCwgYWNjLCBvcHRzKSB7XG4gICAgaWYgKGlzTGVhZikge1xuICAgICAgbGVhdmVzLnB1c2goe3JldjogcG9zICsgXCItXCIgKyBpZCwgcG9zOiBwb3MsIG9wdHM6IG9wdHN9KTtcbiAgICB9XG4gIH0pO1xuICBsZWF2ZXMuc29ydChmdW5jdGlvbiAoYSwgYikge1xuICAgIHJldHVybiBiLnBvcyAtIGEucG9zO1xuICB9KTtcbiAgbGVhdmVzLmZvckVhY2goZnVuY3Rpb24gKGxlYWYpIHsgZGVsZXRlIGxlYWYucG9zOyB9KTtcbiAgcmV0dXJuIGxlYXZlcztcbn07XG5cbi8vIHJldHVybnMgcmV2cyBvZiBhbGwgY29uZmxpY3RzIHRoYXQgaXMgbGVhdmVzIHN1Y2ggdGhhdFxuLy8gMS4gYXJlIG5vdCBkZWxldGVkIGFuZFxuLy8gMi4gYXJlIGRpZmZlcmVudCB0aGFuIHdpbm5pbmcgcmV2aXNpb25cblBvdWNoTWVyZ2UuY29sbGVjdENvbmZsaWN0cyA9IGZ1bmN0aW9uIChtZXRhZGF0YSkge1xuICB2YXIgd2luID0gUG91Y2hNZXJnZS53aW5uaW5nUmV2KG1ldGFkYXRhKTtcbiAgdmFyIGxlYXZlcyA9IFBvdWNoTWVyZ2UuY29sbGVjdExlYXZlcyhtZXRhZGF0YS5yZXZfdHJlZSk7XG4gIHZhciBjb25mbGljdHMgPSBbXTtcbiAgbGVhdmVzLmZvckVhY2goZnVuY3Rpb24gKGxlYWYpIHtcbiAgICBpZiAobGVhZi5yZXYgIT09IHdpbiAmJiAhbGVhZi5vcHRzLmRlbGV0ZWQpIHtcbiAgICAgIGNvbmZsaWN0cy5wdXNoKGxlYWYucmV2KTtcbiAgICB9XG4gIH0pO1xuICByZXR1cm4gY29uZmxpY3RzO1xufTtcblxuUG91Y2hNZXJnZS5yb290VG9MZWFmID0gZnVuY3Rpb24gKHRyZWUpIHtcbiAgdmFyIHBhdGhzID0gW107XG4gIFBvdWNoTWVyZ2UudHJhdmVyc2VSZXZUcmVlKHRyZWUsIGZ1bmN0aW9uIChpc0xlYWYsIHBvcywgaWQsIGhpc3RvcnksIG9wdHMpIHtcbiAgICBoaXN0b3J5ID0gaGlzdG9yeSA/IGhpc3Rvcnkuc2xpY2UoMCkgOiBbXTtcbiAgICBoaXN0b3J5LnB1c2goe2lkOiBpZCwgb3B0czogb3B0c30pO1xuICAgIGlmIChpc0xlYWYpIHtcbiAgICAgIHZhciByb290UG9zID0gcG9zICsgMSAtIGhpc3RvcnkubGVuZ3RoO1xuICAgICAgcGF0aHMudW5zaGlmdCh7cG9zOiByb290UG9zLCBpZHM6IGhpc3Rvcnl9KTtcbiAgICB9XG4gICAgcmV0dXJuIGhpc3Rvcnk7XG4gIH0pO1xuICByZXR1cm4gcGF0aHM7XG59O1xuXG5cbm1vZHVsZS5leHBvcnRzID0gUG91Y2hNZXJnZTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIHV0aWxzID0gcmVxdWlyZSgnLi91dGlscycpO1xudmFyIEVFID0gcmVxdWlyZSgnZXZlbnRzJykuRXZlbnRFbWl0dGVyO1xudmFyIENoZWNrcG9pbnRlciA9IHJlcXVpcmUoJy4vY2hlY2twb2ludGVyJyk7XG5cbnZhciBNQVhfU0lNVUxUQU5FT1VTX1JFVlMgPSA1MDtcbnZhciBSRVRSWV9ERUZBVUxUID0gZmFsc2U7XG5cbmZ1bmN0aW9uIHJhbmRvbU51bWJlcihtaW4sIG1heCkge1xuICBtaW4gPSBwYXJzZUludChtaW4sIDEwKTtcbiAgbWF4ID0gcGFyc2VJbnQobWF4LCAxMCk7XG4gIGlmIChtaW4gIT09IG1pbikge1xuICAgIG1pbiA9IDA7XG4gIH1cbiAgaWYgKG1heCAhPT0gbWF4IHx8IG1heCA8PSBtaW4pIHtcbiAgICBtYXggPSAobWluIHx8IDEpIDw8IDE7IC8vZG91YmxpbmdcbiAgfSBlbHNlIHtcbiAgICBtYXggPSBtYXggKyAxO1xuICB9XG4gIHZhciByYXRpbyA9IE1hdGgucmFuZG9tKCk7XG4gIHZhciByYW5nZSA9IG1heCAtIG1pbjtcblxuICByZXR1cm4gfn4ocmFuZ2UgKiByYXRpbyArIG1pbik7IC8vIH5+IGNvZXJjZXMgdG8gYW4gaW50LCBidXQgZmFzdC5cbn1cblxuZnVuY3Rpb24gZGVmYXVsdEJhY2tPZmYobWluKSB7XG4gIHZhciBtYXggPSAwO1xuICBpZiAoIW1pbikge1xuICAgIG1heCA9IDIwMDA7XG4gIH1cbiAgcmV0dXJuIHJhbmRvbU51bWJlcihtaW4sIG1heCk7XG59XG5cbmZ1bmN0aW9uIGJhY2tPZmYocmVwSWQsIHNyYywgdGFyZ2V0LCBvcHRzLCByZXR1cm5WYWx1ZSwgcmVzdWx0LCBlcnJvcikge1xuICBpZiAob3B0cy5yZXRyeSA9PT0gZmFsc2UpIHtcbiAgICByZXR1cm5WYWx1ZS5lbWl0KCdlcnJvcicsIGVycm9yKTtcbiAgICByZXR1cm5WYWx1ZS5yZW1vdmVBbGxMaXN0ZW5lcnMoKTtcbiAgICByZXR1cm47XG4gIH1cbiAgb3B0cy5kZWZhdWx0X2JhY2tfb2ZmID0gb3B0cy5kZWZhdWx0X2JhY2tfb2ZmIHx8IDA7XG4gIG9wdHMucmV0cmllcyA9IG9wdHMucmV0cmllcyB8fCAwO1xuICBpZiAodHlwZW9mIG9wdHMuYmFja19vZmZfZnVuY3Rpb24gIT09ICdmdW5jdGlvbicpIHtcbiAgICBvcHRzLmJhY2tfb2ZmX2Z1bmN0aW9uID0gZGVmYXVsdEJhY2tPZmY7XG4gIH1cbiAgb3B0cy5yZXRyaWVzKys7XG4gIGlmIChvcHRzLm1heF9yZXRyaWVzICYmIG9wdHMucmV0cmllcyA+IG9wdHMubWF4X3JldHJpZXMpIHtcbiAgICByZXR1cm5WYWx1ZS5lbWl0KCdlcnJvcicsIG5ldyBFcnJvcigndHJpZWQgJyArXG4gICAgICBvcHRzLnJldHJpZXMgKyAnIHRpbWVzIGJ1dCByZXBsaWNhdGlvbiBmYWlsZWQnKSk7XG4gICAgcmV0dXJuVmFsdWUucmVtb3ZlQWxsTGlzdGVuZXJzKCk7XG4gICAgcmV0dXJuO1xuICB9XG4gIHJldHVyblZhbHVlLmVtaXQoJ3JlcXVlc3RFcnJvcicsIGVycm9yKTtcbiAgaWYgKHJldHVyblZhbHVlLnN0YXRlID09PSAnYWN0aXZlJykge1xuICAgIHJldHVyblZhbHVlLmVtaXQoJ3BhdXNlZCcsIGVycm9yKTtcbiAgICByZXR1cm5WYWx1ZS5zdGF0ZSA9ICdzdG9wcGVkJztcbiAgICByZXR1cm5WYWx1ZS5vbmNlKCdhY3RpdmUnLCBmdW5jdGlvbiAoKSB7XG4gICAgICBvcHRzLmN1cnJlbnRfYmFja19vZmYgPSBvcHRzLmRlZmF1bHRfYmFja19vZmY7XG4gICAgfSk7XG4gIH1cblxuICBvcHRzLmN1cnJlbnRfYmFja19vZmYgPSBvcHRzLmN1cnJlbnRfYmFja19vZmYgfHwgb3B0cy5kZWZhdWx0X2JhY2tfb2ZmO1xuICBvcHRzLmN1cnJlbnRfYmFja19vZmYgPSBvcHRzLmJhY2tfb2ZmX2Z1bmN0aW9uKG9wdHMuY3VycmVudF9iYWNrX29mZik7XG4gIHNldFRpbWVvdXQoZnVuY3Rpb24gKCkge1xuICAgIHJlcGxpY2F0ZShyZXBJZCwgc3JjLCB0YXJnZXQsIG9wdHMsIHJldHVyblZhbHVlKTtcbiAgfSwgb3B0cy5jdXJyZW50X2JhY2tfb2ZmKTtcbn1cblxuLy8gV2UgY3JlYXRlIGEgYmFzaWMgcHJvbWlzZSBzbyB0aGUgY2FsbGVyIGNhbiBjYW5jZWwgdGhlIHJlcGxpY2F0aW9uIHBvc3NpYmx5XG4vLyBiZWZvcmUgd2UgaGF2ZSBhY3R1YWxseSBzdGFydGVkIGxpc3RlbmluZyB0byBjaGFuZ2VzIGV0Y1xudXRpbHMuaW5oZXJpdHMoUmVwbGljYXRpb24sIEVFKTtcbmZ1bmN0aW9uIFJlcGxpY2F0aW9uKCkge1xuICBFRS5jYWxsKHRoaXMpO1xuICB0aGlzLmNhbmNlbGxlZCA9IGZhbHNlO1xuICB0aGlzLnN0YXRlID0gJ3BlbmRpbmcnO1xuICB2YXIgc2VsZiA9IHRoaXM7XG4gIHZhciBwcm9taXNlID0gbmV3IHV0aWxzLlByb21pc2UoZnVuY3Rpb24gKGZ1bGZpbGwsIHJlamVjdCkge1xuICAgIHNlbGYub25jZSgnY29tcGxldGUnLCBmdWxmaWxsKTtcbiAgICBzZWxmLm9uY2UoJ2Vycm9yJywgcmVqZWN0KTtcbiAgfSk7XG4gIHNlbGYudGhlbiA9IGZ1bmN0aW9uIChyZXNvbHZlLCByZWplY3QpIHtcbiAgICByZXR1cm4gcHJvbWlzZS50aGVuKHJlc29sdmUsIHJlamVjdCk7XG4gIH07XG4gIHNlbGZbXCJjYXRjaFwiXSA9IGZ1bmN0aW9uIChyZWplY3QpIHtcbiAgICByZXR1cm4gcHJvbWlzZVtcImNhdGNoXCJdKHJlamVjdCk7XG4gIH07XG4gIC8vIEFzIHdlIGFsbG93IGVycm9yIGhhbmRsaW5nIHZpYSBcImVycm9yXCIgZXZlbnQgYXMgd2VsbCxcbiAgLy8gcHV0IGEgc3R1YiBpbiBoZXJlIHNvIHRoYXQgcmVqZWN0aW5nIG5ldmVyIHRocm93cyBVbmhhbmRsZWRFcnJvci5cbiAgc2VsZltcImNhdGNoXCJdKGZ1bmN0aW9uICgpIHt9KTtcbn1cblxuUmVwbGljYXRpb24ucHJvdG90eXBlLmNhbmNlbCA9IGZ1bmN0aW9uICgpIHtcbiAgdGhpcy5jYW5jZWxsZWQgPSB0cnVlO1xuICB0aGlzLnN0YXRlID0gJ2NhbmNlbGxlZCc7XG4gIHRoaXMuZW1pdCgnY2FuY2VsJyk7XG59O1xuXG5SZXBsaWNhdGlvbi5wcm90b3R5cGUucmVhZHkgPSBmdW5jdGlvbiAoc3JjLCB0YXJnZXQpIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICBmdW5jdGlvbiBvbkRlc3Ryb3koKSB7XG4gICAgc2VsZi5jYW5jZWwoKTtcbiAgfVxuICBzcmMub25jZSgnZGVzdHJveWVkJywgb25EZXN0cm95KTtcbiAgdGFyZ2V0Lm9uY2UoJ2Rlc3Ryb3llZCcsIG9uRGVzdHJveSk7XG4gIGZ1bmN0aW9uIGNsZWFudXAoKSB7XG4gICAgc3JjLnJlbW92ZUxpc3RlbmVyKCdkZXN0cm95ZWQnLCBvbkRlc3Ryb3kpO1xuICAgIHRhcmdldC5yZW1vdmVMaXN0ZW5lcignZGVzdHJveWVkJywgb25EZXN0cm95KTtcbiAgfVxuICB0aGlzLnRoZW4oY2xlYW51cCwgY2xlYW51cCk7XG59O1xuXG5cbi8vIFRPRE86IGNoZWNrIENvdWNoREIncyByZXBsaWNhdGlvbiBpZCBnZW5lcmF0aW9uXG4vLyBHZW5lcmF0ZSBhIHVuaXF1ZSBpZCBwYXJ0aWN1bGFyIHRvIHRoaXMgcmVwbGljYXRpb25cbmZ1bmN0aW9uIGdlblJlcGxpY2F0aW9uSWQoc3JjLCB0YXJnZXQsIG9wdHMpIHtcbiAgdmFyIGZpbHRlckZ1biA9IG9wdHMuZmlsdGVyID8gb3B0cy5maWx0ZXIudG9TdHJpbmcoKSA6ICcnO1xuICByZXR1cm4gc3JjLmlkKCkudGhlbihmdW5jdGlvbiAoc3JjX2lkKSB7XG4gICAgcmV0dXJuIHRhcmdldC5pZCgpLnRoZW4oZnVuY3Rpb24gKHRhcmdldF9pZCkge1xuICAgICAgdmFyIHF1ZXJ5RGF0YSA9IHNyY19pZCArIHRhcmdldF9pZCArIGZpbHRlckZ1biArXG4gICAgICAgIEpTT04uc3RyaW5naWZ5KG9wdHMucXVlcnlfcGFyYW1zKSArIG9wdHMuZG9jX2lkcztcbiAgICAgIHJldHVybiB1dGlscy5NRDUocXVlcnlEYXRhKS50aGVuKGZ1bmN0aW9uIChtZDUpIHtcbiAgICAgICAgLy8gY2FuJ3QgdXNlIHN0cmFpZ2h0LXVwIG1kNSBhbHBoYWJldCwgYmVjYXVzZVxuICAgICAgICAvLyB0aGUgY2hhciAnLycgaXMgaW50ZXJwcmV0ZWQgYXMgYmVpbmcgZm9yIGF0dGFjaG1lbnRzLFxuICAgICAgICAvLyBhbmQgKyBpcyBhbHNvIG5vdCB1cmwtc2FmZVxuICAgICAgICBtZDUgPSBtZDUucmVwbGFjZSgvXFwvL2csICcuJykucmVwbGFjZSgvXFwrL2csICdfJyk7XG4gICAgICAgIHJldHVybiAnX2xvY2FsLycgKyBtZDU7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSk7XG59XG5cbmZ1bmN0aW9uIHJlcGxpY2F0ZShyZXBJZCwgc3JjLCB0YXJnZXQsIG9wdHMsIHJldHVyblZhbHVlLCByZXN1bHQpIHtcbiAgdmFyIGJhdGNoZXMgPSBbXTsgICAgICAgICAgICAgICAvLyBsaXN0IG9mIGJhdGNoZXMgdG8gYmUgcHJvY2Vzc2VkXG4gIHZhciBjdXJyZW50QmF0Y2g7ICAgICAgICAgICAgICAgLy8gdGhlIGJhdGNoIGN1cnJlbnRseSBiZWluZyBwcm9jZXNzZWRcbiAgdmFyIHBlbmRpbmdCYXRjaCA9IHtcbiAgICBzZXE6IDAsXG4gICAgY2hhbmdlczogW10sXG4gICAgZG9jczogW11cbiAgfTsgLy8gbmV4dCBiYXRjaCwgbm90IHlldCByZWFkeSB0byBiZSBwcm9jZXNzZWRcbiAgdmFyIHdyaXRpbmdDaGVja3BvaW50ID0gZmFsc2U7ICAvLyB0cnVlIHdoaWxlIGNoZWNrcG9pbnQgaXMgYmVpbmcgd3JpdHRlblxuICB2YXIgY2hhbmdlc0NvbXBsZXRlZCA9IGZhbHNlOyAgIC8vIHRydWUgd2hlbiBhbGwgY2hhbmdlcyByZWNlaXZlZFxuICB2YXIgcmVwbGljYXRpb25Db21wbGV0ZWQgPSBmYWxzZTsgLy8gdHJ1ZSB3aGVuIHJlcGxpY2F0aW9uIGhhcyBjb21wbGV0ZWRcbiAgdmFyIGxhc3Rfc2VxID0gMDtcbiAgdmFyIGNvbnRpbnVvdXMgPSBvcHRzLmNvbnRpbnVvdXMgfHwgb3B0cy5saXZlIHx8IGZhbHNlO1xuICB2YXIgYmF0Y2hfc2l6ZSA9IG9wdHMuYmF0Y2hfc2l6ZSB8fCAxMDA7XG4gIHZhciBiYXRjaGVzX2xpbWl0ID0gb3B0cy5iYXRjaGVzX2xpbWl0IHx8IDEwO1xuICB2YXIgY2hhbmdlc1BlbmRpbmcgPSBmYWxzZTsgICAgIC8vIHRydWUgd2hpbGUgc3JjLmNoYW5nZXMgaXMgcnVubmluZ1xuICB2YXIgZG9jX2lkcyA9IG9wdHMuZG9jX2lkcztcbiAgdmFyIHN0YXRlID0ge1xuICAgIGNhbmNlbGxlZDogZmFsc2VcbiAgfTtcbiAgdmFyIGNoZWNrcG9pbnRlciA9IG5ldyBDaGVja3BvaW50ZXIoc3JjLCB0YXJnZXQsIHJlcElkLCBzdGF0ZSk7XG4gIHZhciBhbGxFcnJvcnMgPSBbXTtcbiAgdmFyIGNoYW5nZWREb2NzID0gW107XG5cbiAgcmVzdWx0ID0gcmVzdWx0IHx8IHtcbiAgICBvazogdHJ1ZSxcbiAgICBzdGFydF90aW1lOiBuZXcgRGF0ZSgpLFxuICAgIGRvY3NfcmVhZDogMCxcbiAgICBkb2NzX3dyaXR0ZW46IDAsXG4gICAgZG9jX3dyaXRlX2ZhaWx1cmVzOiAwLFxuICAgIGVycm9yczogW11cbiAgfTtcblxuICB2YXIgY2hhbmdlc09wdHMgPSB7fTtcbiAgcmV0dXJuVmFsdWUucmVhZHkoc3JjLCB0YXJnZXQpO1xuXG4gIGZ1bmN0aW9uIHdyaXRlRG9jcygpIHtcbiAgICBpZiAoY3VycmVudEJhdGNoLmRvY3MubGVuZ3RoID09PSAwKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHZhciBkb2NzID0gY3VycmVudEJhdGNoLmRvY3M7XG4gICAgcmV0dXJuIHRhcmdldC5idWxrRG9jcyh7ZG9jczogZG9jcywgbmV3X2VkaXRzOiBmYWxzZX0pLnRoZW4oZnVuY3Rpb24gKHJlcykge1xuICAgICAgaWYgKHN0YXRlLmNhbmNlbGxlZCkge1xuICAgICAgICBjb21wbGV0ZVJlcGxpY2F0aW9uKCk7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignY2FuY2VsbGVkJyk7XG4gICAgICB9XG4gICAgICB2YXIgZXJyb3JzID0gW107XG4gICAgICB2YXIgZXJyb3JzQnlJZCA9IHt9O1xuICAgICAgcmVzLmZvckVhY2goZnVuY3Rpb24gKHJlcykge1xuICAgICAgICBpZiAocmVzLmVycm9yKSB7XG4gICAgICAgICAgcmVzdWx0LmRvY193cml0ZV9mYWlsdXJlcysrO1xuICAgICAgICAgIGVycm9ycy5wdXNoKHJlcyk7XG4gICAgICAgICAgZXJyb3JzQnlJZFtyZXMuaWRdID0gcmVzO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIHJlc3VsdC5lcnJvcnMgPSBlcnJvcnM7XG4gICAgICBhbGxFcnJvcnMgPSBhbGxFcnJvcnMuY29uY2F0KGVycm9ycyk7XG4gICAgICByZXN1bHQuZG9jc193cml0dGVuICs9IGN1cnJlbnRCYXRjaC5kb2NzLmxlbmd0aCAtIGVycm9ycy5sZW5ndGg7XG4gICAgICB2YXIgbm9uNDAzcyA9IGVycm9ycy5maWx0ZXIoZnVuY3Rpb24gKGVycm9yKSB7XG4gICAgICAgIHJldHVybiBlcnJvci5uYW1lICE9PSAndW5hdXRob3JpemVkJyAmJiBlcnJvci5uYW1lICE9PSAnZm9yYmlkZGVuJztcbiAgICAgIH0pO1xuXG4gICAgICBjaGFuZ2VkRG9jcyA9IFtdO1xuICAgICAgZG9jcy5mb3JFYWNoKGZ1bmN0aW9uKGRvYykge1xuICAgICAgICB2YXIgZXJyb3IgPSBlcnJvcnNCeUlkW2RvYy5faWRdO1xuICAgICAgICBpZiAoZXJyb3IpIHtcbiAgICAgICAgICByZXR1cm5WYWx1ZS5lbWl0KCdkZW5pZWQnLCB1dGlscy5jbG9uZShlcnJvcikpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNoYW5nZWREb2NzLnB1c2goZG9jKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGlmIChub240MDNzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgdmFyIGVycm9yID0gbmV3IEVycm9yKCdidWxrRG9jcyBlcnJvcicpO1xuICAgICAgICBlcnJvci5vdGhlcl9lcnJvcnMgPSBlcnJvcnM7XG4gICAgICAgIGFib3J0UmVwbGljYXRpb24oJ3RhcmdldC5idWxrRG9jcyBmYWlsZWQgdG8gd3JpdGUgZG9jcycsIGVycm9yKTtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdidWxrV3JpdGUgcGFydGlhbCBmYWlsdXJlJyk7XG4gICAgICB9XG4gICAgfSwgZnVuY3Rpb24gKGVycikge1xuICAgICAgcmVzdWx0LmRvY193cml0ZV9mYWlsdXJlcyArPSBkb2NzLmxlbmd0aDtcbiAgICAgIHRocm93IGVycjtcbiAgICB9KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHByb2Nlc3NEaWZmRG9jKGlkKSB7XG4gICAgdmFyIGRpZmZzID0gY3VycmVudEJhdGNoLmRpZmZzO1xuICAgIHZhciBhbGxNaXNzaW5nID0gZGlmZnNbaWRdLm1pc3Npbmc7XG4gICAgLy8gYXZvaWQgdXJsIHRvbyBsb25nIGVycm9yIGJ5IGJhdGNoaW5nXG4gICAgdmFyIG1pc3NpbmdCYXRjaGVzID0gW107XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBhbGxNaXNzaW5nLmxlbmd0aDsgaSArPSBNQVhfU0lNVUxUQU5FT1VTX1JFVlMpIHtcbiAgICAgIG1pc3NpbmdCYXRjaGVzLnB1c2goYWxsTWlzc2luZy5zbGljZShpLCBNYXRoLm1pbihhbGxNaXNzaW5nLmxlbmd0aCxcbiAgICAgICAgaSArIE1BWF9TSU1VTFRBTkVPVVNfUkVWUykpKTtcbiAgICB9XG5cbiAgICByZXR1cm4gdXRpbHMuUHJvbWlzZS5hbGwobWlzc2luZ0JhdGNoZXMubWFwKGZ1bmN0aW9uIChtaXNzaW5nKSB7XG4gICAgICB2YXIgb3B0cyA9IHtcbiAgICAgICAgcmV2czogdHJ1ZSxcbiAgICAgICAgb3Blbl9yZXZzOiBtaXNzaW5nLFxuICAgICAgICBhdHRhY2htZW50czogdHJ1ZVxuICAgICAgfTtcbiAgICAgIHJldHVybiBzcmMuZ2V0KGlkLCBvcHRzKS50aGVuKGZ1bmN0aW9uIChkb2NzKSB7XG4gICAgICAgIGRvY3MuZm9yRWFjaChmdW5jdGlvbiAoZG9jKSB7XG4gICAgICAgICAgaWYgKHN0YXRlLmNhbmNlbGxlZCkge1xuICAgICAgICAgICAgcmV0dXJuIGNvbXBsZXRlUmVwbGljYXRpb24oKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKGRvYy5vaykge1xuICAgICAgICAgICAgcmVzdWx0LmRvY3NfcmVhZCsrO1xuICAgICAgICAgICAgY3VycmVudEJhdGNoLnBlbmRpbmdSZXZzKys7XG4gICAgICAgICAgICBjdXJyZW50QmF0Y2guZG9jcy5wdXNoKGRvYy5vayk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgZGVsZXRlIGRpZmZzW2lkXTtcbiAgICAgIH0pO1xuICAgIH0pKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGdldEFsbERvY3MoKSB7XG4gICAgdmFyIGRpZmZLZXlzID0gT2JqZWN0LmtleXMoY3VycmVudEJhdGNoLmRpZmZzKTtcbiAgICByZXR1cm4gdXRpbHMuUHJvbWlzZS5hbGwoZGlmZktleXMubWFwKHByb2Nlc3NEaWZmRG9jKSk7XG4gIH1cblxuXG4gIGZ1bmN0aW9uIGdldFJldmlzaW9uT25lRG9jcygpIHtcbiAgICAvLyBmaWx0ZXIgb3V0IHRoZSBnZW5lcmF0aW9uIDEgZG9jcyBhbmQgZ2V0IHRoZW1cbiAgICAvLyBsZWF2aW5nIHRoZSBub24tZ2VuZXJhdGlvbiBvbmUgZG9jcyB0byBiZSBnb3Qgb3RoZXJ3aXNlXG4gICAgdmFyIGlkcyA9IE9iamVjdC5rZXlzKGN1cnJlbnRCYXRjaC5kaWZmcykuZmlsdGVyKGZ1bmN0aW9uIChpZCkge1xuICAgICAgdmFyIG1pc3NpbmcgPSBjdXJyZW50QmF0Y2guZGlmZnNbaWRdLm1pc3Npbmc7XG4gICAgICByZXR1cm4gbWlzc2luZy5sZW5ndGggPT09IDEgJiYgbWlzc2luZ1swXS5zbGljZSgwLCAyKSA9PT0gJzEtJztcbiAgICB9KTtcbiAgICBpZiAoIWlkcy5sZW5ndGgpIHsgLy8gbm90aGluZyB0byBmZXRjaFxuICAgICAgcmV0dXJuIHV0aWxzLlByb21pc2UucmVzb2x2ZSgpO1xuICAgIH1cbiAgICByZXR1cm4gc3JjLmFsbERvY3Moe1xuICAgICAga2V5czogaWRzLFxuICAgICAgaW5jbHVkZV9kb2NzOiB0cnVlXG4gICAgfSkudGhlbihmdW5jdGlvbiAocmVzKSB7XG4gICAgICBpZiAoc3RhdGUuY2FuY2VsbGVkKSB7XG4gICAgICAgIGNvbXBsZXRlUmVwbGljYXRpb24oKTtcbiAgICAgICAgdGhyb3cgKG5ldyBFcnJvcignY2FuY2VsbGVkJykpO1xuICAgICAgfVxuICAgICAgcmVzLnJvd3MuZm9yRWFjaChmdW5jdGlvbiAocm93KSB7XG4gICAgICAgIGlmIChyb3cuZG9jICYmICFyb3cuZGVsZXRlZCAmJlxuICAgICAgICAgIHJvdy52YWx1ZS5yZXYuc2xpY2UoMCwgMikgPT09ICcxLScgJiYgKFxuICAgICAgICAgICAgIXJvdy5kb2MuX2F0dGFjaG1lbnRzIHx8XG4gICAgICAgICAgICBPYmplY3Qua2V5cyhyb3cuZG9jLl9hdHRhY2htZW50cykubGVuZ3RoID09PSAwXG4gICAgICAgICAgKVxuICAgICAgICApIHtcbiAgICAgICAgICByZXN1bHQuZG9jc19yZWFkKys7XG4gICAgICAgICAgY3VycmVudEJhdGNoLnBlbmRpbmdSZXZzKys7XG4gICAgICAgICAgY3VycmVudEJhdGNoLmRvY3MucHVzaChyb3cuZG9jKTtcbiAgICAgICAgICBkZWxldGUgY3VycmVudEJhdGNoLmRpZmZzW3Jvdy5pZF07XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgZnVuY3Rpb24gZ2V0RG9jcygpIHtcbiAgICByZXR1cm4gZ2V0UmV2aXNpb25PbmVEb2NzKCkudGhlbihnZXRBbGxEb2NzKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGZpbmlzaEJhdGNoKCkge1xuICAgIHdyaXRpbmdDaGVja3BvaW50ID0gdHJ1ZTtcbiAgICByZXR1cm4gY2hlY2twb2ludGVyLndyaXRlQ2hlY2twb2ludChjdXJyZW50QmF0Y2guc2VxKS50aGVuKGZ1bmN0aW9uICgpIHtcbiAgICAgIHdyaXRpbmdDaGVja3BvaW50ID0gZmFsc2U7XG4gICAgICBpZiAoc3RhdGUuY2FuY2VsbGVkKSB7XG4gICAgICAgIGNvbXBsZXRlUmVwbGljYXRpb24oKTtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdjYW5jZWxsZWQnKTtcbiAgICAgIH1cbiAgICAgIHJlc3VsdC5sYXN0X3NlcSA9IGxhc3Rfc2VxID0gY3VycmVudEJhdGNoLnNlcTtcbiAgICAgIHZhciBvdXRSZXN1bHQgPSB1dGlscy5jbG9uZShyZXN1bHQpO1xuICAgICAgb3V0UmVzdWx0LmRvY3MgPSBjaGFuZ2VkRG9jcztcbiAgICAgIHJldHVyblZhbHVlLmVtaXQoJ2NoYW5nZScsIG91dFJlc3VsdCk7XG4gICAgICBjdXJyZW50QmF0Y2ggPSB1bmRlZmluZWQ7XG4gICAgICBnZXRDaGFuZ2VzKCk7XG4gICAgfSlbXCJjYXRjaFwiXShmdW5jdGlvbiAoZXJyKSB7XG4gICAgICB3cml0aW5nQ2hlY2twb2ludCA9IGZhbHNlO1xuICAgICAgYWJvcnRSZXBsaWNhdGlvbignd3JpdGVDaGVja3BvaW50IGNvbXBsZXRlZCB3aXRoIGVycm9yJywgZXJyKTtcbiAgICAgIHRocm93IGVycjtcbiAgICB9KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGdldERpZmZzKCkge1xuICAgIHZhciBkaWZmID0ge307XG4gICAgY3VycmVudEJhdGNoLmNoYW5nZXMuZm9yRWFjaChmdW5jdGlvbiAoY2hhbmdlKSB7XG4gICAgICAvLyBDb3VjaGJhc2UgU3luYyBHYXRld2F5IGVtaXRzIHRoZXNlLCBidXQgd2UgY2FuIGlnbm9yZSB0aGVtXG4gICAgICBpZiAoY2hhbmdlLmlkID09PSBcIl91c2VyL1wiKSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGRpZmZbY2hhbmdlLmlkXSA9IGNoYW5nZS5jaGFuZ2VzLm1hcChmdW5jdGlvbiAoeCkge1xuICAgICAgICByZXR1cm4geC5yZXY7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgICByZXR1cm4gdGFyZ2V0LnJldnNEaWZmKGRpZmYpLnRoZW4oZnVuY3Rpb24gKGRpZmZzKSB7XG4gICAgICBpZiAoc3RhdGUuY2FuY2VsbGVkKSB7XG4gICAgICAgIGNvbXBsZXRlUmVwbGljYXRpb24oKTtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdjYW5jZWxsZWQnKTtcbiAgICAgIH1cbiAgICAgIC8vIGN1cnJlbnRCYXRjaC5kaWZmcyBlbGVtZW50cyBhcmUgZGVsZXRlZCBhcyB0aGUgZG9jdW1lbnRzIGFyZSB3cml0dGVuXG4gICAgICBjdXJyZW50QmF0Y2guZGlmZnMgPSBkaWZmcztcbiAgICAgIGN1cnJlbnRCYXRjaC5wZW5kaW5nUmV2cyA9IDA7XG4gICAgfSk7XG4gIH1cblxuICBmdW5jdGlvbiBzdGFydE5leHRCYXRjaCgpIHtcbiAgICBpZiAoc3RhdGUuY2FuY2VsbGVkIHx8IGN1cnJlbnRCYXRjaCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoYmF0Y2hlcy5sZW5ndGggPT09IDApIHtcbiAgICAgIHByb2Nlc3NQZW5kaW5nQmF0Y2godHJ1ZSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGN1cnJlbnRCYXRjaCA9IGJhdGNoZXMuc2hpZnQoKTtcbiAgICBnZXREaWZmcygpXG4gICAgICAudGhlbihnZXREb2NzKVxuICAgICAgLnRoZW4od3JpdGVEb2NzKVxuICAgICAgLnRoZW4oZmluaXNoQmF0Y2gpXG4gICAgICAudGhlbihzdGFydE5leHRCYXRjaClbXG4gICAgICBcImNhdGNoXCJdKGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgICAgYWJvcnRSZXBsaWNhdGlvbignYmF0Y2ggcHJvY2Vzc2luZyB0ZXJtaW5hdGVkIHdpdGggZXJyb3InLCBlcnIpO1xuICAgICAgfSk7XG4gIH1cblxuXG4gIGZ1bmN0aW9uIHByb2Nlc3NQZW5kaW5nQmF0Y2goaW1tZWRpYXRlKSB7XG4gICAgaWYgKHBlbmRpbmdCYXRjaC5jaGFuZ2VzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgaWYgKGJhdGNoZXMubGVuZ3RoID09PSAwICYmICFjdXJyZW50QmF0Y2gpIHtcbiAgICAgICAgaWYgKChjb250aW51b3VzICYmIGNoYW5nZXNPcHRzLmxpdmUpIHx8IGNoYW5nZXNDb21wbGV0ZWQpIHtcbiAgICAgICAgICByZXR1cm5WYWx1ZS5zdGF0ZSA9ICdwZW5kaW5nJztcbiAgICAgICAgICByZXR1cm5WYWx1ZS5lbWl0KCdwYXVzZWQnKTtcbiAgICAgICAgICByZXR1cm5WYWx1ZS5lbWl0KCd1cHRvZGF0ZScsIHJlc3VsdCk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGNoYW5nZXNDb21wbGV0ZWQpIHtcbiAgICAgICAgICBjb21wbGV0ZVJlcGxpY2F0aW9uKCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKFxuICAgICAgaW1tZWRpYXRlIHx8XG4gICAgICBjaGFuZ2VzQ29tcGxldGVkIHx8XG4gICAgICBwZW5kaW5nQmF0Y2guY2hhbmdlcy5sZW5ndGggPj0gYmF0Y2hfc2l6ZVxuICAgICkge1xuICAgICAgYmF0Y2hlcy5wdXNoKHBlbmRpbmdCYXRjaCk7XG4gICAgICBwZW5kaW5nQmF0Y2ggPSB7XG4gICAgICAgIHNlcTogMCxcbiAgICAgICAgY2hhbmdlczogW10sXG4gICAgICAgIGRvY3M6IFtdXG4gICAgICB9O1xuICAgICAgaWYgKHJldHVyblZhbHVlLnN0YXRlID09PSAncGVuZGluZycgfHwgcmV0dXJuVmFsdWUuc3RhdGUgPT09ICdzdG9wcGVkJykge1xuICAgICAgICByZXR1cm5WYWx1ZS5zdGF0ZSA9ICdhY3RpdmUnO1xuICAgICAgICByZXR1cm5WYWx1ZS5lbWl0KCdhY3RpdmUnKTtcbiAgICAgIH1cbiAgICAgIHN0YXJ0TmV4dEJhdGNoKCk7XG4gICAgfVxuICB9XG5cblxuICBmdW5jdGlvbiBhYm9ydFJlcGxpY2F0aW9uKHJlYXNvbiwgZXJyKSB7XG4gICAgaWYgKHJlcGxpY2F0aW9uQ29tcGxldGVkKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmICghZXJyLm1lc3NhZ2UpIHtcbiAgICAgIGVyci5tZXNzYWdlID0gcmVhc29uO1xuICAgIH1cbiAgICByZXN1bHQub2sgPSBmYWxzZTtcbiAgICByZXN1bHQuc3RhdHVzID0gJ2Fib3J0aW5nJztcbiAgICByZXN1bHQuZXJyb3JzLnB1c2goZXJyKTtcbiAgICBhbGxFcnJvcnMgPSBhbGxFcnJvcnMuY29uY2F0KGVycik7XG4gICAgYmF0Y2hlcyA9IFtdO1xuICAgIHBlbmRpbmdCYXRjaCA9IHtcbiAgICAgIHNlcTogMCxcbiAgICAgIGNoYW5nZXM6IFtdLFxuICAgICAgZG9jczogW11cbiAgICB9O1xuICAgIGNvbXBsZXRlUmVwbGljYXRpb24oKTtcbiAgfVxuXG5cbiAgZnVuY3Rpb24gY29tcGxldGVSZXBsaWNhdGlvbigpIHtcbiAgICBpZiAocmVwbGljYXRpb25Db21wbGV0ZWQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKHN0YXRlLmNhbmNlbGxlZCkge1xuICAgICAgcmVzdWx0LnN0YXR1cyA9ICdjYW5jZWxsZWQnO1xuICAgICAgaWYgKHdyaXRpbmdDaGVja3BvaW50KSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICB9XG4gICAgcmVzdWx0LnN0YXR1cyA9IHJlc3VsdC5zdGF0dXMgfHwgJ2NvbXBsZXRlJztcbiAgICByZXN1bHQuZW5kX3RpbWUgPSBuZXcgRGF0ZSgpO1xuICAgIHJlc3VsdC5sYXN0X3NlcSA9IGxhc3Rfc2VxO1xuICAgIHJlcGxpY2F0aW9uQ29tcGxldGVkID0gc3RhdGUuY2FuY2VsbGVkID0gdHJ1ZTtcbiAgICB2YXIgbm9uNDAzcyA9IGFsbEVycm9ycy5maWx0ZXIoZnVuY3Rpb24gKGVycm9yKSB7XG4gICAgICByZXR1cm4gZXJyb3IubmFtZSAhPT0gJ3VuYXV0aG9yaXplZCcgJiYgZXJyb3IubmFtZSAhPT0gJ2ZvcmJpZGRlbic7XG4gICAgfSk7XG4gICAgaWYgKG5vbjQwM3MubGVuZ3RoID4gMCkge1xuICAgICAgdmFyIGVycm9yID0gYWxsRXJyb3JzLnBvcCgpO1xuICAgICAgaWYgKGFsbEVycm9ycy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGVycm9yLm90aGVyX2Vycm9ycyA9IGFsbEVycm9ycztcbiAgICAgIH1cbiAgICAgIGVycm9yLnJlc3VsdCA9IHJlc3VsdDtcbiAgICAgIGJhY2tPZmYocmVwSWQsIHNyYywgdGFyZ2V0LCBvcHRzLCByZXR1cm5WYWx1ZSwgcmVzdWx0LCBlcnJvcik7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlc3VsdC5lcnJvcnMgPSBhbGxFcnJvcnM7XG4gICAgICByZXR1cm5WYWx1ZS5lbWl0KCdjb21wbGV0ZScsIHJlc3VsdCk7XG4gICAgICByZXR1cm5WYWx1ZS5yZW1vdmVBbGxMaXN0ZW5lcnMoKTtcbiAgICB9XG4gIH1cblxuXG4gIGZ1bmN0aW9uIG9uQ2hhbmdlKGNoYW5nZSkge1xuICAgIGlmIChzdGF0ZS5jYW5jZWxsZWQpIHtcbiAgICAgIHJldHVybiBjb21wbGV0ZVJlcGxpY2F0aW9uKCk7XG4gICAgfVxuICAgIHZhciBmaWx0ZXIgPSB1dGlscy5maWx0ZXJDaGFuZ2Uob3B0cykoY2hhbmdlKTtcbiAgICBpZiAoIWZpbHRlcikge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoXG4gICAgICBwZW5kaW5nQmF0Y2guY2hhbmdlcy5sZW5ndGggPT09IDAgJiZcbiAgICAgIGJhdGNoZXMubGVuZ3RoID09PSAwICYmXG4gICAgICAhY3VycmVudEJhdGNoXG4gICAgKSB7XG4gICAgICByZXR1cm5WYWx1ZS5lbWl0KCdvdXRvZmRhdGUnLCByZXN1bHQpO1xuICAgIH1cbiAgICBwZW5kaW5nQmF0Y2guc2VxID0gY2hhbmdlLnNlcTtcbiAgICBwZW5kaW5nQmF0Y2guY2hhbmdlcy5wdXNoKGNoYW5nZSk7XG4gICAgcHJvY2Vzc1BlbmRpbmdCYXRjaChiYXRjaGVzLmxlbmd0aCA9PT0gMCk7XG4gIH1cblxuXG4gIGZ1bmN0aW9uIG9uQ2hhbmdlc0NvbXBsZXRlKGNoYW5nZXMpIHtcbiAgICBjaGFuZ2VzUGVuZGluZyA9IGZhbHNlO1xuICAgIGlmIChzdGF0ZS5jYW5jZWxsZWQpIHtcbiAgICAgIHJldHVybiBjb21wbGV0ZVJlcGxpY2F0aW9uKCk7XG4gICAgfVxuXG4gICAgLy8gaWYgbm8gcmVzdWx0cyB3ZXJlIHJldHVybmVkIHRoZW4gd2UncmUgZG9uZSxcbiAgICAvLyBlbHNlIGZldGNoIG1vcmVcbiAgICBpZiAoY2hhbmdlcy5yZXN1bHRzLmxlbmd0aCA+IDApIHtcbiAgICAgIGNoYW5nZXNPcHRzLnNpbmNlID0gY2hhbmdlcy5sYXN0X3NlcTtcbiAgICAgIGdldENoYW5nZXMoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKGNvbnRpbnVvdXMpIHtcbiAgICAgICAgY2hhbmdlc09wdHMubGl2ZSA9IHRydWU7XG4gICAgICAgIGdldENoYW5nZXMoKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNoYW5nZXNDb21wbGV0ZWQgPSB0cnVlO1xuICAgICAgfVxuICAgIH1cbiAgICBwcm9jZXNzUGVuZGluZ0JhdGNoKHRydWUpO1xuICB9XG5cblxuICBmdW5jdGlvbiBvbkNoYW5nZXNFcnJvcihlcnIpIHtcbiAgICBjaGFuZ2VzUGVuZGluZyA9IGZhbHNlO1xuICAgIGlmIChzdGF0ZS5jYW5jZWxsZWQpIHtcbiAgICAgIHJldHVybiBjb21wbGV0ZVJlcGxpY2F0aW9uKCk7XG4gICAgfVxuICAgIGFib3J0UmVwbGljYXRpb24oJ2NoYW5nZXMgcmVqZWN0ZWQnLCBlcnIpO1xuICB9XG5cblxuICBmdW5jdGlvbiBnZXRDaGFuZ2VzKCkge1xuICAgIGlmICghKFxuICAgICAgIWNoYW5nZXNQZW5kaW5nICYmXG4gICAgICAhY2hhbmdlc0NvbXBsZXRlZCAmJlxuICAgICAgYmF0Y2hlcy5sZW5ndGggPCBiYXRjaGVzX2xpbWl0XG4gICAgKSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjaGFuZ2VzUGVuZGluZyA9IHRydWU7XG4gICAgZnVuY3Rpb24gYWJvcnRDaGFuZ2VzKCkge1xuICAgICAgY2hhbmdlcy5jYW5jZWwoKTtcbiAgICB9XG4gICAgZnVuY3Rpb24gcmVtb3ZlTGlzdGVuZXIoKSB7XG4gICAgICByZXR1cm5WYWx1ZS5yZW1vdmVMaXN0ZW5lcignY2FuY2VsJywgYWJvcnRDaGFuZ2VzKTtcbiAgICB9XG4gICAgcmV0dXJuVmFsdWUub25jZSgnY2FuY2VsJywgYWJvcnRDaGFuZ2VzKTtcbiAgICB2YXIgY2hhbmdlcyA9IHNyYy5jaGFuZ2VzKGNoYW5nZXNPcHRzKVxuICAgIC5vbignY2hhbmdlJywgb25DaGFuZ2UpO1xuICAgIGNoYW5nZXMudGhlbihyZW1vdmVMaXN0ZW5lciwgcmVtb3ZlTGlzdGVuZXIpO1xuICAgIGNoYW5nZXMudGhlbihvbkNoYW5nZXNDb21wbGV0ZSlbXG4gICAgXCJjYXRjaFwiXShvbkNoYW5nZXNFcnJvcik7XG4gIH1cblxuXG4gIGZ1bmN0aW9uIHN0YXJ0Q2hhbmdlcygpIHtcbiAgICBjaGVja3BvaW50ZXIuZ2V0Q2hlY2twb2ludCgpLnRoZW4oZnVuY3Rpb24gKGNoZWNrcG9pbnQpIHtcbiAgICAgIGxhc3Rfc2VxID0gY2hlY2twb2ludDtcbiAgICAgIGNoYW5nZXNPcHRzID0ge1xuICAgICAgICBzaW5jZTogbGFzdF9zZXEsXG4gICAgICAgIGxpbWl0OiBiYXRjaF9zaXplLFxuICAgICAgICBiYXRjaF9zaXplOiBiYXRjaF9zaXplLFxuICAgICAgICBzdHlsZTogJ2FsbF9kb2NzJyxcbiAgICAgICAgZG9jX2lkczogZG9jX2lkcyxcbiAgICAgICAgcmV0dXJuRG9jczogdHJ1ZSAvLyByZXF1aXJlZCBzbyB3ZSBrbm93IHdoZW4gd2UncmUgZG9uZVxuICAgICAgfTtcbiAgICAgIGlmIChvcHRzLmZpbHRlcikge1xuICAgICAgICBpZiAodHlwZW9mIG9wdHMuZmlsdGVyICE9PSAnc3RyaW5nJykge1xuICAgICAgICAgIC8vIHJlcXVpcmVkIGZvciB0aGUgY2xpZW50LXNpZGUgZmlsdGVyIGluIG9uQ2hhbmdlXG4gICAgICAgICAgY2hhbmdlc09wdHMuaW5jbHVkZV9kb2NzID0gdHJ1ZTtcbiAgICAgICAgfSBlbHNlIHsgLy8gZGRvYyBmaWx0ZXJcbiAgICAgICAgICBjaGFuZ2VzT3B0cy5maWx0ZXIgPSBvcHRzLmZpbHRlcjtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYgKG9wdHMucXVlcnlfcGFyYW1zKSB7XG4gICAgICAgIGNoYW5nZXNPcHRzLnF1ZXJ5X3BhcmFtcyA9IG9wdHMucXVlcnlfcGFyYW1zO1xuICAgICAgfVxuICAgICAgaWYgKG9wdHMudmlldykge1xuICAgICAgICBjaGFuZ2VzT3B0cy52aWV3ID0gb3B0cy52aWV3O1xuICAgICAgfVxuICAgICAgZ2V0Q2hhbmdlcygpO1xuICAgIH0pW1wiY2F0Y2hcIl0oZnVuY3Rpb24gKGVycikge1xuICAgICAgYWJvcnRSZXBsaWNhdGlvbignZ2V0Q2hlY2twb2ludCByZWplY3RlZCB3aXRoICcsIGVycik7XG4gICAgfSk7XG4gIH1cblxuICBpZiAocmV0dXJuVmFsdWUuY2FuY2VsbGVkKSB7IC8vIGNhbmNlbGxlZCBpbW1lZGlhdGVseVxuICAgIGNvbXBsZXRlUmVwbGljYXRpb24oKTtcbiAgICByZXR1cm47XG4gIH1cblxuICByZXR1cm5WYWx1ZS5vbmNlKCdjYW5jZWwnLCBjb21wbGV0ZVJlcGxpY2F0aW9uKTtcblxuICBpZiAodHlwZW9mIG9wdHMub25DaGFuZ2UgPT09ICdmdW5jdGlvbicpIHtcbiAgICByZXR1cm5WYWx1ZS5vbignY2hhbmdlJywgb3B0cy5vbkNoYW5nZSk7XG4gIH1cblxuICBpZiAodHlwZW9mIG9wdHMuY29tcGxldGUgPT09ICdmdW5jdGlvbicpIHtcbiAgICByZXR1cm5WYWx1ZS5vbmNlKCdlcnJvcicsIG9wdHMuY29tcGxldGUpO1xuICAgIHJldHVyblZhbHVlLm9uY2UoJ2NvbXBsZXRlJywgZnVuY3Rpb24gKHJlc3VsdCkge1xuICAgICAgb3B0cy5jb21wbGV0ZShudWxsLCByZXN1bHQpO1xuICAgIH0pO1xuICB9XG5cbiAgaWYgKHR5cGVvZiBvcHRzLnNpbmNlID09PSAndW5kZWZpbmVkJykge1xuICAgIHN0YXJ0Q2hhbmdlcygpO1xuICB9IGVsc2Uge1xuICAgIHdyaXRpbmdDaGVja3BvaW50ID0gdHJ1ZTtcbiAgICBjaGVja3BvaW50ZXIud3JpdGVDaGVja3BvaW50KG9wdHMuc2luY2UpLnRoZW4oZnVuY3Rpb24gKCkge1xuICAgICAgd3JpdGluZ0NoZWNrcG9pbnQgPSBmYWxzZTtcbiAgICAgIGlmIChzdGF0ZS5jYW5jZWxsZWQpIHtcbiAgICAgICAgY29tcGxldGVSZXBsaWNhdGlvbigpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBsYXN0X3NlcSA9IG9wdHMuc2luY2U7XG4gICAgICBzdGFydENoYW5nZXMoKTtcbiAgICB9KVtcImNhdGNoXCJdKGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgIHdyaXRpbmdDaGVja3BvaW50ID0gZmFsc2U7XG4gICAgICBhYm9ydFJlcGxpY2F0aW9uKCd3cml0ZUNoZWNrcG9pbnQgY29tcGxldGVkIHdpdGggZXJyb3InLCBlcnIpO1xuICAgICAgdGhyb3cgZXJyO1xuICAgIH0pO1xuICB9XG59XG5cbmV4cG9ydHMudG9Qb3VjaCA9IHRvUG91Y2g7XG5mdW5jdGlvbiB0b1BvdWNoKGRiLCBvcHRzKSB7XG4gIHZhciBQb3VjaENvbnN0cnVjdG9yID0gb3B0cy5Qb3VjaENvbnN0cnVjdG9yO1xuICBpZiAodHlwZW9mIGRiID09PSAnc3RyaW5nJykge1xuICAgIHJldHVybiBuZXcgUG91Y2hDb25zdHJ1Y3RvcihkYiwgb3B0cyk7XG4gIH0gZWxzZSBpZiAoZGIudGhlbikge1xuICAgIHJldHVybiBkYjtcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gdXRpbHMuUHJvbWlzZS5yZXNvbHZlKGRiKTtcbiAgfVxufVxuXG5cbmV4cG9ydHMucmVwbGljYXRlID0gcmVwbGljYXRlV3JhcHBlcjtcbmZ1bmN0aW9uIHJlcGxpY2F0ZVdyYXBwZXIoc3JjLCB0YXJnZXQsIG9wdHMsIGNhbGxiYWNrKSB7XG4gIGlmICh0eXBlb2Ygb3B0cyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIGNhbGxiYWNrID0gb3B0cztcbiAgICBvcHRzID0ge307XG4gIH1cbiAgaWYgKHR5cGVvZiBvcHRzID09PSAndW5kZWZpbmVkJykge1xuICAgIG9wdHMgPSB7fTtcbiAgfVxuICBpZiAoIW9wdHMuY29tcGxldGUpIHtcbiAgICBvcHRzLmNvbXBsZXRlID0gY2FsbGJhY2sgfHwgZnVuY3Rpb24gKCkge307XG4gIH1cbiAgb3B0cyA9IHV0aWxzLmNsb25lKG9wdHMpO1xuICBvcHRzLmNvbnRpbnVvdXMgPSBvcHRzLmNvbnRpbnVvdXMgfHwgb3B0cy5saXZlO1xuICBvcHRzLnJldHJ5ID0gKCdyZXRyeScgaW4gb3B0cykgPyBvcHRzLnJldHJ5IDogUkVUUllfREVGQVVMVDtcbiAgLypqc2hpbnQgdmFsaWR0aGlzOnRydWUgKi9cbiAgb3B0cy5Qb3VjaENvbnN0cnVjdG9yID0gb3B0cy5Qb3VjaENvbnN0cnVjdG9yIHx8IHRoaXM7XG4gIHZhciByZXBsaWNhdGVSZXQgPSBuZXcgUmVwbGljYXRpb24ob3B0cyk7XG4gIHRvUG91Y2goc3JjLCBvcHRzKS50aGVuKGZ1bmN0aW9uIChzcmMpIHtcbiAgICByZXR1cm4gdG9Qb3VjaCh0YXJnZXQsIG9wdHMpLnRoZW4oZnVuY3Rpb24gKHRhcmdldCkge1xuICAgICAgcmV0dXJuIGdlblJlcGxpY2F0aW9uSWQoc3JjLCB0YXJnZXQsIG9wdHMpLnRoZW4oZnVuY3Rpb24gKHJlcElkKSB7XG4gICAgICAgIHJlcGxpY2F0ZShyZXBJZCwgc3JjLCB0YXJnZXQsIG9wdHMsIHJlcGxpY2F0ZVJldCk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSlbXCJjYXRjaFwiXShmdW5jdGlvbiAoZXJyKSB7XG4gICAgcmVwbGljYXRlUmV0LmVtaXQoJ2Vycm9yJywgZXJyKTtcbiAgICBvcHRzLmNvbXBsZXRlKGVycik7XG4gIH0pO1xuICByZXR1cm4gcmVwbGljYXRlUmV0O1xufVxuIiwiXCJ1c2Ugc3RyaWN0XCI7XG5cbnZhciBQb3VjaERCID0gcmVxdWlyZShcIi4vY29uc3RydWN0b3JcIik7XG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzJyk7XG52YXIgUHJvbWlzZSA9IHV0aWxzLlByb21pc2U7XG52YXIgRXZlbnRFbWl0dGVyID0gcmVxdWlyZSgnZXZlbnRzJykuRXZlbnRFbWl0dGVyO1xuUG91Y2hEQi5hZGFwdGVycyA9IHt9O1xuUG91Y2hEQi5wcmVmZXJyZWRBZGFwdGVycyA9IHJlcXVpcmUoJy4vYWRhcHRlcnMvcHJlZmVycmVkQWRhcHRlcnMuanMnKTtcblxuUG91Y2hEQi5wcmVmaXggPSAnX3BvdWNoXyc7XG5cbnZhciBldmVudEVtaXR0ZXIgPSBuZXcgRXZlbnRFbWl0dGVyKCk7XG5cbnZhciBldmVudEVtaXR0ZXJNZXRob2RzID0gW1xuICAnb24nLFxuICAnYWRkTGlzdGVuZXInLFxuICAnZW1pdCcsXG4gICdsaXN0ZW5lcnMnLFxuICAnb25jZScsXG4gICdyZW1vdmVBbGxMaXN0ZW5lcnMnLFxuICAncmVtb3ZlTGlzdGVuZXInLFxuICAnc2V0TWF4TGlzdGVuZXJzJ1xuXTtcblxuZXZlbnRFbWl0dGVyTWV0aG9kcy5mb3JFYWNoKGZ1bmN0aW9uIChtZXRob2QpIHtcbiAgUG91Y2hEQlttZXRob2RdID0gZXZlbnRFbWl0dGVyW21ldGhvZF0uYmluZChldmVudEVtaXR0ZXIpO1xufSk7XG5Qb3VjaERCLnNldE1heExpc3RlbmVycygwKTtcblBvdWNoREIucGFyc2VBZGFwdGVyID0gZnVuY3Rpb24gKG5hbWUsIG9wdHMpIHtcbiAgdmFyIG1hdGNoID0gbmFtZS5tYXRjaCgvKFthLXpcXC1dKik6XFwvXFwvKC4qKS8pO1xuICB2YXIgYWRhcHRlciwgYWRhcHRlck5hbWU7XG4gIGlmIChtYXRjaCkge1xuICAgIC8vIHRoZSBodHRwIGFkYXB0ZXIgZXhwZWN0cyB0aGUgZnVsbHkgcXVhbGlmaWVkIG5hbWVcbiAgICBuYW1lID0gL2h0dHAocz8pLy50ZXN0KG1hdGNoWzFdKSA/IG1hdGNoWzFdICsgJzovLycgKyBtYXRjaFsyXSA6IG1hdGNoWzJdO1xuICAgIGFkYXB0ZXIgPSBtYXRjaFsxXTtcbiAgICBpZiAoIVBvdWNoREIuYWRhcHRlcnNbYWRhcHRlcl0udmFsaWQoKSkge1xuICAgICAgdGhyb3cgJ0ludmFsaWQgYWRhcHRlcic7XG4gICAgfVxuICAgIHJldHVybiB7bmFtZTogbmFtZSwgYWRhcHRlcjogbWF0Y2hbMV19O1xuICB9XG5cbiAgLy8gY2hlY2sgZm9yIGJyb3dzZXJzIHRoYXQgaGF2ZSBiZWVuIHVwZ3JhZGVkIGZyb20gd2Vic3FsLW9ubHkgdG8gd2Vic3FsK2lkYlxuICB2YXIgc2tpcElkYiA9ICdpZGInIGluIFBvdWNoREIuYWRhcHRlcnMgJiYgJ3dlYnNxbCcgaW4gUG91Y2hEQi5hZGFwdGVycyAmJlxuICAgIHV0aWxzLmhhc0xvY2FsU3RvcmFnZSgpICYmXG4gICAgbG9jYWxTdG9yYWdlWydfcG91Y2hfX3dlYnNxbGRiXycgKyBQb3VjaERCLnByZWZpeCArIG5hbWVdO1xuXG4gIGlmICh0eXBlb2Ygb3B0cyAhPT0gJ3VuZGVmaW5lZCcgJiYgb3B0cy5kYikge1xuICAgIGFkYXB0ZXJOYW1lID0gJ2xldmVsZGInO1xuICB9IGVsc2Uge1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgUG91Y2hEQi5wcmVmZXJyZWRBZGFwdGVycy5sZW5ndGg7ICsraSkge1xuICAgICAgYWRhcHRlck5hbWUgPSBQb3VjaERCLnByZWZlcnJlZEFkYXB0ZXJzW2ldO1xuICAgICAgaWYgKGFkYXB0ZXJOYW1lIGluIFBvdWNoREIuYWRhcHRlcnMpIHtcbiAgICAgICAgaWYgKHNraXBJZGIgJiYgYWRhcHRlck5hbWUgPT09ICdpZGInKSB7XG4gICAgICAgICAgY29udGludWU7IC8vIGtlZXAgdXNpbmcgd2Vic3FsIHRvIGF2b2lkIHVzZXIgZGF0YSBsb3NzXG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgYWRhcHRlciA9IFBvdWNoREIuYWRhcHRlcnNbYWRhcHRlck5hbWVdO1xuICBpZiAoYWRhcHRlck5hbWUgJiYgYWRhcHRlcikge1xuICAgIHZhciB1c2VfcHJlZml4ID0gJ3VzZV9wcmVmaXgnIGluIGFkYXB0ZXIgPyBhZGFwdGVyLnVzZV9wcmVmaXggOiB0cnVlO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIG5hbWU6IHVzZV9wcmVmaXggPyBQb3VjaERCLnByZWZpeCArIG5hbWUgOiBuYW1lLFxuICAgICAgYWRhcHRlcjogYWRhcHRlck5hbWVcbiAgICB9O1xuICB9XG5cbiAgdGhyb3cgJ05vIHZhbGlkIGFkYXB0ZXIgZm91bmQnO1xufTtcblxuUG91Y2hEQi5kZXN0cm95ID0gdXRpbHMudG9Qcm9taXNlKGZ1bmN0aW9uIChuYW1lLCBvcHRzLCBjYWxsYmFjaykge1xuXG4gIGlmICh0eXBlb2Ygb3B0cyA9PT0gJ2Z1bmN0aW9uJyB8fCB0eXBlb2Ygb3B0cyA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBjYWxsYmFjayA9IG9wdHM7XG4gICAgb3B0cyA9IHt9O1xuICB9XG4gIGlmIChuYW1lICYmIHR5cGVvZiBuYW1lID09PSAnb2JqZWN0Jykge1xuICAgIG9wdHMgPSBuYW1lO1xuICAgIG5hbWUgPSB1bmRlZmluZWQ7XG4gIH1cblxuICBpZiAoIW9wdHMuaW50ZXJuYWwpIHtcbiAgICBjb25zb2xlLmxvZygnUG91Y2hEQi5kZXN0cm95KCkgaXMgZGVwcmVjYXRlZCBhbmQgd2lsbCBiZSByZW1vdmVkLiAnICtcbiAgICAgICAgICAgICAgICAnUGxlYXNlIHVzZSBkYi5kZXN0cm95KCkgaW5zdGVhZC4nKTtcbiAgfVxuXG4gIHZhciBiYWNrZW5kID0gUG91Y2hEQi5wYXJzZUFkYXB0ZXIob3B0cy5uYW1lIHx8IG5hbWUsIG9wdHMpO1xuICB2YXIgZGJOYW1lID0gYmFja2VuZC5uYW1lO1xuICB2YXIgYWRhcHRlciA9IFBvdWNoREIuYWRhcHRlcnNbYmFja2VuZC5hZGFwdGVyXTtcbiAgdmFyIHVzZVByZWZpeCA9ICd1c2VfcHJlZml4JyBpbiBhZGFwdGVyID8gYWRhcHRlci51c2VfcHJlZml4IDogdHJ1ZTtcbiAgdmFyIGJhc2VOYW1lID0gdXNlUHJlZml4ID9cbiAgICBkYk5hbWUucmVwbGFjZShuZXcgUmVnRXhwKCdeJyArIFBvdWNoREIucHJlZml4KSwgJycpIDogZGJOYW1lO1xuICB2YXIgZnVsbE5hbWUgPSAoYmFja2VuZC5hZGFwdGVyID09PSAnaHR0cCcgfHwgYmFja2VuZC5hZGFwdGVyID09PSAnaHR0cHMnID9cbiAgICAgICcnIDogKG9wdHMucHJlZml4IHx8ICcnKSkgKyBkYk5hbWU7XG4gIGZ1bmN0aW9uIGRlc3Ryb3lEYigpIHtcbiAgICAvLyBjYWxsIGRlc3Ryb3kgbWV0aG9kIG9mIHRoZSBwYXJ0aWN1bGFyIGFkYXB0b3JcbiAgICBhZGFwdGVyLmRlc3Ryb3koZnVsbE5hbWUsIG9wdHMsIGZ1bmN0aW9uIChlcnIsIHJlc3ApIHtcbiAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgY2FsbGJhY2soZXJyKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIFBvdWNoREIuZW1pdCgnZGVzdHJveWVkJywgbmFtZSk7XG4gICAgICAgIC8vc28gd2UgZG9uJ3QgaGF2ZSB0byBzaWZ0IHRocm91Z2ggYWxsIGRibmFtZXNcbiAgICAgICAgUG91Y2hEQi5lbWl0KG5hbWUsICdkZXN0cm95ZWQnKTtcbiAgICAgICAgY2FsbGJhY2sobnVsbCwgcmVzcCB8fCB7ICdvayc6IHRydWUgfSk7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICB2YXIgY3JlYXRlT3B0cyA9IHV0aWxzLmV4dGVuZCh0cnVlLCB7fSwgb3B0cywge2FkYXB0ZXIgOiBiYWNrZW5kLmFkYXB0ZXJ9KTtcbiAgbmV3IFBvdWNoREIoYmFzZU5hbWUsIGNyZWF0ZU9wdHMsIGZ1bmN0aW9uIChlcnIsIGRiKSB7XG4gICAgaWYgKGVycikge1xuICAgICAgcmV0dXJuIGNhbGxiYWNrKGVycik7XG4gICAgfVxuICAgIGRiLmdldCgnX2xvY2FsL19wb3VjaF9kZXBlbmRlbnREYnMnLCBmdW5jdGlvbiAoZXJyLCBsb2NhbERvYykge1xuICAgICAgaWYgKGVycikge1xuICAgICAgICBpZiAoZXJyLnN0YXR1cyAhPT0gNDA0KSB7XG4gICAgICAgICAgcmV0dXJuIGNhbGxiYWNrKGVycik7XG4gICAgICAgIH0gZWxzZSB7IC8vIG5vIGRlcGVuZGVuY2llc1xuICAgICAgICAgIHJldHVybiBkZXN0cm95RGIoKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgdmFyIGRlcGVuZGVudERicyA9IGxvY2FsRG9jLmRlcGVuZGVudERicztcbiAgICAgIHZhciBkZWxldGVkTWFwID0gT2JqZWN0LmtleXMoZGVwZW5kZW50RGJzKS5tYXAoZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgdmFyIHRydWVOYW1lID0gdXNlUHJlZml4ID9cbiAgICAgICAgICBuYW1lLnJlcGxhY2UobmV3IFJlZ0V4cCgnXicgKyBQb3VjaERCLnByZWZpeCksICcnKSA6IG5hbWU7XG4gICAgICAgIHZhciBzdWJPcHRzID0gdXRpbHMuZXh0ZW5kKHRydWUsIG9wdHMsIGRiLl9fb3B0cyB8fCB7fSk7XG4gICAgICAgIHJldHVybiBkYi5jb25zdHJ1Y3Rvci5kZXN0cm95KHRydWVOYW1lLCBzdWJPcHRzKTtcbiAgICAgIH0pO1xuICAgICAgUHJvbWlzZS5hbGwoZGVsZXRlZE1hcCkudGhlbihkZXN0cm95RGIsIGZ1bmN0aW9uIChlcnJvcikge1xuICAgICAgICBjYWxsYmFjayhlcnJvcik7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSk7XG59KTtcblxuUG91Y2hEQi5hZGFwdGVyID0gZnVuY3Rpb24gKGlkLCBvYmopIHtcbiAgaWYgKG9iai52YWxpZCgpKSB7XG4gICAgUG91Y2hEQi5hZGFwdGVyc1tpZF0gPSBvYmo7XG4gIH1cbn07XG5cblBvdWNoREIucGx1Z2luID0gZnVuY3Rpb24gKG9iaikge1xuICBPYmplY3Qua2V5cyhvYmopLmZvckVhY2goZnVuY3Rpb24gKGlkKSB7XG4gICAgUG91Y2hEQi5wcm90b3R5cGVbaWRdID0gb2JqW2lkXTtcbiAgfSk7XG59O1xuXG5Qb3VjaERCLmRlZmF1bHRzID0gZnVuY3Rpb24gKGRlZmF1bHRPcHRzKSB7XG4gIGZ1bmN0aW9uIFBvdWNoQWx0KG5hbWUsIG9wdHMsIGNhbGxiYWNrKSB7XG4gICAgaWYgKHR5cGVvZiBvcHRzID09PSAnZnVuY3Rpb24nIHx8IHR5cGVvZiBvcHRzID09PSAndW5kZWZpbmVkJykge1xuICAgICAgY2FsbGJhY2sgPSBvcHRzO1xuICAgICAgb3B0cyA9IHt9O1xuICAgIH1cbiAgICBpZiAobmFtZSAmJiB0eXBlb2YgbmFtZSA9PT0gJ29iamVjdCcpIHtcbiAgICAgIG9wdHMgPSBuYW1lO1xuICAgICAgbmFtZSA9IHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICBvcHRzID0gdXRpbHMuZXh0ZW5kKHRydWUsIHt9LCBkZWZhdWx0T3B0cywgb3B0cyk7XG4gICAgUG91Y2hEQi5jYWxsKHRoaXMsIG5hbWUsIG9wdHMsIGNhbGxiYWNrKTtcbiAgfVxuXG4gIHV0aWxzLmluaGVyaXRzKFBvdWNoQWx0LCBQb3VjaERCKTtcblxuICBQb3VjaEFsdC5kZXN0cm95ID0gdXRpbHMudG9Qcm9taXNlKGZ1bmN0aW9uIChuYW1lLCBvcHRzLCBjYWxsYmFjaykge1xuICAgIGlmICh0eXBlb2Ygb3B0cyA9PT0gJ2Z1bmN0aW9uJyB8fCB0eXBlb2Ygb3B0cyA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgIGNhbGxiYWNrID0gb3B0cztcbiAgICAgIG9wdHMgPSB7fTtcbiAgICB9XG5cbiAgICBpZiAobmFtZSAmJiB0eXBlb2YgbmFtZSA9PT0gJ29iamVjdCcpIHtcbiAgICAgIG9wdHMgPSBuYW1lO1xuICAgICAgbmFtZSA9IHVuZGVmaW5lZDtcbiAgICB9XG4gICAgb3B0cyA9IHV0aWxzLmV4dGVuZCh0cnVlLCB7fSwgZGVmYXVsdE9wdHMsIG9wdHMpO1xuICAgIHJldHVybiBQb3VjaERCLmRlc3Ryb3kobmFtZSwgb3B0cywgY2FsbGJhY2spO1xuICB9KTtcblxuICBldmVudEVtaXR0ZXJNZXRob2RzLmZvckVhY2goZnVuY3Rpb24gKG1ldGhvZCkge1xuICAgIFBvdWNoQWx0W21ldGhvZF0gPSBldmVudEVtaXR0ZXJbbWV0aG9kXS5iaW5kKGV2ZW50RW1pdHRlcik7XG4gIH0pO1xuICBQb3VjaEFsdC5zZXRNYXhMaXN0ZW5lcnMoMCk7XG5cbiAgUG91Y2hBbHQucHJlZmVycmVkQWRhcHRlcnMgPSBQb3VjaERCLnByZWZlcnJlZEFkYXB0ZXJzLnNsaWNlKCk7XG4gIE9iamVjdC5rZXlzKFBvdWNoREIpLmZvckVhY2goZnVuY3Rpb24gKGtleSkge1xuICAgIGlmICghKGtleSBpbiBQb3VjaEFsdCkpIHtcbiAgICAgIFBvdWNoQWx0W2tleV0gPSBQb3VjaERCW2tleV07XG4gICAgfVxuICB9KTtcblxuICByZXR1cm4gUG91Y2hBbHQ7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IFBvdWNoREI7XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciB1dGlscyA9IHJlcXVpcmUoJy4vdXRpbHMnKTtcbnZhciByZXBsaWNhdGlvbiA9IHJlcXVpcmUoJy4vcmVwbGljYXRlJyk7XG52YXIgcmVwbGljYXRlID0gcmVwbGljYXRpb24ucmVwbGljYXRlO1xudmFyIEVFID0gcmVxdWlyZSgnZXZlbnRzJykuRXZlbnRFbWl0dGVyO1xuXG51dGlscy5pbmhlcml0cyhTeW5jLCBFRSk7XG5tb2R1bGUuZXhwb3J0cyA9IHN5bmM7XG5mdW5jdGlvbiBzeW5jKHNyYywgdGFyZ2V0LCBvcHRzLCBjYWxsYmFjaykge1xuICBpZiAodHlwZW9mIG9wdHMgPT09ICdmdW5jdGlvbicpIHtcbiAgICBjYWxsYmFjayA9IG9wdHM7XG4gICAgb3B0cyA9IHt9O1xuICB9XG4gIGlmICh0eXBlb2Ygb3B0cyA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBvcHRzID0ge307XG4gIH1cbiAgb3B0cyA9IHV0aWxzLmNsb25lKG9wdHMpO1xuICAvKmpzaGludCB2YWxpZHRoaXM6dHJ1ZSAqL1xuICBvcHRzLlBvdWNoQ29uc3RydWN0b3IgPSBvcHRzLlBvdWNoQ29uc3RydWN0b3IgfHwgdGhpcztcbiAgc3JjID0gcmVwbGljYXRpb24udG9Qb3VjaChzcmMsIG9wdHMpO1xuICB0YXJnZXQgPSByZXBsaWNhdGlvbi50b1BvdWNoKHRhcmdldCwgb3B0cyk7XG4gIHJldHVybiBuZXcgU3luYyhzcmMsIHRhcmdldCwgb3B0cywgY2FsbGJhY2spO1xufVxuXG5mdW5jdGlvbiBTeW5jKHNyYywgdGFyZ2V0LCBvcHRzLCBjYWxsYmFjaykge1xuICB2YXIgc2VsZiA9IHRoaXM7XG4gIHRoaXMuY2FuY2VsZWQgPSBmYWxzZTtcblxuICB2YXIgb25DaGFuZ2UsIGNvbXBsZXRlO1xuICBpZiAoJ29uQ2hhbmdlJyBpbiBvcHRzKSB7XG4gICAgb25DaGFuZ2UgPSBvcHRzLm9uQ2hhbmdlO1xuICAgIGRlbGV0ZSBvcHRzLm9uQ2hhbmdlO1xuICB9XG4gIGlmICh0eXBlb2YgY2FsbGJhY2sgPT09ICdmdW5jdGlvbicgJiYgIW9wdHMuY29tcGxldGUpIHtcbiAgICBjb21wbGV0ZSA9IGNhbGxiYWNrO1xuICB9IGVsc2UgaWYgKCdjb21wbGV0ZScgaW4gb3B0cykge1xuICAgIGNvbXBsZXRlID0gb3B0cy5jb21wbGV0ZTtcbiAgICBkZWxldGUgb3B0cy5jb21wbGV0ZTtcbiAgfVxuXG4gIHRoaXMucHVzaCA9IHJlcGxpY2F0ZShzcmMsIHRhcmdldCwgb3B0cyk7XG4gIHRoaXMucHVsbCA9IHJlcGxpY2F0ZSh0YXJnZXQsIHNyYywgb3B0cyk7XG5cbiAgdmFyIGVtaXR0ZWRDYW5jZWwgPSBmYWxzZTtcbiAgZnVuY3Rpb24gb25DYW5jZWwoZGF0YSkge1xuICAgIGlmICghZW1pdHRlZENhbmNlbCkge1xuICAgICAgZW1pdHRlZENhbmNlbCA9IHRydWU7XG4gICAgICBzZWxmLmVtaXQoJ2NhbmNlbCcsIGRhdGEpO1xuICAgIH1cbiAgfVxuICBmdW5jdGlvbiBwdWxsQ2hhbmdlKGNoYW5nZSkge1xuICAgIHNlbGYuZW1pdCgnY2hhbmdlJywge1xuICAgICAgZGlyZWN0aW9uOiAncHVsbCcsXG4gICAgICBjaGFuZ2U6IGNoYW5nZVxuICAgIH0pO1xuICB9XG4gIGZ1bmN0aW9uIHB1c2hDaGFuZ2UoY2hhbmdlKSB7XG4gICAgc2VsZi5lbWl0KCdjaGFuZ2UnLCB7XG4gICAgICBkaXJlY3Rpb246ICdwdXNoJyxcbiAgICAgIGNoYW5nZTogY2hhbmdlXG4gICAgfSk7XG4gIH1cbiAgZnVuY3Rpb24gcHVzaERlbmllZChkb2MpIHtcbiAgICBzZWxmLmVtaXQoJ2RlbmllZCcsIHtcbiAgICAgIGRpcmVjdGlvbjogJ3B1c2gnLFxuICAgICAgZG9jOiBkb2NcbiAgICB9KTtcbiAgfVxuICBmdW5jdGlvbiBwdWxsRGVuaWVkKGRvYykge1xuICAgIHNlbGYuZW1pdCgnZGVuaWVkJywge1xuICAgICAgZGlyZWN0aW9uOiAncHVsbCcsXG4gICAgICBkb2M6IGRvY1xuICAgIH0pO1xuICB9XG5cbiAgdmFyIGxpc3RlbmVycyA9IHt9O1xuICB2YXIgcmVtb3ZlZCA9IHt9O1xuXG4gIGZ1bmN0aW9uIHJlbW92ZUFsbCh0eXBlKSB7IC8vIHR5cGUgaXMgJ3B1c2gnIG9yICdwdWxsJ1xuICAgIHJldHVybiBmdW5jdGlvbiAoZXZlbnQsIGZ1bmMpIHtcbiAgICAgIHZhciBpc0NoYW5nZSA9IGV2ZW50ID09PSAnY2hhbmdlJyAmJlxuICAgICAgICAoZnVuYyA9PT0gcHVsbENoYW5nZSB8fCBmdW5jID09PSBwdXNoQ2hhbmdlKTtcbiAgICAgIHZhciBpc0NhbmNlbCA9IGV2ZW50ID09PSAnY2FuY2VsJyAmJiBmdW5jID09PSBvbkNhbmNlbDtcbiAgICAgIHZhciBpc090aGVyRXZlbnQgPSBldmVudCBpbiBsaXN0ZW5lcnMgJiYgZnVuYyA9PT0gbGlzdGVuZXJzW2V2ZW50XTtcblxuICAgICAgaWYgKGlzQ2hhbmdlIHx8IGlzQ2FuY2VsIHx8IGlzT3RoZXJFdmVudCkge1xuICAgICAgICBpZiAoIShldmVudCBpbiByZW1vdmVkKSkge1xuICAgICAgICAgIHJlbW92ZWRbZXZlbnRdID0ge307XG4gICAgICAgIH1cbiAgICAgICAgcmVtb3ZlZFtldmVudF1bdHlwZV0gPSB0cnVlO1xuICAgICAgICBpZiAoT2JqZWN0LmtleXMocmVtb3ZlZFtldmVudF0pLmxlbmd0aCA9PT0gMikge1xuICAgICAgICAgIC8vIGJvdGggcHVzaCBhbmQgcHVsbCBoYXZlIGFza2VkIHRvIGJlIHJlbW92ZWRcbiAgICAgICAgICBzZWxmLnJlbW92ZUFsbExpc3RlbmVycyhldmVudCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9O1xuICB9XG5cbiAgaWYgKG9wdHMubGl2ZSkge1xuICAgIHRoaXMucHVzaC5vbignY29tcGxldGUnLCBzZWxmLnB1bGwuY2FuY2VsLmJpbmQoc2VsZi5wdWxsKSk7XG4gICAgdGhpcy5wdWxsLm9uKCdjb21wbGV0ZScsIHNlbGYucHVzaC5jYW5jZWwuYmluZChzZWxmLnB1c2gpKTtcbiAgfVxuXG4gIHRoaXMub24oJ25ld0xpc3RlbmVyJywgZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgaWYgKGV2ZW50ID09PSAnY2hhbmdlJykge1xuICAgICAgc2VsZi5wdWxsLm9uKCdjaGFuZ2UnLCBwdWxsQ2hhbmdlKTtcbiAgICAgIHNlbGYucHVzaC5vbignY2hhbmdlJywgcHVzaENoYW5nZSk7XG4gICAgfSBlbHNlIGlmIChldmVudCA9PT0gJ2RlbmllZCcpIHtcbiAgICAgIHNlbGYucHVsbC5vbignZGVuaWVkJywgcHVsbERlbmllZCk7XG4gICAgICBzZWxmLnB1c2gub24oJ2RlbmllZCcsIHB1c2hEZW5pZWQpO1xuICAgIH0gZWxzZSBpZiAoZXZlbnQgPT09ICdjYW5jZWwnKSB7XG4gICAgICBzZWxmLnB1bGwub24oJ2NhbmNlbCcsIG9uQ2FuY2VsKTtcbiAgICAgIHNlbGYucHVzaC5vbignY2FuY2VsJywgb25DYW5jZWwpO1xuICAgIH0gZWxzZSBpZiAoZXZlbnQgIT09ICdlcnJvcicgJiZcbiAgICAgIGV2ZW50ICE9PSAncmVtb3ZlTGlzdGVuZXInICYmXG4gICAgICBldmVudCAhPT0gJ2NvbXBsZXRlJyAmJiAhKGV2ZW50IGluIGxpc3RlbmVycykpIHtcbiAgICAgIGxpc3RlbmVyc1tldmVudF0gPSBmdW5jdGlvbiAoZSkge1xuICAgICAgICBzZWxmLmVtaXQoZXZlbnQsIGUpO1xuICAgICAgfTtcbiAgICAgIHNlbGYucHVsbC5vbihldmVudCwgbGlzdGVuZXJzW2V2ZW50XSk7XG4gICAgICBzZWxmLnB1c2gub24oZXZlbnQsIGxpc3RlbmVyc1tldmVudF0pO1xuICAgIH1cbiAgfSk7XG5cbiAgdGhpcy5vbigncmVtb3ZlTGlzdGVuZXInLCBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICBpZiAoZXZlbnQgPT09ICdjaGFuZ2UnKSB7XG4gICAgICBzZWxmLnB1bGwucmVtb3ZlTGlzdGVuZXIoJ2NoYW5nZScsIHB1bGxDaGFuZ2UpO1xuICAgICAgc2VsZi5wdXNoLnJlbW92ZUxpc3RlbmVyKCdjaGFuZ2UnLCBwdXNoQ2hhbmdlKTtcbiAgICB9IGVsc2UgaWYgKGV2ZW50ID09PSAnY2FuY2VsJykge1xuICAgICAgc2VsZi5wdWxsLnJlbW92ZUxpc3RlbmVyKCdjYW5jZWwnLCBvbkNhbmNlbCk7XG4gICAgICBzZWxmLnB1c2gucmVtb3ZlTGlzdGVuZXIoJ2NhbmNlbCcsIG9uQ2FuY2VsKTtcbiAgICB9IGVsc2UgaWYgKGV2ZW50IGluIGxpc3RlbmVycykge1xuICAgICAgaWYgKHR5cGVvZiBsaXN0ZW5lcnNbZXZlbnRdID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIHNlbGYucHVsbC5yZW1vdmVMaXN0ZW5lcihldmVudCwgbGlzdGVuZXJzW2V2ZW50XSk7XG4gICAgICAgIHNlbGYucHVzaC5yZW1vdmVMaXN0ZW5lcihldmVudCwgbGlzdGVuZXJzW2V2ZW50XSk7XG4gICAgICAgIGRlbGV0ZSBsaXN0ZW5lcnNbZXZlbnRdO1xuICAgICAgfVxuICAgIH1cbiAgfSk7XG5cbiAgdGhpcy5wdWxsLm9uKCdyZW1vdmVMaXN0ZW5lcicsIHJlbW92ZUFsbCgncHVsbCcpKTtcbiAgdGhpcy5wdXNoLm9uKCdyZW1vdmVMaXN0ZW5lcicsIHJlbW92ZUFsbCgncHVzaCcpKTtcblxuICB2YXIgcHJvbWlzZSA9IHV0aWxzLlByb21pc2UuYWxsKFtcbiAgICB0aGlzLnB1c2gsXG4gICAgdGhpcy5wdWxsXG4gIF0pLnRoZW4oZnVuY3Rpb24gKHJlc3ApIHtcbiAgICB2YXIgb3V0ID0ge1xuICAgICAgcHVzaDogcmVzcFswXSxcbiAgICAgIHB1bGw6IHJlc3BbMV1cbiAgICB9O1xuICAgIHNlbGYuZW1pdCgnY29tcGxldGUnLCBvdXQpO1xuICAgIGlmIChjb21wbGV0ZSkge1xuICAgICAgY29tcGxldGUobnVsbCwgb3V0KTtcbiAgICB9XG4gICAgc2VsZi5yZW1vdmVBbGxMaXN0ZW5lcnMoKTtcbiAgICByZXR1cm4gb3V0O1xuICB9LCBmdW5jdGlvbiAoZXJyKSB7XG4gICAgc2VsZi5jYW5jZWwoKTtcbiAgICBzZWxmLmVtaXQoJ2Vycm9yJywgZXJyKTtcbiAgICBpZiAoY29tcGxldGUpIHtcbiAgICAgIGNvbXBsZXRlKGVycik7XG4gICAgfVxuICAgIHNlbGYucmVtb3ZlQWxsTGlzdGVuZXJzKCk7XG4gICAgdGhyb3cgZXJyO1xuICB9KTtcblxuICB0aGlzLnRoZW4gPSBmdW5jdGlvbiAoc3VjY2VzcywgZXJyKSB7XG4gICAgcmV0dXJuIHByb21pc2UudGhlbihzdWNjZXNzLCBlcnIpO1xuICB9O1xuXG4gIHRoaXNbXCJjYXRjaFwiXSA9IGZ1bmN0aW9uIChlcnIpIHtcbiAgICByZXR1cm4gcHJvbWlzZVtcImNhdGNoXCJdKGVycik7XG4gIH07XG59XG5cblN5bmMucHJvdG90eXBlLmNhbmNlbCA9IGZ1bmN0aW9uICgpIHtcbiAgaWYgKCF0aGlzLmNhbmNlbGVkKSB7XG4gICAgdGhpcy5jYW5jZWxlZCA9IHRydWU7XG4gICAgdGhpcy5wdXNoLmNhbmNlbCgpO1xuICAgIHRoaXMucHVsbC5jYW5jZWwoKTtcbiAgfVxufTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSBUYXNrUXVldWU7XG5cbmZ1bmN0aW9uIFRhc2tRdWV1ZSgpIHtcbiAgdGhpcy5pc1JlYWR5ID0gZmFsc2U7XG4gIHRoaXMuZmFpbGVkID0gZmFsc2U7XG4gIHRoaXMucXVldWUgPSBbXTtcbn1cblxuVGFza1F1ZXVlLnByb3RvdHlwZS5leGVjdXRlID0gZnVuY3Rpb24gKCkge1xuICB2YXIgZCwgZnVuYztcbiAgaWYgKHRoaXMuZmFpbGVkKSB7XG4gICAgd2hpbGUgKChkID0gdGhpcy5xdWV1ZS5zaGlmdCgpKSkge1xuICAgICAgaWYgKHR5cGVvZiBkID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIGQodGhpcy5mYWlsZWQpO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGZ1bmMgPSBkLnBhcmFtZXRlcnNbZC5wYXJhbWV0ZXJzLmxlbmd0aCAtIDFdO1xuICAgICAgaWYgKHR5cGVvZiBmdW5jID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIGZ1bmModGhpcy5mYWlsZWQpO1xuICAgICAgfSBlbHNlIGlmIChkLm5hbWUgPT09ICdjaGFuZ2VzJyAmJiB0eXBlb2YgZnVuYy5jb21wbGV0ZSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICBmdW5jLmNvbXBsZXRlKHRoaXMuZmFpbGVkKTtcbiAgICAgIH1cbiAgICB9XG4gIH0gZWxzZSBpZiAodGhpcy5pc1JlYWR5KSB7XG4gICAgd2hpbGUgKChkID0gdGhpcy5xdWV1ZS5zaGlmdCgpKSkge1xuXG4gICAgICBpZiAodHlwZW9mIGQgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgZCgpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZC50YXNrID0gdGhpcy5kYltkLm5hbWVdLmFwcGx5KHRoaXMuZGIsIGQucGFyYW1ldGVycyk7XG4gICAgICB9XG4gICAgfVxuICB9XG59O1xuXG5UYXNrUXVldWUucHJvdG90eXBlLmZhaWwgPSBmdW5jdGlvbiAoZXJyKSB7XG4gIHRoaXMuZmFpbGVkID0gZXJyO1xuICB0aGlzLmV4ZWN1dGUoKTtcbn07XG5cblRhc2tRdWV1ZS5wcm90b3R5cGUucmVhZHkgPSBmdW5jdGlvbiAoZGIpIHtcbiAgaWYgKHRoaXMuZmFpbGVkKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9IGVsc2UgaWYgKGFyZ3VtZW50cy5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm4gdGhpcy5pc1JlYWR5O1xuICB9XG4gIHRoaXMuaXNSZWFkeSA9IGRiID8gdHJ1ZTogZmFsc2U7XG4gIHRoaXMuZGIgPSBkYjtcbiAgdGhpcy5leGVjdXRlKCk7XG59O1xuXG5UYXNrUXVldWUucHJvdG90eXBlLmFkZFRhc2sgPSBmdW5jdGlvbiAobmFtZSwgcGFyYW1ldGVycykge1xuICBpZiAodHlwZW9mIG5hbWUgPT09ICdmdW5jdGlvbicpIHtcbiAgICB0aGlzLnF1ZXVlLnB1c2gobmFtZSk7XG4gICAgaWYgKHRoaXMuZmFpbGVkKSB7XG4gICAgICB0aGlzLmV4ZWN1dGUoKTtcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgdmFyIHRhc2sgPSB7IG5hbWU6IG5hbWUsIHBhcmFtZXRlcnM6IHBhcmFtZXRlcnMgfTtcbiAgICB0aGlzLnF1ZXVlLnB1c2godGFzayk7XG4gICAgaWYgKHRoaXMuZmFpbGVkKSB7XG4gICAgICB0aGlzLmV4ZWN1dGUoKTtcbiAgICB9XG4gICAgcmV0dXJuIHRhc2s7XG4gIH1cbn07XG4iLCIvKmpzaGludCBzdHJpY3Q6IGZhbHNlICovXG4vKmdsb2JhbCBjaHJvbWUgKi9cbnZhciBtZXJnZSA9IHJlcXVpcmUoJy4vbWVyZ2UnKTtcbmV4cG9ydHMuZXh0ZW5kID0gcmVxdWlyZSgncG91Y2hkYi1leHRlbmQnKTtcbmV4cG9ydHMuYWpheCA9IHJlcXVpcmUoJy4vZGVwcy9hamF4Jyk7XG5leHBvcnRzLmNyZWF0ZUJsb2IgPSByZXF1aXJlKCcuL2RlcHMvYmxvYicpO1xuZXhwb3J0cy51dWlkID0gcmVxdWlyZSgnLi9kZXBzL3V1aWQnKTtcbmV4cG9ydHMuZ2V0QXJndW1lbnRzID0gcmVxdWlyZSgnYXJnc2FycmF5Jyk7XG52YXIgYnVmZmVyID0gcmVxdWlyZSgnLi9kZXBzL2J1ZmZlcicpO1xudmFyIGVycm9ycyA9IHJlcXVpcmUoJy4vZGVwcy9lcnJvcnMnKTtcbnZhciBFdmVudEVtaXR0ZXIgPSByZXF1aXJlKCdldmVudHMnKS5FdmVudEVtaXR0ZXI7XG52YXIgY29sbGVjdGlvbnMgPSByZXF1aXJlKCdwb3VjaGRiLWNvbGxlY3Rpb25zJyk7XG5leHBvcnRzLk1hcCA9IGNvbGxlY3Rpb25zLk1hcDtcbmV4cG9ydHMuU2V0ID0gY29sbGVjdGlvbnMuU2V0O1xudmFyIHBhcnNlRG9jID0gcmVxdWlyZSgnLi9kZXBzL3BhcnNlLWRvYycpO1xuXG5pZiAodHlwZW9mIGdsb2JhbC5Qcm9taXNlID09PSAnZnVuY3Rpb24nKSB7XG4gIGV4cG9ydHMuUHJvbWlzZSA9IGdsb2JhbC5Qcm9taXNlO1xufSBlbHNlIHtcbiAgZXhwb3J0cy5Qcm9taXNlID0gcmVxdWlyZSgnYmx1ZWJpcmQnKTtcbn1cbnZhciBQcm9taXNlID0gZXhwb3J0cy5Qcm9taXNlO1xuXG5leHBvcnRzLmxhc3RJbmRleE9mID0gZnVuY3Rpb24gKHN0ciwgY2hhcikge1xuICBmb3IgKHZhciBpID0gc3RyLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7XG4gICAgaWYgKHN0ci5jaGFyQXQoaSkgPT09IGNoYXIpIHtcbiAgICAgIHJldHVybiBpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gLTE7XG59O1xuXG5leHBvcnRzLmNsb25lID0gZnVuY3Rpb24gKG9iaikge1xuICByZXR1cm4gZXhwb3J0cy5leHRlbmQodHJ1ZSwge30sIG9iaik7XG59O1xuXG4vLyBsaWtlIHVuZGVyc2NvcmUvbG9kYXNoIF8ucGljaygpXG5leHBvcnRzLnBpY2sgPSBmdW5jdGlvbiAob2JqLCBhcnIpIHtcbiAgdmFyIHJlcyA9IHt9O1xuICBmb3IgKHZhciBpID0gMCwgbGVuID0gYXJyLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgdmFyIHByb3AgPSBhcnJbaV07XG4gICAgcmVzW3Byb3BdID0gb2JqW3Byb3BdO1xuICB9XG4gIHJldHVybiByZXM7XG59O1xuXG5leHBvcnRzLmluaGVyaXRzID0gcmVxdWlyZSgnaW5oZXJpdHMnKTtcblxuZnVuY3Rpb24gaXNDaHJvbWVBcHAoKSB7XG4gIHJldHVybiAodHlwZW9mIGNocm9tZSAhPT0gXCJ1bmRlZmluZWRcIiAmJlxuICAgICAgICAgIHR5cGVvZiBjaHJvbWUuc3RvcmFnZSAhPT0gXCJ1bmRlZmluZWRcIiAmJlxuICAgICAgICAgIHR5cGVvZiBjaHJvbWUuc3RvcmFnZS5sb2NhbCAhPT0gXCJ1bmRlZmluZWRcIik7XG59XG5cbi8vIFByZXR0eSBkdW1iIG5hbWUgZm9yIGEgZnVuY3Rpb24sIGp1c3Qgd3JhcHMgY2FsbGJhY2sgY2FsbHMgc28gd2UgZG9udFxuLy8gdG8gaWYgKGNhbGxiYWNrKSBjYWxsYmFjaygpIGV2ZXJ5d2hlcmVcbmV4cG9ydHMuY2FsbCA9IGV4cG9ydHMuZ2V0QXJndW1lbnRzKGZ1bmN0aW9uIChhcmdzKSB7XG4gIGlmICghYXJncy5sZW5ndGgpIHtcbiAgICByZXR1cm47XG4gIH1cbiAgdmFyIGZ1biA9IGFyZ3Muc2hpZnQoKTtcbiAgaWYgKHR5cGVvZiBmdW4gPT09ICdmdW5jdGlvbicpIHtcbiAgICBmdW4uYXBwbHkodGhpcywgYXJncyk7XG4gIH1cbn0pO1xuXG5leHBvcnRzLmlzTG9jYWxJZCA9IGZ1bmN0aW9uIChpZCkge1xuICByZXR1cm4gKC9eX2xvY2FsLykudGVzdChpZCk7XG59O1xuXG4vLyBjaGVjayBpZiBhIHNwZWNpZmljIHJldmlzaW9uIG9mIGEgZG9jIGhhcyBiZWVuIGRlbGV0ZWRcbi8vICAtIG1ldGFkYXRhOiB0aGUgbWV0YWRhdGEgb2JqZWN0IGZyb20gdGhlIGRvYyBzdG9yZVxuLy8gIC0gcmV2OiAob3B0aW9uYWwpIHRoZSByZXZpc2lvbiB0byBjaGVjay4gZGVmYXVsdHMgdG8gd2lubmluZyByZXZpc2lvblxuZXhwb3J0cy5pc0RlbGV0ZWQgPSBmdW5jdGlvbiAobWV0YWRhdGEsIHJldikge1xuICBpZiAoIXJldikge1xuICAgIHJldiA9IG1lcmdlLndpbm5pbmdSZXYobWV0YWRhdGEpO1xuICB9XG4gIHZhciBkYXNoSW5kZXggPSByZXYuaW5kZXhPZignLScpO1xuICBpZiAoZGFzaEluZGV4ICE9PSAtMSkge1xuICAgIHJldiA9IHJldi5zdWJzdHJpbmcoZGFzaEluZGV4ICsgMSk7XG4gIH1cbiAgdmFyIGRlbGV0ZWQgPSBmYWxzZTtcbiAgbWVyZ2UudHJhdmVyc2VSZXZUcmVlKG1ldGFkYXRhLnJldl90cmVlLFxuICBmdW5jdGlvbiAoaXNMZWFmLCBwb3MsIGlkLCBhY2MsIG9wdHMpIHtcbiAgICBpZiAoaWQgPT09IHJldikge1xuICAgICAgZGVsZXRlZCA9ICEhb3B0cy5kZWxldGVkO1xuICAgIH1cbiAgfSk7XG5cbiAgcmV0dXJuIGRlbGV0ZWQ7XG59O1xuXG5leHBvcnRzLnJldkV4aXN0cyA9IGZ1bmN0aW9uIChtZXRhZGF0YSwgcmV2KSB7XG4gIHZhciBmb3VuZCA9IGZhbHNlO1xuICBtZXJnZS50cmF2ZXJzZVJldlRyZWUobWV0YWRhdGEucmV2X3RyZWUsIGZ1bmN0aW9uIChsZWFmLCBwb3MsIGlkKSB7XG4gICAgaWYgKChwb3MgKyAnLScgKyBpZCkgPT09IHJldikge1xuICAgICAgZm91bmQgPSB0cnVlO1xuICAgIH1cbiAgfSk7XG4gIHJldHVybiBmb3VuZDtcbn07XG5cbmV4cG9ydHMuZmlsdGVyQ2hhbmdlID0gZnVuY3Rpb24gZmlsdGVyQ2hhbmdlKG9wdHMpIHtcbiAgdmFyIHJlcSA9IHt9O1xuICB2YXIgaGFzRmlsdGVyID0gb3B0cy5maWx0ZXIgJiYgdHlwZW9mIG9wdHMuZmlsdGVyID09PSAnZnVuY3Rpb24nO1xuICByZXEucXVlcnkgPSBvcHRzLnF1ZXJ5X3BhcmFtcztcblxuICByZXR1cm4gZnVuY3Rpb24gZmlsdGVyKGNoYW5nZSkge1xuICAgIGlmICghY2hhbmdlLmRvYykge1xuICAgICAgLy8gQ1NHIHNlbmRzIGV2ZW50cyBvbiB0aGUgY2hhbmdlcyBmZWVkIHRoYXQgZG9uJ3QgaGF2ZSBkb2N1bWVudHMsXG4gICAgICAvLyB0aGlzIGhhY2sgbWFrZXMgYSB3aG9sZSBsb3Qgb2YgZXhpc3RpbmcgY29kZSByb2J1c3QuXG4gICAgICBjaGFuZ2UuZG9jID0ge307XG4gICAgfVxuICAgIGlmIChvcHRzLmZpbHRlciAmJiBoYXNGaWx0ZXIgJiYgIW9wdHMuZmlsdGVyLmNhbGwodGhpcywgY2hhbmdlLmRvYywgcmVxKSkge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICBpZiAoIW9wdHMuaW5jbHVkZV9kb2NzKSB7XG4gICAgICBkZWxldGUgY2hhbmdlLmRvYztcbiAgICB9IGVsc2UgaWYgKCFvcHRzLmF0dGFjaG1lbnRzKSB7XG4gICAgICBmb3IgKHZhciBhdHQgaW4gY2hhbmdlLmRvYy5fYXR0YWNobWVudHMpIHtcbiAgICAgICAgaWYgKGNoYW5nZS5kb2MuX2F0dGFjaG1lbnRzLmhhc093blByb3BlcnR5KGF0dCkpIHtcbiAgICAgICAgICBjaGFuZ2UuZG9jLl9hdHRhY2htZW50c1thdHRdLnN0dWIgPSB0cnVlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiB0cnVlO1xuICB9O1xufTtcblxuZXhwb3J0cy5wYXJzZURvYyA9IHBhcnNlRG9jLnBhcnNlRG9jO1xuZXhwb3J0cy5pbnZhbGlkSWRFcnJvciA9IHBhcnNlRG9jLmludmFsaWRJZEVycm9yO1xuXG5leHBvcnRzLmlzQ29yZG92YSA9IGZ1bmN0aW9uICgpIHtcbiAgcmV0dXJuICh0eXBlb2YgY29yZG92YSAhPT0gXCJ1bmRlZmluZWRcIiB8fFxuICAgICAgICAgIHR5cGVvZiBQaG9uZUdhcCAhPT0gXCJ1bmRlZmluZWRcIiB8fFxuICAgICAgICAgIHR5cGVvZiBwaG9uZWdhcCAhPT0gXCJ1bmRlZmluZWRcIik7XG59O1xuXG5leHBvcnRzLmhhc0xvY2FsU3RvcmFnZSA9IGZ1bmN0aW9uICgpIHtcbiAgaWYgKGlzQ2hyb21lQXBwKCkpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgdHJ5IHtcbiAgICByZXR1cm4gbG9jYWxTdG9yYWdlO1xuICB9IGNhdGNoIChlKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59O1xuZXhwb3J0cy5DaGFuZ2VzID0gQ2hhbmdlcztcbmV4cG9ydHMuaW5oZXJpdHMoQ2hhbmdlcywgRXZlbnRFbWl0dGVyKTtcbmZ1bmN0aW9uIENoYW5nZXMoKSB7XG4gIGlmICghKHRoaXMgaW5zdGFuY2VvZiBDaGFuZ2VzKSkge1xuICAgIHJldHVybiBuZXcgQ2hhbmdlcygpO1xuICB9XG4gIHZhciBzZWxmID0gdGhpcztcbiAgRXZlbnRFbWl0dGVyLmNhbGwodGhpcyk7XG4gIHRoaXMuaXNDaHJvbWUgPSBpc0Nocm9tZUFwcCgpO1xuICB0aGlzLmxpc3RlbmVycyA9IHt9O1xuICB0aGlzLmhhc0xvY2FsID0gZmFsc2U7XG4gIGlmICghdGhpcy5pc0Nocm9tZSkge1xuICAgIHRoaXMuaGFzTG9jYWwgPSBleHBvcnRzLmhhc0xvY2FsU3RvcmFnZSgpO1xuICB9XG4gIGlmICh0aGlzLmlzQ2hyb21lKSB7XG4gICAgY2hyb21lLnN0b3JhZ2Uub25DaGFuZ2VkLmFkZExpc3RlbmVyKGZ1bmN0aW9uIChlKSB7XG4gICAgICAvLyBtYWtlIHN1cmUgaXQncyBldmVudCBhZGRyZXNzZWQgdG8gdXNcbiAgICAgIGlmIChlLmRiX25hbWUgIT0gbnVsbCkge1xuICAgICAgICAvL29iamVjdCBvbmx5IGhhcyBvbGRWYWx1ZSwgbmV3VmFsdWUgbWVtYmVyc1xuICAgICAgICBzZWxmLmVtaXQoZS5kYk5hbWUubmV3VmFsdWUpO1xuICAgICAgfVxuICAgIH0pO1xuICB9IGVsc2UgaWYgKHRoaXMuaGFzTG9jYWwpIHtcbiAgICBpZiAodHlwZW9mIGFkZEV2ZW50TGlzdGVuZXIgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICBhZGRFdmVudExpc3RlbmVyKFwic3RvcmFnZVwiLCBmdW5jdGlvbiAoZSkge1xuICAgICAgICBzZWxmLmVtaXQoZS5rZXkpO1xuICAgICAgfSk7XG4gICAgfSBlbHNlIHsgLy8gb2xkIElFXG4gICAgICB3aW5kb3cuYXR0YWNoRXZlbnQoXCJzdG9yYWdlXCIsIGZ1bmN0aW9uIChlKSB7XG4gICAgICAgIHNlbGYuZW1pdChlLmtleSk7XG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxufVxuQ2hhbmdlcy5wcm90b3R5cGUuYWRkTGlzdGVuZXIgPSBmdW5jdGlvbiAoZGJOYW1lLCBpZCwgZGIsIG9wdHMpIHtcbiAgaWYgKHRoaXMubGlzdGVuZXJzW2lkXSkge1xuICAgIHJldHVybjtcbiAgfVxuICB2YXIgc2VsZiA9IHRoaXM7XG4gIHZhciBpbnByb2dyZXNzID0gZmFsc2U7XG4gIGZ1bmN0aW9uIGV2ZW50RnVuY3Rpb24oKSB7XG4gICAgaWYgKCFzZWxmLmxpc3RlbmVyc1tpZF0pIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKGlucHJvZ3Jlc3MpIHtcbiAgICAgIGlucHJvZ3Jlc3MgPSAnd2FpdGluZyc7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlucHJvZ3Jlc3MgPSB0cnVlO1xuICAgIGRiLmNoYW5nZXMoe1xuICAgICAgc3R5bGU6IG9wdHMuc3R5bGUsXG4gICAgICBpbmNsdWRlX2RvY3M6IG9wdHMuaW5jbHVkZV9kb2NzLFxuICAgICAgYXR0YWNobWVudHM6IG9wdHMuYXR0YWNobWVudHMsXG4gICAgICBjb25mbGljdHM6IG9wdHMuY29uZmxpY3RzLFxuICAgICAgY29udGludW91czogZmFsc2UsXG4gICAgICBkZXNjZW5kaW5nOiBmYWxzZSxcbiAgICAgIGZpbHRlcjogb3B0cy5maWx0ZXIsXG4gICAgICBkb2NfaWRzOiBvcHRzLmRvY19pZHMsXG4gICAgICB2aWV3OiBvcHRzLnZpZXcsXG4gICAgICBzaW5jZTogb3B0cy5zaW5jZSxcbiAgICAgIHF1ZXJ5X3BhcmFtczogb3B0cy5xdWVyeV9wYXJhbXNcbiAgICB9KS5vbignY2hhbmdlJywgZnVuY3Rpb24gKGMpIHtcbiAgICAgIGlmIChjLnNlcSA+IG9wdHMuc2luY2UgJiYgIW9wdHMuY2FuY2VsbGVkKSB7XG4gICAgICAgIG9wdHMuc2luY2UgPSBjLnNlcTtcbiAgICAgICAgZXhwb3J0cy5jYWxsKG9wdHMub25DaGFuZ2UsIGMpO1xuICAgICAgfVxuICAgIH0pLm9uKCdjb21wbGV0ZScsIGZ1bmN0aW9uICgpIHtcbiAgICAgIGlmIChpbnByb2dyZXNzID09PSAnd2FpdGluZycpIHtcbiAgICAgICAgcHJvY2Vzcy5uZXh0VGljayhmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgc2VsZi5ub3RpZnkoZGJOYW1lKTtcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgICBpbnByb2dyZXNzID0gZmFsc2U7XG4gICAgfSkub24oJ2Vycm9yJywgZnVuY3Rpb24gKCkge1xuICAgICAgaW5wcm9ncmVzcyA9IGZhbHNlO1xuICAgIH0pO1xuICB9XG4gIHRoaXMubGlzdGVuZXJzW2lkXSA9IGV2ZW50RnVuY3Rpb247XG4gIHRoaXMub24oZGJOYW1lLCBldmVudEZ1bmN0aW9uKTtcbn07XG5cbkNoYW5nZXMucHJvdG90eXBlLnJlbW92ZUxpc3RlbmVyID0gZnVuY3Rpb24gKGRiTmFtZSwgaWQpIHtcbiAgaWYgKCEoaWQgaW4gdGhpcy5saXN0ZW5lcnMpKSB7XG4gICAgcmV0dXJuO1xuICB9XG4gIEV2ZW50RW1pdHRlci5wcm90b3R5cGUucmVtb3ZlTGlzdGVuZXIuY2FsbCh0aGlzLCBkYk5hbWUsXG4gICAgdGhpcy5saXN0ZW5lcnNbaWRdKTtcbn07XG5cblxuQ2hhbmdlcy5wcm90b3R5cGUubm90aWZ5TG9jYWxXaW5kb3dzID0gZnVuY3Rpb24gKGRiTmFtZSkge1xuICAvL2RvIGEgdXNlbGVzcyBjaGFuZ2Ugb24gYSBzdG9yYWdlIHRoaW5nXG4gIC8vaW4gb3JkZXIgdG8gZ2V0IG90aGVyIHdpbmRvd3MncyBsaXN0ZW5lcnMgdG8gYWN0aXZhdGVcbiAgaWYgKHRoaXMuaXNDaHJvbWUpIHtcbiAgICBjaHJvbWUuc3RvcmFnZS5sb2NhbC5zZXQoe2RiTmFtZTogZGJOYW1lfSk7XG4gIH0gZWxzZSBpZiAodGhpcy5oYXNMb2NhbCkge1xuICAgIGxvY2FsU3RvcmFnZVtkYk5hbWVdID0gKGxvY2FsU3RvcmFnZVtkYk5hbWVdID09PSBcImFcIikgPyBcImJcIiA6IFwiYVwiO1xuICB9XG59O1xuXG5DaGFuZ2VzLnByb3RvdHlwZS5ub3RpZnkgPSBmdW5jdGlvbiAoZGJOYW1lKSB7XG4gIHRoaXMuZW1pdChkYk5hbWUpO1xuICB0aGlzLm5vdGlmeUxvY2FsV2luZG93cyhkYk5hbWUpO1xufTtcblxuaWYgKHR5cGVvZiBhdG9iID09PSAnZnVuY3Rpb24nKSB7XG4gIGV4cG9ydHMuYXRvYiA9IGZ1bmN0aW9uIChzdHIpIHtcbiAgICByZXR1cm4gYXRvYihzdHIpO1xuICB9O1xufSBlbHNlIHtcbiAgZXhwb3J0cy5hdG9iID0gZnVuY3Rpb24gKHN0cikge1xuICAgIHZhciBiYXNlNjQgPSBuZXcgYnVmZmVyKHN0ciwgJ2Jhc2U2NCcpO1xuICAgIC8vIE5vZGUuanMgd2lsbCBqdXN0IHNraXAgdGhlIGNoYXJhY3RlcnMgaXQgY2FuJ3QgZW5jb2RlIGluc3RlYWQgb2ZcbiAgICAvLyB0aHJvd2luZyBhbmQgZXhjZXB0aW9uXG4gICAgaWYgKGJhc2U2NC50b1N0cmluZygnYmFzZTY0JykgIT09IHN0cikge1xuICAgICAgdGhyb3cgKFwiQ2Fubm90IGJhc2U2NCBlbmNvZGUgZnVsbCBzdHJpbmdcIik7XG4gICAgfVxuICAgIHJldHVybiBiYXNlNjQudG9TdHJpbmcoJ2JpbmFyeScpO1xuICB9O1xufVxuXG5pZiAodHlwZW9mIGJ0b2EgPT09ICdmdW5jdGlvbicpIHtcbiAgZXhwb3J0cy5idG9hID0gZnVuY3Rpb24gKHN0cikge1xuICAgIHJldHVybiBidG9hKHN0cik7XG4gIH07XG59IGVsc2Uge1xuICBleHBvcnRzLmJ0b2EgPSBmdW5jdGlvbiAoc3RyKSB7XG4gICAgcmV0dXJuIG5ldyBidWZmZXIoc3RyLCAnYmluYXJ5JykudG9TdHJpbmcoJ2Jhc2U2NCcpO1xuICB9O1xufVxuXG4vLyBGcm9tIGh0dHA6Ly9zdGFja292ZXJmbG93LmNvbS9xdWVzdGlvbnMvMTQ5Njc2NDcvIChjb250aW51ZXMgb24gbmV4dCBsaW5lKVxuLy8gZW5jb2RlLWRlY29kZS1pbWFnZS13aXRoLWJhc2U2NC1icmVha3MtaW1hZ2UgKDIwMTMtMDQtMjEpXG5leHBvcnRzLmZpeEJpbmFyeSA9IGZ1bmN0aW9uIChiaW4pIHtcbiAgaWYgKCFwcm9jZXNzLmJyb3dzZXIpIHtcbiAgICAvLyBkb24ndCBuZWVkIHRvIGRvIHRoaXMgaW4gTm9kZVxuICAgIHJldHVybiBiaW47XG4gIH1cblxuICB2YXIgbGVuZ3RoID0gYmluLmxlbmd0aDtcbiAgdmFyIGJ1ZiA9IG5ldyBBcnJheUJ1ZmZlcihsZW5ndGgpO1xuICB2YXIgYXJyID0gbmV3IFVpbnQ4QXJyYXkoYnVmKTtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgIGFycltpXSA9IGJpbi5jaGFyQ29kZUF0KGkpO1xuICB9XG4gIHJldHVybiBidWY7XG59O1xuXG4vLyBzaGltIGZvciBicm93c2VycyB0aGF0IGRvbid0IHN1cHBvcnQgaXRcbmV4cG9ydHMucmVhZEFzQmluYXJ5U3RyaW5nID0gZnVuY3Rpb24gKGJsb2IsIGNhbGxiYWNrKSB7XG4gIHZhciByZWFkZXIgPSBuZXcgRmlsZVJlYWRlcigpO1xuICB2YXIgaGFzQmluYXJ5U3RyaW5nID0gdHlwZW9mIHJlYWRlci5yZWFkQXNCaW5hcnlTdHJpbmcgPT09ICdmdW5jdGlvbic7XG4gIHJlYWRlci5vbmxvYWRlbmQgPSBmdW5jdGlvbiAoZSkge1xuICAgIHZhciByZXN1bHQgPSBlLnRhcmdldC5yZXN1bHQgfHwgJyc7XG4gICAgaWYgKGhhc0JpbmFyeVN0cmluZykge1xuICAgICAgcmV0dXJuIGNhbGxiYWNrKHJlc3VsdCk7XG4gICAgfVxuICAgIGNhbGxiYWNrKGV4cG9ydHMuYXJyYXlCdWZmZXJUb0JpbmFyeVN0cmluZyhyZXN1bHQpKTtcbiAgfTtcbiAgaWYgKGhhc0JpbmFyeVN0cmluZykge1xuICAgIHJlYWRlci5yZWFkQXNCaW5hcnlTdHJpbmcoYmxvYik7XG4gIH0gZWxzZSB7XG4gICAgcmVhZGVyLnJlYWRBc0FycmF5QnVmZmVyKGJsb2IpO1xuICB9XG59O1xuXG4vLyBzaW1wbGlmaWVkIEFQSS4gdW5pdmVyc2FsIGJyb3dzZXIgc3VwcG9ydCBpcyBhc3N1bWVkXG5leHBvcnRzLnJlYWRBc0FycmF5QnVmZmVyID0gZnVuY3Rpb24gKGJsb2IsIGNhbGxiYWNrKSB7XG4gIHZhciByZWFkZXIgPSBuZXcgRmlsZVJlYWRlcigpO1xuICByZWFkZXIub25sb2FkZW5kID0gZnVuY3Rpb24gKGUpIHtcbiAgICB2YXIgcmVzdWx0ID0gZS50YXJnZXQucmVzdWx0IHx8IG5ldyBBcnJheUJ1ZmZlcigwKTtcbiAgICBjYWxsYmFjayhyZXN1bHQpO1xuICB9O1xuICByZWFkZXIucmVhZEFzQXJyYXlCdWZmZXIoYmxvYik7XG59O1xuXG5leHBvcnRzLm9uY2UgPSBmdW5jdGlvbiAoZnVuKSB7XG4gIHZhciBjYWxsZWQgPSBmYWxzZTtcbiAgcmV0dXJuIGV4cG9ydHMuZ2V0QXJndW1lbnRzKGZ1bmN0aW9uIChhcmdzKSB7XG4gICAgaWYgKGNhbGxlZCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdvbmNlIGNhbGxlZCAgbW9yZSB0aGFuIG9uY2UnKTtcbiAgICB9IGVsc2Uge1xuICAgICAgY2FsbGVkID0gdHJ1ZTtcbiAgICAgIGZ1bi5hcHBseSh0aGlzLCBhcmdzKTtcbiAgICB9XG4gIH0pO1xufTtcblxuZXhwb3J0cy50b1Byb21pc2UgPSBmdW5jdGlvbiAoZnVuYykge1xuICAvL2NyZWF0ZSB0aGUgZnVuY3Rpb24gd2Ugd2lsbCBiZSByZXR1cm5pbmdcbiAgcmV0dXJuIGV4cG9ydHMuZ2V0QXJndW1lbnRzKGZ1bmN0aW9uIChhcmdzKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHZhciB0ZW1wQ0IgPVxuICAgICAgKHR5cGVvZiBhcmdzW2FyZ3MubGVuZ3RoIC0gMV0gPT09ICdmdW5jdGlvbicpID8gYXJncy5wb3AoKSA6IGZhbHNlO1xuICAgIC8vIGlmIHRoZSBsYXN0IGFyZ3VtZW50IGlzIGEgZnVuY3Rpb24sIGFzc3VtZSBpdHMgYSBjYWxsYmFja1xuICAgIHZhciB1c2VkQ0I7XG4gICAgaWYgKHRlbXBDQikge1xuICAgICAgLy8gaWYgaXQgd2FzIGEgY2FsbGJhY2ssIGNyZWF0ZSBhIG5ldyBjYWxsYmFjayB3aGljaCBjYWxscyBpdCxcbiAgICAgIC8vIGJ1dCBkbyBzbyBhc3luYyBzbyB3ZSBkb24ndCB0cmFwIGFueSBlcnJvcnNcbiAgICAgIHVzZWRDQiA9IGZ1bmN0aW9uIChlcnIsIHJlc3ApIHtcbiAgICAgICAgcHJvY2Vzcy5uZXh0VGljayhmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgdGVtcENCKGVyciwgcmVzcCk7XG4gICAgICAgIH0pO1xuICAgICAgfTtcbiAgICB9XG4gICAgdmFyIHByb21pc2UgPSBuZXcgUHJvbWlzZShmdW5jdGlvbiAoZnVsZmlsbCwgcmVqZWN0KSB7XG4gICAgICB2YXIgcmVzcDtcbiAgICAgIHRyeSB7XG4gICAgICAgIHZhciBjYWxsYmFjayA9IGV4cG9ydHMub25jZShmdW5jdGlvbiAoZXJyLCBtZXNnKSB7XG4gICAgICAgICAgaWYgKGVycikge1xuICAgICAgICAgICAgcmVqZWN0KGVycik7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGZ1bGZpbGwobWVzZyk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgLy8gY3JlYXRlIGEgY2FsbGJhY2sgZm9yIHRoaXMgaW52b2NhdGlvblxuICAgICAgICAvLyBhcHBseSB0aGUgZnVuY3Rpb24gaW4gdGhlIG9yaWcgY29udGV4dFxuICAgICAgICBhcmdzLnB1c2goY2FsbGJhY2spO1xuICAgICAgICByZXNwID0gZnVuYy5hcHBseShzZWxmLCBhcmdzKTtcbiAgICAgICAgaWYgKHJlc3AgJiYgdHlwZW9mIHJlc3AudGhlbiA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgIGZ1bGZpbGwocmVzcCk7XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgcmVqZWN0KGUpO1xuICAgICAgfVxuICAgIH0pO1xuICAgIC8vIGlmIHRoZXJlIGlzIGEgY2FsbGJhY2ssIGNhbGwgaXQgYmFja1xuICAgIGlmICh1c2VkQ0IpIHtcbiAgICAgIHByb21pc2UudGhlbihmdW5jdGlvbiAocmVzdWx0KSB7XG4gICAgICAgIHVzZWRDQihudWxsLCByZXN1bHQpO1xuICAgICAgfSwgdXNlZENCKTtcbiAgICB9XG4gICAgcHJvbWlzZS5jYW5jZWwgPSBmdW5jdGlvbiAoKSB7XG4gICAgICByZXR1cm4gdGhpcztcbiAgICB9O1xuICAgIHJldHVybiBwcm9taXNlO1xuICB9KTtcbn07XG5cbmV4cG9ydHMuYWRhcHRlckZ1biA9IGZ1bmN0aW9uIChuYW1lLCBjYWxsYmFjaykge1xuICB2YXIgbG9nID0gcmVxdWlyZSgnZGVidWcnKSgncG91Y2hkYjphcGknKTtcblxuICBmdW5jdGlvbiBsb2dBcGlDYWxsKHNlbGYsIG5hbWUsIGFyZ3MpIHtcbiAgICBpZiAoIWxvZy5lbmFibGVkKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHZhciBsb2dBcmdzID0gW3NlbGYuX2RiX25hbWUsIG5hbWVdO1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgYXJncy5sZW5ndGggLSAxOyBpKyspIHtcbiAgICAgIGxvZ0FyZ3MucHVzaChhcmdzW2ldKTtcbiAgICB9XG4gICAgbG9nLmFwcGx5KG51bGwsIGxvZ0FyZ3MpO1xuXG4gICAgLy8gb3ZlcnJpZGUgdGhlIGNhbGxiYWNrIGl0c2VsZiB0byBsb2cgdGhlIHJlc3BvbnNlXG4gICAgdmFyIG9yaWdDYWxsYmFjayA9IGFyZ3NbYXJncy5sZW5ndGggLSAxXTtcbiAgICBhcmdzW2FyZ3MubGVuZ3RoIC0gMV0gPSBmdW5jdGlvbiAoZXJyLCByZXMpIHtcbiAgICAgIHZhciByZXNwb25zZUFyZ3MgPSBbc2VsZi5fZGJfbmFtZSwgbmFtZV07XG4gICAgICByZXNwb25zZUFyZ3MgPSByZXNwb25zZUFyZ3MuY29uY2F0KFxuICAgICAgICBlcnIgPyBbJ2Vycm9yJywgZXJyXSA6IFsnc3VjY2VzcycsIHJlc11cbiAgICAgICk7XG4gICAgICBsb2cuYXBwbHkobnVsbCwgcmVzcG9uc2VBcmdzKTtcbiAgICAgIG9yaWdDYWxsYmFjayhlcnIsIHJlcyk7XG4gICAgfTtcbiAgfVxuXG5cbiAgcmV0dXJuIGV4cG9ydHMudG9Qcm9taXNlKGV4cG9ydHMuZ2V0QXJndW1lbnRzKGZ1bmN0aW9uIChhcmdzKSB7XG4gICAgaWYgKHRoaXMuX2Nsb3NlZCkge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KG5ldyBFcnJvcignZGF0YWJhc2UgaXMgY2xvc2VkJykpO1xuICAgIH1cbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgbG9nQXBpQ2FsbChzZWxmLCBuYW1lLCBhcmdzKTtcbiAgICBpZiAoIXRoaXMudGFza3F1ZXVlLmlzUmVhZHkpIHtcbiAgICAgIHJldHVybiBuZXcgZXhwb3J0cy5Qcm9taXNlKGZ1bmN0aW9uIChmdWxmaWxsLCByZWplY3QpIHtcbiAgICAgICAgc2VsZi50YXNrcXVldWUuYWRkVGFzayhmdW5jdGlvbiAoZmFpbGVkKSB7XG4gICAgICAgICAgaWYgKGZhaWxlZCkge1xuICAgICAgICAgICAgcmVqZWN0KGZhaWxlZCk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGZ1bGZpbGwoc2VsZltuYW1lXS5hcHBseShzZWxmLCBhcmdzKSk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH1cbiAgICByZXR1cm4gY2FsbGJhY2suYXBwbHkodGhpcywgYXJncyk7XG4gIH0pKTtcbn07XG5cbi8vQ2FuJ3QgZmluZCBvcmlnaW5hbCBwb3N0LCBidXQgdGhpcyBpcyBjbG9zZVxuLy9odHRwOi8vc3RhY2tvdmVyZmxvdy5jb20vcXVlc3Rpb25zLzY5NjUxMDcvIChjb250aW51ZXMgb24gbmV4dCBsaW5lKVxuLy9jb252ZXJ0aW5nLWJldHdlZW4tc3RyaW5ncy1hbmQtYXJyYXlidWZmZXJzXG5leHBvcnRzLmFycmF5QnVmZmVyVG9CaW5hcnlTdHJpbmcgPSBmdW5jdGlvbiAoYnVmZmVyKSB7XG4gIHZhciBiaW5hcnkgPSBcIlwiO1xuICB2YXIgYnl0ZXMgPSBuZXcgVWludDhBcnJheShidWZmZXIpO1xuICB2YXIgbGVuZ3RoID0gYnl0ZXMuYnl0ZUxlbmd0aDtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgIGJpbmFyeSArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGJ5dGVzW2ldKTtcbiAgfVxuICByZXR1cm4gYmluYXJ5O1xufTtcblxuZXhwb3J0cy5jYW5jZWxsYWJsZUZ1biA9IGZ1bmN0aW9uIChmdW4sIHNlbGYsIG9wdHMpIHtcblxuICBvcHRzID0gb3B0cyA/IGV4cG9ydHMuY2xvbmUodHJ1ZSwge30sIG9wdHMpIDoge307XG5cbiAgdmFyIGVtaXR0ZXIgPSBuZXcgRXZlbnRFbWl0dGVyKCk7XG4gIHZhciBvbGRDb21wbGV0ZSA9IG9wdHMuY29tcGxldGUgfHwgZnVuY3Rpb24gKCkgeyB9O1xuICB2YXIgY29tcGxldGUgPSBvcHRzLmNvbXBsZXRlID0gZXhwb3J0cy5vbmNlKGZ1bmN0aW9uIChlcnIsIHJlc3ApIHtcbiAgICBpZiAoZXJyKSB7XG4gICAgICBvbGRDb21wbGV0ZShlcnIpO1xuICAgIH0gZWxzZSB7XG4gICAgICBlbWl0dGVyLmVtaXQoJ2VuZCcsIHJlc3ApO1xuICAgICAgb2xkQ29tcGxldGUobnVsbCwgcmVzcCk7XG4gICAgfVxuICAgIGVtaXR0ZXIucmVtb3ZlQWxsTGlzdGVuZXJzKCk7XG4gIH0pO1xuICB2YXIgb2xkT25DaGFuZ2UgPSBvcHRzLm9uQ2hhbmdlIHx8IGZ1bmN0aW9uICgpIHt9O1xuICB2YXIgbGFzdENoYW5nZSA9IDA7XG4gIHNlbGYub24oJ2Rlc3Ryb3llZCcsIGZ1bmN0aW9uICgpIHtcbiAgICBlbWl0dGVyLnJlbW92ZUFsbExpc3RlbmVycygpO1xuICB9KTtcbiAgb3B0cy5vbkNoYW5nZSA9IGZ1bmN0aW9uIChjaGFuZ2UpIHtcbiAgICBvbGRPbkNoYW5nZShjaGFuZ2UpO1xuICAgIGlmIChjaGFuZ2Uuc2VxIDw9IGxhc3RDaGFuZ2UpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgbGFzdENoYW5nZSA9IGNoYW5nZS5zZXE7XG4gICAgZW1pdHRlci5lbWl0KCdjaGFuZ2UnLCBjaGFuZ2UpO1xuICAgIGlmIChjaGFuZ2UuZGVsZXRlZCkge1xuICAgICAgZW1pdHRlci5lbWl0KCdkZWxldGUnLCBjaGFuZ2UpO1xuICAgIH0gZWxzZSBpZiAoY2hhbmdlLmNoYW5nZXMubGVuZ3RoID09PSAxICYmXG4gICAgICBjaGFuZ2UuY2hhbmdlc1swXS5yZXYuc2xpY2UoMCwgMSkgPT09ICcxLScpIHtcbiAgICAgIGVtaXR0ZXIuZW1pdCgnY3JlYXRlJywgY2hhbmdlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgZW1pdHRlci5lbWl0KCd1cGRhdGUnLCBjaGFuZ2UpO1xuICAgIH1cbiAgfTtcbiAgdmFyIHByb21pc2UgPSBuZXcgUHJvbWlzZShmdW5jdGlvbiAoZnVsZmlsbCwgcmVqZWN0KSB7XG4gICAgb3B0cy5jb21wbGV0ZSA9IGZ1bmN0aW9uIChlcnIsIHJlcykge1xuICAgICAgaWYgKGVycikge1xuICAgICAgICByZWplY3QoZXJyKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGZ1bGZpbGwocmVzKTtcbiAgICAgIH1cbiAgICB9O1xuICB9KTtcblxuICBwcm9taXNlLnRoZW4oZnVuY3Rpb24gKHJlc3VsdCkge1xuICAgIGNvbXBsZXRlKG51bGwsIHJlc3VsdCk7XG4gIH0sIGNvbXBsZXRlKTtcblxuICAvLyB0aGlzIG5lZWRzIHRvIGJlIG92ZXJ3cmlkZGVuIGJ5IGNhbGxlciwgZG9udCBmaXJlIGNvbXBsZXRlIHVudGlsXG4gIC8vIHRoZSB0YXNrIGlzIHJlYWR5XG4gIHByb21pc2UuY2FuY2VsID0gZnVuY3Rpb24gKCkge1xuICAgIHByb21pc2UuaXNDYW5jZWxsZWQgPSB0cnVlO1xuICAgIGlmIChzZWxmLnRhc2txdWV1ZS5pc1JlYWR5KSB7XG4gICAgICBvcHRzLmNvbXBsZXRlKG51bGwsIHtzdGF0dXM6ICdjYW5jZWxsZWQnfSk7XG4gICAgfVxuICB9O1xuXG4gIGlmICghc2VsZi50YXNrcXVldWUuaXNSZWFkeSkge1xuICAgIHNlbGYudGFza3F1ZXVlLmFkZFRhc2soZnVuY3Rpb24gKCkge1xuICAgICAgaWYgKHByb21pc2UuaXNDYW5jZWxsZWQpIHtcbiAgICAgICAgb3B0cy5jb21wbGV0ZShudWxsLCB7c3RhdHVzOiAnY2FuY2VsbGVkJ30pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZnVuKHNlbGYsIG9wdHMsIHByb21pc2UpO1xuICAgICAgfVxuICAgIH0pO1xuICB9IGVsc2Uge1xuICAgIGZ1bihzZWxmLCBvcHRzLCBwcm9taXNlKTtcbiAgfVxuICBwcm9taXNlLm9uID0gZW1pdHRlci5vbi5iaW5kKGVtaXR0ZXIpO1xuICBwcm9taXNlLm9uY2UgPSBlbWl0dGVyLm9uY2UuYmluZChlbWl0dGVyKTtcbiAgcHJvbWlzZS5hZGRMaXN0ZW5lciA9IGVtaXR0ZXIuYWRkTGlzdGVuZXIuYmluZChlbWl0dGVyKTtcbiAgcHJvbWlzZS5yZW1vdmVMaXN0ZW5lciA9IGVtaXR0ZXIucmVtb3ZlTGlzdGVuZXIuYmluZChlbWl0dGVyKTtcbiAgcHJvbWlzZS5yZW1vdmVBbGxMaXN0ZW5lcnMgPSBlbWl0dGVyLnJlbW92ZUFsbExpc3RlbmVycy5iaW5kKGVtaXR0ZXIpO1xuICBwcm9taXNlLnNldE1heExpc3RlbmVycyA9IGVtaXR0ZXIuc2V0TWF4TGlzdGVuZXJzLmJpbmQoZW1pdHRlcik7XG4gIHByb21pc2UubGlzdGVuZXJzID0gZW1pdHRlci5saXN0ZW5lcnMuYmluZChlbWl0dGVyKTtcbiAgcHJvbWlzZS5lbWl0ID0gZW1pdHRlci5lbWl0LmJpbmQoZW1pdHRlcik7XG4gIHJldHVybiBwcm9taXNlO1xufTtcblxuZXhwb3J0cy5NRDUgPSBleHBvcnRzLnRvUHJvbWlzZShyZXF1aXJlKCcuL2RlcHMvbWQ1JykpO1xuXG4vLyBkZXNpZ25lZCB0byBnaXZlIGluZm8gdG8gYnJvd3NlciB1c2Vycywgd2hvIGFyZSBkaXN0dXJiZWRcbi8vIHdoZW4gdGhleSBzZWUgNDA0cyBpbiB0aGUgY29uc29sZVxuZXhwb3J0cy5leHBsYWluNDA0ID0gZnVuY3Rpb24gKHN0cikge1xuICBpZiAocHJvY2Vzcy5icm93c2VyICYmICdjb25zb2xlJyBpbiBnbG9iYWwgJiYgJ2luZm8nIGluIGNvbnNvbGUpIHtcbiAgICBjb25zb2xlLmluZm8oJ1RoZSBhYm92ZSA0MDQgaXMgdG90YWxseSBub3JtYWwuICcgKyBzdHIpO1xuICB9XG59O1xuXG5leHBvcnRzLmluZm8gPSBmdW5jdGlvbiAoc3RyKSB7XG4gIGlmICh0eXBlb2YgY29uc29sZSAhPT0gJ3VuZGVmaW5lZCcgJiYgJ2luZm8nIGluIGNvbnNvbGUpIHtcbiAgICBjb25zb2xlLmluZm8oc3RyKTtcbiAgfVxufTtcblxuZXhwb3J0cy5wYXJzZVVyaSA9IHJlcXVpcmUoJy4vZGVwcy9wYXJzZS11cmknKTtcblxuZXhwb3J0cy5jb21wYXJlID0gZnVuY3Rpb24gKGxlZnQsIHJpZ2h0KSB7XG4gIHJldHVybiBsZWZ0IDwgcmlnaHQgPyAtMSA6IGxlZnQgPiByaWdodCA/IDEgOiAwO1xufTtcblxuZXhwb3J0cy51cGRhdGVEb2MgPSBmdW5jdGlvbiB1cGRhdGVEb2MocHJldiwgZG9jSW5mbywgcmVzdWx0cyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGksIGNiLCB3cml0ZURvYywgbmV3RWRpdHMpIHtcblxuICBpZiAoZXhwb3J0cy5yZXZFeGlzdHMocHJldiwgZG9jSW5mby5tZXRhZGF0YS5yZXYpKSB7XG4gICAgcmVzdWx0c1tpXSA9IGRvY0luZm87XG4gICAgcmV0dXJuIGNiKCk7XG4gIH1cblxuICAvLyBUT0RPOiBzb21lIG9mIHRoZXNlIGNhbiBiZSBwcmUtY2FsY3VsYXRlZCwgYnV0IGl0J3Mgc2FmZXIgdG8ganVzdFxuICAvLyBjYWxsIG1lcmdlLndpbm5pbmdSZXYoKSBhbmQgZXhwb3J0cy5pc0RlbGV0ZWQoKSBhbGwgb3ZlciBhZ2FpblxuICB2YXIgcHJldmlvdXNXaW5uaW5nUmV2ID0gbWVyZ2Uud2lubmluZ1JldihwcmV2KTtcbiAgdmFyIHByZXZpb3VzbHlEZWxldGVkID0gZXhwb3J0cy5pc0RlbGV0ZWQocHJldiwgcHJldmlvdXNXaW5uaW5nUmV2KTtcbiAgdmFyIGRlbGV0ZWQgPSBleHBvcnRzLmlzRGVsZXRlZChkb2NJbmZvLm1ldGFkYXRhKTtcbiAgdmFyIGlzUm9vdCA9IC9eMS0vLnRlc3QoZG9jSW5mby5tZXRhZGF0YS5yZXYpO1xuXG4gIGlmIChwcmV2aW91c2x5RGVsZXRlZCAmJiAhZGVsZXRlZCAmJiBuZXdFZGl0cyAmJiBpc1Jvb3QpIHtcbiAgICB2YXIgbmV3RG9jID0gZG9jSW5mby5kYXRhO1xuICAgIG5ld0RvYy5fcmV2ID0gcHJldmlvdXNXaW5uaW5nUmV2O1xuICAgIG5ld0RvYy5faWQgPSBkb2NJbmZvLm1ldGFkYXRhLmlkO1xuICAgIGRvY0luZm8gPSBleHBvcnRzLnBhcnNlRG9jKG5ld0RvYywgbmV3RWRpdHMpO1xuICB9XG5cbiAgdmFyIG1lcmdlZCA9IG1lcmdlLm1lcmdlKHByZXYucmV2X3RyZWUsIGRvY0luZm8ubWV0YWRhdGEucmV2X3RyZWVbMF0sIDEwMDApO1xuXG4gIHZhciBpbkNvbmZsaWN0ID0gbmV3RWRpdHMgJiYgKCgocHJldmlvdXNseURlbGV0ZWQgJiYgZGVsZXRlZCkgfHxcbiAgICAoIXByZXZpb3VzbHlEZWxldGVkICYmIG1lcmdlZC5jb25mbGljdHMgIT09ICduZXdfbGVhZicpIHx8XG4gICAgKHByZXZpb3VzbHlEZWxldGVkICYmICFkZWxldGVkICYmIG1lcmdlZC5jb25mbGljdHMgPT09ICduZXdfYnJhbmNoJykpKTtcblxuICBpZiAoaW5Db25mbGljdCkge1xuICAgIHZhciBlcnIgPSBlcnJvcnMuZXJyb3IoZXJyb3JzLlJFVl9DT05GTElDVCk7XG4gICAgcmVzdWx0c1tpXSA9IGVycjtcbiAgICByZXR1cm4gY2IoKTtcbiAgfVxuXG4gIHZhciBuZXdSZXYgPSBkb2NJbmZvLm1ldGFkYXRhLnJldjtcbiAgZG9jSW5mby5tZXRhZGF0YS5yZXZfdHJlZSA9IG1lcmdlZC50cmVlO1xuICBpZiAocHJldi5yZXZfbWFwKSB7XG4gICAgZG9jSW5mby5tZXRhZGF0YS5yZXZfbWFwID0gcHJldi5yZXZfbWFwOyAvLyB1c2VkIGJ5IGxldmVsZGJcbiAgfVxuXG4gIC8vIHJlY2FsY3VsYXRlXG4gIHZhciB3aW5uaW5nUmV2ID0gbWVyZ2Uud2lubmluZ1Jldihkb2NJbmZvLm1ldGFkYXRhKTtcbiAgdmFyIHdpbm5pbmdSZXZJc0RlbGV0ZWQgPSBleHBvcnRzLmlzRGVsZXRlZChkb2NJbmZvLm1ldGFkYXRhLCB3aW5uaW5nUmV2KTtcblxuICAvLyBjYWxjdWxhdGUgdGhlIHRvdGFsIG51bWJlciBvZiBkb2N1bWVudHMgdGhhdCB3ZXJlIGFkZGVkL3JlbW92ZWQsXG4gIC8vIGZyb20gdGhlIHBlcnNwZWN0aXZlIG9mIHRvdGFsX3Jvd3MvZG9jX2NvdW50XG4gIHZhciBkZWx0YSA9IChwcmV2aW91c2x5RGVsZXRlZCA9PT0gd2lubmluZ1JldklzRGVsZXRlZCkgPyAwIDpcbiAgICAgIHByZXZpb3VzbHlEZWxldGVkIDwgd2lubmluZ1JldklzRGVsZXRlZCA/IC0xIDogMTtcblxuICB2YXIgbmV3UmV2SXNEZWxldGVkID0gZXhwb3J0cy5pc0RlbGV0ZWQoZG9jSW5mby5tZXRhZGF0YSwgbmV3UmV2KTtcblxuICB3cml0ZURvYyhkb2NJbmZvLCB3aW5uaW5nUmV2LCB3aW5uaW5nUmV2SXNEZWxldGVkLCBuZXdSZXZJc0RlbGV0ZWQsXG4gICAgdHJ1ZSwgZGVsdGEsIGksIGNiKTtcbn07XG5cbmV4cG9ydHMucHJvY2Vzc0RvY3MgPSBmdW5jdGlvbiBwcm9jZXNzRG9jcyhkb2NJbmZvcywgYXBpLCBmZXRjaGVkRG9jcyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eCwgcmVzdWx0cywgd3JpdGVEb2MsIG9wdHMsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgb3ZlcmFsbENhbGxiYWNrKSB7XG5cbiAgaWYgKCFkb2NJbmZvcy5sZW5ndGgpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICBmdW5jdGlvbiBpbnNlcnREb2MoZG9jSW5mbywgcmVzdWx0c0lkeCwgY2FsbGJhY2spIHtcbiAgICAvLyBDYW50IGluc2VydCBuZXcgZGVsZXRlZCBkb2N1bWVudHNcbiAgICB2YXIgd2lubmluZ1JldiA9IG1lcmdlLndpbm5pbmdSZXYoZG9jSW5mby5tZXRhZGF0YSk7XG4gICAgdmFyIGRlbGV0ZWQgPSBleHBvcnRzLmlzRGVsZXRlZChkb2NJbmZvLm1ldGFkYXRhLCB3aW5uaW5nUmV2KTtcbiAgICBpZiAoJ3dhc19kZWxldGUnIGluIG9wdHMgJiYgZGVsZXRlZCkge1xuICAgICAgcmVzdWx0c1tyZXN1bHRzSWR4XSA9IGVycm9ycy5lcnJvcihlcnJvcnMuTUlTU0lOR19ET0MsICdkZWxldGVkJyk7XG4gICAgICByZXR1cm4gY2FsbGJhY2soKTtcbiAgICB9XG5cbiAgICB2YXIgZGVsdGEgPSBkZWxldGVkID8gMCA6IDE7XG5cbiAgICB3cml0ZURvYyhkb2NJbmZvLCB3aW5uaW5nUmV2LCBkZWxldGVkLCBkZWxldGVkLCBmYWxzZSxcbiAgICAgIGRlbHRhLCByZXN1bHRzSWR4LCBjYWxsYmFjayk7XG4gIH1cblxuICB2YXIgbmV3RWRpdHMgPSBvcHRzLm5ld19lZGl0cztcbiAgdmFyIGlkc1RvRG9jcyA9IG5ldyBleHBvcnRzLk1hcCgpO1xuXG4gIHZhciBkb2NzRG9uZSA9IDA7XG4gIHZhciBkb2NzVG9EbyA9IGRvY0luZm9zLmxlbmd0aDtcblxuICBmdW5jdGlvbiBjaGVja0FsbERvY3NEb25lKCkge1xuICAgIGlmICgrK2RvY3NEb25lID09PSBkb2NzVG9EbyAmJiBvdmVyYWxsQ2FsbGJhY2spIHtcbiAgICAgIG92ZXJhbGxDYWxsYmFjaygpO1xuICAgIH1cbiAgfVxuXG4gIGRvY0luZm9zLmZvckVhY2goZnVuY3Rpb24gKGN1cnJlbnREb2MsIHJlc3VsdHNJZHgpIHtcblxuICAgIGlmIChjdXJyZW50RG9jLl9pZCAmJiBleHBvcnRzLmlzTG9jYWxJZChjdXJyZW50RG9jLl9pZCkpIHtcbiAgICAgIGFwaVtjdXJyZW50RG9jLl9kZWxldGVkID8gJ19yZW1vdmVMb2NhbCcgOiAnX3B1dExvY2FsJ10oXG4gICAgICAgIGN1cnJlbnREb2MsIHtjdHg6IHR4fSwgZnVuY3Rpb24gKGVycikge1xuICAgICAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgICAgIHJlc3VsdHNbcmVzdWx0c0lkeF0gPSBlcnI7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJlc3VsdHNbcmVzdWx0c0lkeF0gPSB7b2s6IHRydWV9O1xuICAgICAgICAgIH1cbiAgICAgICAgICBjaGVja0FsbERvY3NEb25lKCk7XG4gICAgICAgIH0pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHZhciBpZCA9IGN1cnJlbnREb2MubWV0YWRhdGEuaWQ7XG4gICAgaWYgKGlkc1RvRG9jcy5oYXMoaWQpKSB7XG4gICAgICBkb2NzVG9Eby0tOyAvLyBkdXBsaWNhdGVcbiAgICAgIGlkc1RvRG9jcy5nZXQoaWQpLnB1c2goW2N1cnJlbnREb2MsIHJlc3VsdHNJZHhdKTtcbiAgICB9IGVsc2Uge1xuICAgICAgaWRzVG9Eb2NzLnNldChpZCwgW1tjdXJyZW50RG9jLCByZXN1bHRzSWR4XV0pO1xuICAgIH1cbiAgfSk7XG5cbiAgLy8gaW4gdGhlIGNhc2Ugb2YgbmV3X2VkaXRzLCB0aGUgdXNlciBjYW4gcHJvdmlkZSBtdWx0aXBsZSBkb2NzXG4gIC8vIHdpdGggdGhlIHNhbWUgaWQuIHRoZXNlIG5lZWQgdG8gYmUgcHJvY2Vzc2VkIHNlcXVlbnRpYWxseVxuICBpZHNUb0RvY3MuZm9yRWFjaChmdW5jdGlvbiAoZG9jcywgaWQpIHtcbiAgICB2YXIgbnVtRG9uZSA9IDA7XG5cbiAgICBmdW5jdGlvbiBkb2NXcml0dGVuKCkge1xuICAgICAgaWYgKCsrbnVtRG9uZSA8IGRvY3MubGVuZ3RoKSB7XG4gICAgICAgIG5leHREb2MoKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNoZWNrQWxsRG9jc0RvbmUoKTtcbiAgICAgIH1cbiAgICB9XG4gICAgZnVuY3Rpb24gbmV4dERvYygpIHtcbiAgICAgIHZhciB2YWx1ZSA9IGRvY3NbbnVtRG9uZV07XG4gICAgICB2YXIgY3VycmVudERvYyA9IHZhbHVlWzBdO1xuICAgICAgdmFyIHJlc3VsdHNJZHggPSB2YWx1ZVsxXTtcblxuICAgICAgaWYgKGZldGNoZWREb2NzLmhhcyhpZCkpIHtcbiAgICAgICAgZXhwb3J0cy51cGRhdGVEb2MoZmV0Y2hlZERvY3MuZ2V0KGlkKSwgY3VycmVudERvYywgcmVzdWx0cyxcbiAgICAgICAgICByZXN1bHRzSWR4LCBkb2NXcml0dGVuLCB3cml0ZURvYywgbmV3RWRpdHMpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaW5zZXJ0RG9jKGN1cnJlbnREb2MsIHJlc3VsdHNJZHgsIGRvY1dyaXR0ZW4pO1xuICAgICAgfVxuICAgIH1cbiAgICBuZXh0RG9jKCk7XG4gIH0pO1xufTtcblxuZXhwb3J0cy5wcmVwcm9jZXNzQXR0YWNobWVudHMgPSBmdW5jdGlvbiBwcmVwcm9jZXNzQXR0YWNobWVudHMoXG4gICAgZG9jSW5mb3MsIGJsb2JUeXBlLCBjYWxsYmFjaykge1xuXG4gIGlmICghZG9jSW5mb3MubGVuZ3RoKSB7XG4gICAgcmV0dXJuIGNhbGxiYWNrKCk7XG4gIH1cblxuICB2YXIgZG9jdiA9IDA7XG5cbiAgZnVuY3Rpb24gcGFyc2VCYXNlNjQoZGF0YSkge1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gZXhwb3J0cy5hdG9iKGRhdGEpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIHZhciBlcnIgPSBlcnJvcnMuZXJyb3IoZXJyb3JzLkJBRF9BUkcsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICdBdHRhY2htZW50cyBuZWVkIHRvIGJlIGJhc2U2NCBlbmNvZGVkJyk7XG4gICAgICByZXR1cm4ge2Vycm9yOiBlcnJ9O1xuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIHByZXByb2Nlc3NBdHRhY2htZW50KGF0dCwgY2FsbGJhY2spIHtcbiAgICBpZiAoYXR0LnN0dWIpIHtcbiAgICAgIHJldHVybiBjYWxsYmFjaygpO1xuICAgIH1cbiAgICBpZiAodHlwZW9mIGF0dC5kYXRhID09PSAnc3RyaW5nJykge1xuICAgICAgLy8gaW5wdXQgaXMgYSBiYXNlNjQgc3RyaW5nXG5cbiAgICAgIHZhciBhc0JpbmFyeSA9IHBhcnNlQmFzZTY0KGF0dC5kYXRhKTtcbiAgICAgIGlmIChhc0JpbmFyeS5lcnJvcikge1xuICAgICAgICByZXR1cm4gY2FsbGJhY2soYXNCaW5hcnkuZXJyb3IpO1xuICAgICAgfVxuXG4gICAgICBhdHQubGVuZ3RoID0gYXNCaW5hcnkubGVuZ3RoO1xuICAgICAgaWYgKGJsb2JUeXBlID09PSAnYmxvYicpIHtcbiAgICAgICAgYXR0LmRhdGEgPSBleHBvcnRzLmNyZWF0ZUJsb2IoW2V4cG9ydHMuZml4QmluYXJ5KGFzQmluYXJ5KV0sXG4gICAgICAgICAge3R5cGU6IGF0dC5jb250ZW50X3R5cGV9KTtcbiAgICAgIH0gZWxzZSBpZiAoYmxvYlR5cGUgPT09ICdiYXNlNjQnKSB7XG4gICAgICAgIGF0dC5kYXRhID0gZXhwb3J0cy5idG9hKGFzQmluYXJ5KTtcbiAgICAgIH0gZWxzZSB7IC8vIGJpbmFyeVxuICAgICAgICBhdHQuZGF0YSA9IGFzQmluYXJ5O1xuICAgICAgfVxuICAgICAgZXhwb3J0cy5NRDUoYXNCaW5hcnkpLnRoZW4oZnVuY3Rpb24gKHJlc3VsdCkge1xuICAgICAgICBhdHQuZGlnZXN0ID0gJ21kNS0nICsgcmVzdWx0O1xuICAgICAgICBjYWxsYmFjaygpO1xuICAgICAgfSk7XG4gICAgfSBlbHNlIHsgLy8gaW5wdXQgaXMgYSBibG9iXG4gICAgICBleHBvcnRzLnJlYWRBc0FycmF5QnVmZmVyKGF0dC5kYXRhLCBmdW5jdGlvbiAoYnVmZikge1xuICAgICAgICBpZiAoYmxvYlR5cGUgPT09ICdiaW5hcnknKSB7XG4gICAgICAgICAgYXR0LmRhdGEgPSBleHBvcnRzLmFycmF5QnVmZmVyVG9CaW5hcnlTdHJpbmcoYnVmZik7XG4gICAgICAgIH0gZWxzZSBpZiAoYmxvYlR5cGUgPT09ICdiYXNlNjQnKSB7XG4gICAgICAgICAgYXR0LmRhdGEgPSBleHBvcnRzLmJ0b2EoZXhwb3J0cy5hcnJheUJ1ZmZlclRvQmluYXJ5U3RyaW5nKGJ1ZmYpKTtcbiAgICAgICAgfVxuICAgICAgICBleHBvcnRzLk1ENShidWZmKS50aGVuKGZ1bmN0aW9uIChyZXN1bHQpIHtcbiAgICAgICAgICBhdHQuZGlnZXN0ID0gJ21kNS0nICsgcmVzdWx0O1xuICAgICAgICAgIGF0dC5sZW5ndGggPSBidWZmLmJ5dGVMZW5ndGg7XG4gICAgICAgICAgY2FsbGJhY2soKTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICB2YXIgb3ZlcmFsbEVycjtcblxuICBkb2NJbmZvcy5mb3JFYWNoKGZ1bmN0aW9uIChkb2NJbmZvKSB7XG4gICAgdmFyIGF0dGFjaG1lbnRzID0gZG9jSW5mby5kYXRhICYmIGRvY0luZm8uZGF0YS5fYXR0YWNobWVudHMgP1xuICAgICAgT2JqZWN0LmtleXMoZG9jSW5mby5kYXRhLl9hdHRhY2htZW50cykgOiBbXTtcbiAgICB2YXIgcmVjdiA9IDA7XG5cbiAgICBpZiAoIWF0dGFjaG1lbnRzLmxlbmd0aCkge1xuICAgICAgcmV0dXJuIGRvbmUoKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBwcm9jZXNzZWRBdHRhY2htZW50KGVycikge1xuICAgICAgb3ZlcmFsbEVyciA9IGVycjtcbiAgICAgIHJlY3YrKztcbiAgICAgIGlmIChyZWN2ID09PSBhdHRhY2htZW50cy5sZW5ndGgpIHtcbiAgICAgICAgZG9uZSgpO1xuICAgICAgfVxuICAgIH1cblxuICAgIGZvciAodmFyIGtleSBpbiBkb2NJbmZvLmRhdGEuX2F0dGFjaG1lbnRzKSB7XG4gICAgICBpZiAoZG9jSW5mby5kYXRhLl9hdHRhY2htZW50cy5oYXNPd25Qcm9wZXJ0eShrZXkpKSB7XG4gICAgICAgIHByZXByb2Nlc3NBdHRhY2htZW50KGRvY0luZm8uZGF0YS5fYXR0YWNobWVudHNba2V5XSxcbiAgICAgICAgICBwcm9jZXNzZWRBdHRhY2htZW50KTtcbiAgICAgIH1cbiAgICB9XG4gIH0pO1xuXG4gIGZ1bmN0aW9uIGRvbmUoKSB7XG4gICAgZG9jdisrO1xuICAgIGlmIChkb2NJbmZvcy5sZW5ndGggPT09IGRvY3YpIHtcbiAgICAgIGlmIChvdmVyYWxsRXJyKSB7XG4gICAgICAgIGNhbGxiYWNrKG92ZXJhbGxFcnIpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY2FsbGJhY2soKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbn07XG5cbi8vIGNvbXBhY3QgYSB0cmVlIGJ5IG1hcmtpbmcgaXRzIG5vbi1sZWFmcyBhcyBtaXNzaW5nLFxuLy8gYW5kIHJldHVybiBhIGxpc3Qgb2YgcmV2cyB0byBkZWxldGVcbmV4cG9ydHMuY29tcGFjdFRyZWUgPSBmdW5jdGlvbiBjb21wYWN0VHJlZShtZXRhZGF0YSkge1xuICB2YXIgcmV2cyA9IFtdO1xuICBtZXJnZS50cmF2ZXJzZVJldlRyZWUobWV0YWRhdGEucmV2X3RyZWUsIGZ1bmN0aW9uIChpc0xlYWYsIHBvcyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV2SGFzaCwgY3R4LCBvcHRzKSB7XG4gICAgaWYgKG9wdHMuc3RhdHVzID09PSAnYXZhaWxhYmxlJyAmJiAhaXNMZWFmKSB7XG4gICAgICByZXZzLnB1c2gocG9zICsgJy0nICsgcmV2SGFzaCk7XG4gICAgICBvcHRzLnN0YXR1cyA9ICdtaXNzaW5nJztcbiAgICB9XG4gIH0pO1xuICByZXR1cm4gcmV2cztcbn07XG5cbnZhciB2dXZ1emVsYSA9IHJlcXVpcmUoJ3Z1dnV6ZWxhJyk7XG5cbmV4cG9ydHMuc2FmZUpzb25QYXJzZSA9IGZ1bmN0aW9uIHNhZmVKc29uUGFyc2Uoc3RyKSB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIEpTT04ucGFyc2Uoc3RyKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIHJldHVybiB2dXZ1emVsYS5wYXJzZShzdHIpO1xuICB9XG59O1xuXG5leHBvcnRzLnNhZmVKc29uU3RyaW5naWZ5ID0gZnVuY3Rpb24gc2FmZUpzb25TdHJpbmdpZnkoanNvbikge1xuICB0cnkge1xuICAgIHJldHVybiBKU09OLnN0cmluZ2lmeShqc29uKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIHJldHVybiB2dXZ1emVsYS5zdHJpbmdpZnkoanNvbik7XG4gIH1cbn07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFwiMy40LjBcIjtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSBhcmdzQXJyYXk7XG5cbmZ1bmN0aW9uIGFyZ3NBcnJheShmdW4pIHtcbiAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgbGVuID0gYXJndW1lbnRzLmxlbmd0aDtcbiAgICBpZiAobGVuKSB7XG4gICAgICB2YXIgYXJncyA9IFtdO1xuICAgICAgdmFyIGkgPSAtMTtcbiAgICAgIHdoaWxlICgrK2kgPCBsZW4pIHtcbiAgICAgICAgYXJnc1tpXSA9IGFyZ3VtZW50c1tpXTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBmdW4uY2FsbCh0aGlzLCBhcmdzKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIGZ1bi5jYWxsKHRoaXMsIFtdKTtcbiAgICB9XG4gIH07XG59IiwiXG4vKipcbiAqIFRoaXMgaXMgdGhlIHdlYiBicm93c2VyIGltcGxlbWVudGF0aW9uIG9mIGBkZWJ1ZygpYC5cbiAqXG4gKiBFeHBvc2UgYGRlYnVnKClgIGFzIHRoZSBtb2R1bGUuXG4gKi9cblxuZXhwb3J0cyA9IG1vZHVsZS5leHBvcnRzID0gcmVxdWlyZSgnLi9kZWJ1ZycpO1xuZXhwb3J0cy5sb2cgPSBsb2c7XG5leHBvcnRzLmZvcm1hdEFyZ3MgPSBmb3JtYXRBcmdzO1xuZXhwb3J0cy5zYXZlID0gc2F2ZTtcbmV4cG9ydHMubG9hZCA9IGxvYWQ7XG5leHBvcnRzLnVzZUNvbG9ycyA9IHVzZUNvbG9ycztcblxuLyoqXG4gKiBVc2UgY2hyb21lLnN0b3JhZ2UubG9jYWwgaWYgd2UgYXJlIGluIGFuIGFwcFxuICovXG5cbnZhciBzdG9yYWdlO1xuXG5pZiAodHlwZW9mIGNocm9tZSAhPT0gJ3VuZGVmaW5lZCcgJiYgdHlwZW9mIGNocm9tZS5zdG9yYWdlICE9PSAndW5kZWZpbmVkJylcbiAgc3RvcmFnZSA9IGNocm9tZS5zdG9yYWdlLmxvY2FsO1xuZWxzZVxuICBzdG9yYWdlID0gbG9jYWxzdG9yYWdlKCk7XG5cbi8qKlxuICogQ29sb3JzLlxuICovXG5cbmV4cG9ydHMuY29sb3JzID0gW1xuICAnbGlnaHRzZWFncmVlbicsXG4gICdmb3Jlc3RncmVlbicsXG4gICdnb2xkZW5yb2QnLFxuICAnZG9kZ2VyYmx1ZScsXG4gICdkYXJrb3JjaGlkJyxcbiAgJ2NyaW1zb24nXG5dO1xuXG4vKipcbiAqIEN1cnJlbnRseSBvbmx5IFdlYktpdC1iYXNlZCBXZWIgSW5zcGVjdG9ycywgRmlyZWZveCA+PSB2MzEsXG4gKiBhbmQgdGhlIEZpcmVidWcgZXh0ZW5zaW9uIChhbnkgRmlyZWZveCB2ZXJzaW9uKSBhcmUga25vd25cbiAqIHRvIHN1cHBvcnQgXCIlY1wiIENTUyBjdXN0b21pemF0aW9ucy5cbiAqXG4gKiBUT0RPOiBhZGQgYSBgbG9jYWxTdG9yYWdlYCB2YXJpYWJsZSB0byBleHBsaWNpdGx5IGVuYWJsZS9kaXNhYmxlIGNvbG9yc1xuICovXG5cbmZ1bmN0aW9uIHVzZUNvbG9ycygpIHtcbiAgLy8gaXMgd2Via2l0PyBodHRwOi8vc3RhY2tvdmVyZmxvdy5jb20vYS8xNjQ1OTYwNi8zNzY3NzNcbiAgcmV0dXJuICgnV2Via2l0QXBwZWFyYW5jZScgaW4gZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50LnN0eWxlKSB8fFxuICAgIC8vIGlzIGZpcmVidWc/IGh0dHA6Ly9zdGFja292ZXJmbG93LmNvbS9hLzM5ODEyMC8zNzY3NzNcbiAgICAod2luZG93LmNvbnNvbGUgJiYgKGNvbnNvbGUuZmlyZWJ1ZyB8fCAoY29uc29sZS5leGNlcHRpb24gJiYgY29uc29sZS50YWJsZSkpKSB8fFxuICAgIC8vIGlzIGZpcmVmb3ggPj0gdjMxP1xuICAgIC8vIGh0dHBzOi8vZGV2ZWxvcGVyLm1vemlsbGEub3JnL2VuLVVTL2RvY3MvVG9vbHMvV2ViX0NvbnNvbGUjU3R5bGluZ19tZXNzYWdlc1xuICAgIChuYXZpZ2F0b3IudXNlckFnZW50LnRvTG93ZXJDYXNlKCkubWF0Y2goL2ZpcmVmb3hcXC8oXFxkKykvKSAmJiBwYXJzZUludChSZWdFeHAuJDEsIDEwKSA+PSAzMSk7XG59XG5cbi8qKlxuICogTWFwICVqIHRvIGBKU09OLnN0cmluZ2lmeSgpYCwgc2luY2Ugbm8gV2ViIEluc3BlY3RvcnMgZG8gdGhhdCBieSBkZWZhdWx0LlxuICovXG5cbmV4cG9ydHMuZm9ybWF0dGVycy5qID0gZnVuY3Rpb24odikge1xuICByZXR1cm4gSlNPTi5zdHJpbmdpZnkodik7XG59O1xuXG5cbi8qKlxuICogQ29sb3JpemUgbG9nIGFyZ3VtZW50cyBpZiBlbmFibGVkLlxuICpcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuZnVuY3Rpb24gZm9ybWF0QXJncygpIHtcbiAgdmFyIGFyZ3MgPSBhcmd1bWVudHM7XG4gIHZhciB1c2VDb2xvcnMgPSB0aGlzLnVzZUNvbG9ycztcblxuICBhcmdzWzBdID0gKHVzZUNvbG9ycyA/ICclYycgOiAnJylcbiAgICArIHRoaXMubmFtZXNwYWNlXG4gICAgKyAodXNlQ29sb3JzID8gJyAlYycgOiAnICcpXG4gICAgKyBhcmdzWzBdXG4gICAgKyAodXNlQ29sb3JzID8gJyVjICcgOiAnICcpXG4gICAgKyAnKycgKyBleHBvcnRzLmh1bWFuaXplKHRoaXMuZGlmZik7XG5cbiAgaWYgKCF1c2VDb2xvcnMpIHJldHVybiBhcmdzO1xuXG4gIHZhciBjID0gJ2NvbG9yOiAnICsgdGhpcy5jb2xvcjtcbiAgYXJncyA9IFthcmdzWzBdLCBjLCAnY29sb3I6IGluaGVyaXQnXS5jb25jYXQoQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJncywgMSkpO1xuXG4gIC8vIHRoZSBmaW5hbCBcIiVjXCIgaXMgc29tZXdoYXQgdHJpY2t5LCBiZWNhdXNlIHRoZXJlIGNvdWxkIGJlIG90aGVyXG4gIC8vIGFyZ3VtZW50cyBwYXNzZWQgZWl0aGVyIGJlZm9yZSBvciBhZnRlciB0aGUgJWMsIHNvIHdlIG5lZWQgdG9cbiAgLy8gZmlndXJlIG91dCB0aGUgY29ycmVjdCBpbmRleCB0byBpbnNlcnQgdGhlIENTUyBpbnRvXG4gIHZhciBpbmRleCA9IDA7XG4gIHZhciBsYXN0QyA9IDA7XG4gIGFyZ3NbMF0ucmVwbGFjZSgvJVthLXolXS9nLCBmdW5jdGlvbihtYXRjaCkge1xuICAgIGlmICgnJSUnID09PSBtYXRjaCkgcmV0dXJuO1xuICAgIGluZGV4Kys7XG4gICAgaWYgKCclYycgPT09IG1hdGNoKSB7XG4gICAgICAvLyB3ZSBvbmx5IGFyZSBpbnRlcmVzdGVkIGluIHRoZSAqbGFzdCogJWNcbiAgICAgIC8vICh0aGUgdXNlciBtYXkgaGF2ZSBwcm92aWRlZCB0aGVpciBvd24pXG4gICAgICBsYXN0QyA9IGluZGV4O1xuICAgIH1cbiAgfSk7XG5cbiAgYXJncy5zcGxpY2UobGFzdEMsIDAsIGMpO1xuICByZXR1cm4gYXJncztcbn1cblxuLyoqXG4gKiBJbnZva2VzIGBjb25zb2xlLmxvZygpYCB3aGVuIGF2YWlsYWJsZS5cbiAqIE5vLW9wIHdoZW4gYGNvbnNvbGUubG9nYCBpcyBub3QgYSBcImZ1bmN0aW9uXCIuXG4gKlxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5mdW5jdGlvbiBsb2coKSB7XG4gIC8vIHRoaXMgaGFja2VyeSBpcyByZXF1aXJlZCBmb3IgSUU4LzksIHdoZXJlXG4gIC8vIHRoZSBgY29uc29sZS5sb2dgIGZ1bmN0aW9uIGRvZXNuJ3QgaGF2ZSAnYXBwbHknXG4gIHJldHVybiAnb2JqZWN0JyA9PT0gdHlwZW9mIGNvbnNvbGVcbiAgICAmJiBjb25zb2xlLmxvZ1xuICAgICYmIEZ1bmN0aW9uLnByb3RvdHlwZS5hcHBseS5jYWxsKGNvbnNvbGUubG9nLCBjb25zb2xlLCBhcmd1bWVudHMpO1xufVxuXG4vKipcbiAqIFNhdmUgYG5hbWVzcGFjZXNgLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBuYW1lc3BhY2VzXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5mdW5jdGlvbiBzYXZlKG5hbWVzcGFjZXMpIHtcbiAgdHJ5IHtcbiAgICBpZiAobnVsbCA9PSBuYW1lc3BhY2VzKSB7XG4gICAgICBzdG9yYWdlLnJlbW92ZUl0ZW0oJ2RlYnVnJyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHN0b3JhZ2UuZGVidWcgPSBuYW1lc3BhY2VzO1xuICAgIH1cbiAgfSBjYXRjaChlKSB7fVxufVxuXG4vKipcbiAqIExvYWQgYG5hbWVzcGFjZXNgLlxuICpcbiAqIEByZXR1cm4ge1N0cmluZ30gcmV0dXJucyB0aGUgcHJldmlvdXNseSBwZXJzaXN0ZWQgZGVidWcgbW9kZXNcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmZ1bmN0aW9uIGxvYWQoKSB7XG4gIHZhciByO1xuICB0cnkge1xuICAgIHIgPSBzdG9yYWdlLmRlYnVnO1xuICB9IGNhdGNoKGUpIHt9XG4gIHJldHVybiByO1xufVxuXG4vKipcbiAqIEVuYWJsZSBuYW1lc3BhY2VzIGxpc3RlZCBpbiBgbG9jYWxTdG9yYWdlLmRlYnVnYCBpbml0aWFsbHkuXG4gKi9cblxuZXhwb3J0cy5lbmFibGUobG9hZCgpKTtcblxuLyoqXG4gKiBMb2NhbHN0b3JhZ2UgYXR0ZW1wdHMgdG8gcmV0dXJuIHRoZSBsb2NhbHN0b3JhZ2UuXG4gKlxuICogVGhpcyBpcyBuZWNlc3NhcnkgYmVjYXVzZSBzYWZhcmkgdGhyb3dzXG4gKiB3aGVuIGEgdXNlciBkaXNhYmxlcyBjb29raWVzL2xvY2Fsc3RvcmFnZVxuICogYW5kIHlvdSBhdHRlbXB0IHRvIGFjY2VzcyBpdC5cbiAqXG4gKiBAcmV0dXJuIHtMb2NhbFN0b3JhZ2V9XG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5mdW5jdGlvbiBsb2NhbHN0b3JhZ2UoKXtcbiAgdHJ5IHtcbiAgICByZXR1cm4gd2luZG93LmxvY2FsU3RvcmFnZTtcbiAgfSBjYXRjaCAoZSkge31cbn1cbiIsIlxuLyoqXG4gKiBUaGlzIGlzIHRoZSBjb21tb24gbG9naWMgZm9yIGJvdGggdGhlIE5vZGUuanMgYW5kIHdlYiBicm93c2VyXG4gKiBpbXBsZW1lbnRhdGlvbnMgb2YgYGRlYnVnKClgLlxuICpcbiAqIEV4cG9zZSBgZGVidWcoKWAgYXMgdGhlIG1vZHVsZS5cbiAqL1xuXG5leHBvcnRzID0gbW9kdWxlLmV4cG9ydHMgPSBkZWJ1ZztcbmV4cG9ydHMuY29lcmNlID0gY29lcmNlO1xuZXhwb3J0cy5kaXNhYmxlID0gZGlzYWJsZTtcbmV4cG9ydHMuZW5hYmxlID0gZW5hYmxlO1xuZXhwb3J0cy5lbmFibGVkID0gZW5hYmxlZDtcbmV4cG9ydHMuaHVtYW5pemUgPSByZXF1aXJlKCdtcycpO1xuXG4vKipcbiAqIFRoZSBjdXJyZW50bHkgYWN0aXZlIGRlYnVnIG1vZGUgbmFtZXMsIGFuZCBuYW1lcyB0byBza2lwLlxuICovXG5cbmV4cG9ydHMubmFtZXMgPSBbXTtcbmV4cG9ydHMuc2tpcHMgPSBbXTtcblxuLyoqXG4gKiBNYXAgb2Ygc3BlY2lhbCBcIiVuXCIgaGFuZGxpbmcgZnVuY3Rpb25zLCBmb3IgdGhlIGRlYnVnIFwiZm9ybWF0XCIgYXJndW1lbnQuXG4gKlxuICogVmFsaWQga2V5IG5hbWVzIGFyZSBhIHNpbmdsZSwgbG93ZXJjYXNlZCBsZXR0ZXIsIGkuZS4gXCJuXCIuXG4gKi9cblxuZXhwb3J0cy5mb3JtYXR0ZXJzID0ge307XG5cbi8qKlxuICogUHJldmlvdXNseSBhc3NpZ25lZCBjb2xvci5cbiAqL1xuXG52YXIgcHJldkNvbG9yID0gMDtcblxuLyoqXG4gKiBQcmV2aW91cyBsb2cgdGltZXN0YW1wLlxuICovXG5cbnZhciBwcmV2VGltZTtcblxuLyoqXG4gKiBTZWxlY3QgYSBjb2xvci5cbiAqXG4gKiBAcmV0dXJuIHtOdW1iZXJ9XG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5mdW5jdGlvbiBzZWxlY3RDb2xvcigpIHtcbiAgcmV0dXJuIGV4cG9ydHMuY29sb3JzW3ByZXZDb2xvcisrICUgZXhwb3J0cy5jb2xvcnMubGVuZ3RoXTtcbn1cblxuLyoqXG4gKiBDcmVhdGUgYSBkZWJ1Z2dlciB3aXRoIHRoZSBnaXZlbiBgbmFtZXNwYWNlYC5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gbmFtZXNwYWNlXG4gKiBAcmV0dXJuIHtGdW5jdGlvbn1cbiAqIEBhcGkgcHVibGljXG4gKi9cblxuZnVuY3Rpb24gZGVidWcobmFtZXNwYWNlKSB7XG5cbiAgLy8gZGVmaW5lIHRoZSBgZGlzYWJsZWRgIHZlcnNpb25cbiAgZnVuY3Rpb24gZGlzYWJsZWQoKSB7XG4gIH1cbiAgZGlzYWJsZWQuZW5hYmxlZCA9IGZhbHNlO1xuXG4gIC8vIGRlZmluZSB0aGUgYGVuYWJsZWRgIHZlcnNpb25cbiAgZnVuY3Rpb24gZW5hYmxlZCgpIHtcblxuICAgIHZhciBzZWxmID0gZW5hYmxlZDtcblxuICAgIC8vIHNldCBgZGlmZmAgdGltZXN0YW1wXG4gICAgdmFyIGN1cnIgPSArbmV3IERhdGUoKTtcbiAgICB2YXIgbXMgPSBjdXJyIC0gKHByZXZUaW1lIHx8IGN1cnIpO1xuICAgIHNlbGYuZGlmZiA9IG1zO1xuICAgIHNlbGYucHJldiA9IHByZXZUaW1lO1xuICAgIHNlbGYuY3VyciA9IGN1cnI7XG4gICAgcHJldlRpbWUgPSBjdXJyO1xuXG4gICAgLy8gYWRkIHRoZSBgY29sb3JgIGlmIG5vdCBzZXRcbiAgICBpZiAobnVsbCA9PSBzZWxmLnVzZUNvbG9ycykgc2VsZi51c2VDb2xvcnMgPSBleHBvcnRzLnVzZUNvbG9ycygpO1xuICAgIGlmIChudWxsID09IHNlbGYuY29sb3IgJiYgc2VsZi51c2VDb2xvcnMpIHNlbGYuY29sb3IgPSBzZWxlY3RDb2xvcigpO1xuXG4gICAgdmFyIGFyZ3MgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMpO1xuXG4gICAgYXJnc1swXSA9IGV4cG9ydHMuY29lcmNlKGFyZ3NbMF0pO1xuXG4gICAgaWYgKCdzdHJpbmcnICE9PSB0eXBlb2YgYXJnc1swXSkge1xuICAgICAgLy8gYW55dGhpbmcgZWxzZSBsZXQncyBpbnNwZWN0IHdpdGggJW9cbiAgICAgIGFyZ3MgPSBbJyVvJ10uY29uY2F0KGFyZ3MpO1xuICAgIH1cblxuICAgIC8vIGFwcGx5IGFueSBgZm9ybWF0dGVyc2AgdHJhbnNmb3JtYXRpb25zXG4gICAgdmFyIGluZGV4ID0gMDtcbiAgICBhcmdzWzBdID0gYXJnc1swXS5yZXBsYWNlKC8lKFthLXolXSkvZywgZnVuY3Rpb24obWF0Y2gsIGZvcm1hdCkge1xuICAgICAgLy8gaWYgd2UgZW5jb3VudGVyIGFuIGVzY2FwZWQgJSB0aGVuIGRvbid0IGluY3JlYXNlIHRoZSBhcnJheSBpbmRleFxuICAgICAgaWYgKG1hdGNoID09PSAnJSUnKSByZXR1cm4gbWF0Y2g7XG4gICAgICBpbmRleCsrO1xuICAgICAgdmFyIGZvcm1hdHRlciA9IGV4cG9ydHMuZm9ybWF0dGVyc1tmb3JtYXRdO1xuICAgICAgaWYgKCdmdW5jdGlvbicgPT09IHR5cGVvZiBmb3JtYXR0ZXIpIHtcbiAgICAgICAgdmFyIHZhbCA9IGFyZ3NbaW5kZXhdO1xuICAgICAgICBtYXRjaCA9IGZvcm1hdHRlci5jYWxsKHNlbGYsIHZhbCk7XG5cbiAgICAgICAgLy8gbm93IHdlIG5lZWQgdG8gcmVtb3ZlIGBhcmdzW2luZGV4XWAgc2luY2UgaXQncyBpbmxpbmVkIGluIHRoZSBgZm9ybWF0YFxuICAgICAgICBhcmdzLnNwbGljZShpbmRleCwgMSk7XG4gICAgICAgIGluZGV4LS07XG4gICAgICB9XG4gICAgICByZXR1cm4gbWF0Y2g7XG4gICAgfSk7XG5cbiAgICBpZiAoJ2Z1bmN0aW9uJyA9PT0gdHlwZW9mIGV4cG9ydHMuZm9ybWF0QXJncykge1xuICAgICAgYXJncyA9IGV4cG9ydHMuZm9ybWF0QXJncy5hcHBseShzZWxmLCBhcmdzKTtcbiAgICB9XG4gICAgdmFyIGxvZ0ZuID0gZW5hYmxlZC5sb2cgfHwgZXhwb3J0cy5sb2cgfHwgY29uc29sZS5sb2cuYmluZChjb25zb2xlKTtcbiAgICBsb2dGbi5hcHBseShzZWxmLCBhcmdzKTtcbiAgfVxuICBlbmFibGVkLmVuYWJsZWQgPSB0cnVlO1xuXG4gIHZhciBmbiA9IGV4cG9ydHMuZW5hYmxlZChuYW1lc3BhY2UpID8gZW5hYmxlZCA6IGRpc2FibGVkO1xuXG4gIGZuLm5hbWVzcGFjZSA9IG5hbWVzcGFjZTtcblxuICByZXR1cm4gZm47XG59XG5cbi8qKlxuICogRW5hYmxlcyBhIGRlYnVnIG1vZGUgYnkgbmFtZXNwYWNlcy4gVGhpcyBjYW4gaW5jbHVkZSBtb2Rlc1xuICogc2VwYXJhdGVkIGJ5IGEgY29sb24gYW5kIHdpbGRjYXJkcy5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gbmFtZXNwYWNlc1xuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5mdW5jdGlvbiBlbmFibGUobmFtZXNwYWNlcykge1xuICBleHBvcnRzLnNhdmUobmFtZXNwYWNlcyk7XG5cbiAgdmFyIHNwbGl0ID0gKG5hbWVzcGFjZXMgfHwgJycpLnNwbGl0KC9bXFxzLF0rLyk7XG4gIHZhciBsZW4gPSBzcGxpdC5sZW5ndGg7XG5cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW47IGkrKykge1xuICAgIGlmICghc3BsaXRbaV0pIGNvbnRpbnVlOyAvLyBpZ25vcmUgZW1wdHkgc3RyaW5nc1xuICAgIG5hbWVzcGFjZXMgPSBzcGxpdFtpXS5yZXBsYWNlKC9cXCovZywgJy4qPycpO1xuICAgIGlmIChuYW1lc3BhY2VzWzBdID09PSAnLScpIHtcbiAgICAgIGV4cG9ydHMuc2tpcHMucHVzaChuZXcgUmVnRXhwKCdeJyArIG5hbWVzcGFjZXMuc3Vic3RyKDEpICsgJyQnKSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGV4cG9ydHMubmFtZXMucHVzaChuZXcgUmVnRXhwKCdeJyArIG5hbWVzcGFjZXMgKyAnJCcpKTtcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBEaXNhYmxlIGRlYnVnIG91dHB1dC5cbiAqXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbmZ1bmN0aW9uIGRpc2FibGUoKSB7XG4gIGV4cG9ydHMuZW5hYmxlKCcnKTtcbn1cblxuLyoqXG4gKiBSZXR1cm5zIHRydWUgaWYgdGhlIGdpdmVuIG1vZGUgbmFtZSBpcyBlbmFibGVkLCBmYWxzZSBvdGhlcndpc2UuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IG5hbWVcbiAqIEByZXR1cm4ge0Jvb2xlYW59XG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbmZ1bmN0aW9uIGVuYWJsZWQobmFtZSkge1xuICB2YXIgaSwgbGVuO1xuICBmb3IgKGkgPSAwLCBsZW4gPSBleHBvcnRzLnNraXBzLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgaWYgKGV4cG9ydHMuc2tpcHNbaV0udGVzdChuYW1lKSkge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuICBmb3IgKGkgPSAwLCBsZW4gPSBleHBvcnRzLm5hbWVzLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgaWYgKGV4cG9ydHMubmFtZXNbaV0udGVzdChuYW1lKSkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLyoqXG4gKiBDb2VyY2UgYHZhbGAuXG4gKlxuICogQHBhcmFtIHtNaXhlZH0gdmFsXG4gKiBAcmV0dXJuIHtNaXhlZH1cbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmZ1bmN0aW9uIGNvZXJjZSh2YWwpIHtcbiAgaWYgKHZhbCBpbnN0YW5jZW9mIEVycm9yKSByZXR1cm4gdmFsLnN0YWNrIHx8IHZhbC5tZXNzYWdlO1xuICByZXR1cm4gdmFsO1xufVxuIiwiLyoqXG4gKiBIZWxwZXJzLlxuICovXG5cbnZhciBzID0gMTAwMDtcbnZhciBtID0gcyAqIDYwO1xudmFyIGggPSBtICogNjA7XG52YXIgZCA9IGggKiAyNDtcbnZhciB5ID0gZCAqIDM2NS4yNTtcblxuLyoqXG4gKiBQYXJzZSBvciBmb3JtYXQgdGhlIGdpdmVuIGB2YWxgLlxuICpcbiAqIE9wdGlvbnM6XG4gKlxuICogIC0gYGxvbmdgIHZlcmJvc2UgZm9ybWF0dGluZyBbZmFsc2VdXG4gKlxuICogQHBhcmFtIHtTdHJpbmd8TnVtYmVyfSB2YWxcbiAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zXG4gKiBAcmV0dXJuIHtTdHJpbmd8TnVtYmVyfVxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKHZhbCwgb3B0aW9ucyl7XG4gIG9wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xuICBpZiAoJ3N0cmluZycgPT0gdHlwZW9mIHZhbCkgcmV0dXJuIHBhcnNlKHZhbCk7XG4gIHJldHVybiBvcHRpb25zLmxvbmdcbiAgICA/IGxvbmcodmFsKVxuICAgIDogc2hvcnQodmFsKTtcbn07XG5cbi8qKlxuICogUGFyc2UgdGhlIGdpdmVuIGBzdHJgIGFuZCByZXR1cm4gbWlsbGlzZWNvbmRzLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBzdHJcbiAqIEByZXR1cm4ge051bWJlcn1cbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmZ1bmN0aW9uIHBhcnNlKHN0cikge1xuICB2YXIgbWF0Y2ggPSAvXigoPzpcXGQrKT9cXC4/XFxkKykgKihtaWxsaXNlY29uZHM/fG1zZWNzP3xtc3xzZWNvbmRzP3xzZWNzP3xzfG1pbnV0ZXM/fG1pbnM/fG18aG91cnM/fGhycz98aHxkYXlzP3xkfHllYXJzP3x5cnM/fHkpPyQvaS5leGVjKHN0cik7XG4gIGlmICghbWF0Y2gpIHJldHVybjtcbiAgdmFyIG4gPSBwYXJzZUZsb2F0KG1hdGNoWzFdKTtcbiAgdmFyIHR5cGUgPSAobWF0Y2hbMl0gfHwgJ21zJykudG9Mb3dlckNhc2UoKTtcbiAgc3dpdGNoICh0eXBlKSB7XG4gICAgY2FzZSAneWVhcnMnOlxuICAgIGNhc2UgJ3llYXInOlxuICAgIGNhc2UgJ3lycyc6XG4gICAgY2FzZSAneXInOlxuICAgIGNhc2UgJ3knOlxuICAgICAgcmV0dXJuIG4gKiB5O1xuICAgIGNhc2UgJ2RheXMnOlxuICAgIGNhc2UgJ2RheSc6XG4gICAgY2FzZSAnZCc6XG4gICAgICByZXR1cm4gbiAqIGQ7XG4gICAgY2FzZSAnaG91cnMnOlxuICAgIGNhc2UgJ2hvdXInOlxuICAgIGNhc2UgJ2hycyc6XG4gICAgY2FzZSAnaHInOlxuICAgIGNhc2UgJ2gnOlxuICAgICAgcmV0dXJuIG4gKiBoO1xuICAgIGNhc2UgJ21pbnV0ZXMnOlxuICAgIGNhc2UgJ21pbnV0ZSc6XG4gICAgY2FzZSAnbWlucyc6XG4gICAgY2FzZSAnbWluJzpcbiAgICBjYXNlICdtJzpcbiAgICAgIHJldHVybiBuICogbTtcbiAgICBjYXNlICdzZWNvbmRzJzpcbiAgICBjYXNlICdzZWNvbmQnOlxuICAgIGNhc2UgJ3NlY3MnOlxuICAgIGNhc2UgJ3NlYyc6XG4gICAgY2FzZSAncyc6XG4gICAgICByZXR1cm4gbiAqIHM7XG4gICAgY2FzZSAnbWlsbGlzZWNvbmRzJzpcbiAgICBjYXNlICdtaWxsaXNlY29uZCc6XG4gICAgY2FzZSAnbXNlY3MnOlxuICAgIGNhc2UgJ21zZWMnOlxuICAgIGNhc2UgJ21zJzpcbiAgICAgIHJldHVybiBuO1xuICB9XG59XG5cbi8qKlxuICogU2hvcnQgZm9ybWF0IGZvciBgbXNgLlxuICpcbiAqIEBwYXJhbSB7TnVtYmVyfSBtc1xuICogQHJldHVybiB7U3RyaW5nfVxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuZnVuY3Rpb24gc2hvcnQobXMpIHtcbiAgaWYgKG1zID49IGQpIHJldHVybiBNYXRoLnJvdW5kKG1zIC8gZCkgKyAnZCc7XG4gIGlmIChtcyA+PSBoKSByZXR1cm4gTWF0aC5yb3VuZChtcyAvIGgpICsgJ2gnO1xuICBpZiAobXMgPj0gbSkgcmV0dXJuIE1hdGgucm91bmQobXMgLyBtKSArICdtJztcbiAgaWYgKG1zID49IHMpIHJldHVybiBNYXRoLnJvdW5kKG1zIC8gcykgKyAncyc7XG4gIHJldHVybiBtcyArICdtcyc7XG59XG5cbi8qKlxuICogTG9uZyBmb3JtYXQgZm9yIGBtc2AuXG4gKlxuICogQHBhcmFtIHtOdW1iZXJ9IG1zXG4gKiBAcmV0dXJuIHtTdHJpbmd9XG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5mdW5jdGlvbiBsb25nKG1zKSB7XG4gIHJldHVybiBwbHVyYWwobXMsIGQsICdkYXknKVxuICAgIHx8IHBsdXJhbChtcywgaCwgJ2hvdXInKVxuICAgIHx8IHBsdXJhbChtcywgbSwgJ21pbnV0ZScpXG4gICAgfHwgcGx1cmFsKG1zLCBzLCAnc2Vjb25kJylcbiAgICB8fCBtcyArICcgbXMnO1xufVxuXG4vKipcbiAqIFBsdXJhbGl6YXRpb24gaGVscGVyLlxuICovXG5cbmZ1bmN0aW9uIHBsdXJhbChtcywgbiwgbmFtZSkge1xuICBpZiAobXMgPCBuKSByZXR1cm47XG4gIGlmIChtcyA8IG4gKiAxLjUpIHJldHVybiBNYXRoLmZsb29yKG1zIC8gbikgKyAnICcgKyBuYW1lO1xuICByZXR1cm4gTWF0aC5jZWlsKG1zIC8gbikgKyAnICcgKyBuYW1lICsgJ3MnO1xufVxuIiwiaWYgKHR5cGVvZiBPYmplY3QuY3JlYXRlID09PSAnZnVuY3Rpb24nKSB7XG4gIC8vIGltcGxlbWVudGF0aW9uIGZyb20gc3RhbmRhcmQgbm9kZS5qcyAndXRpbCcgbW9kdWxlXG4gIG1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gaW5oZXJpdHMoY3Rvciwgc3VwZXJDdG9yKSB7XG4gICAgY3Rvci5zdXBlcl8gPSBzdXBlckN0b3JcbiAgICBjdG9yLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoc3VwZXJDdG9yLnByb3RvdHlwZSwge1xuICAgICAgY29uc3RydWN0b3I6IHtcbiAgICAgICAgdmFsdWU6IGN0b3IsXG4gICAgICAgIGVudW1lcmFibGU6IGZhbHNlLFxuICAgICAgICB3cml0YWJsZTogdHJ1ZSxcbiAgICAgICAgY29uZmlndXJhYmxlOiB0cnVlXG4gICAgICB9XG4gICAgfSk7XG4gIH07XG59IGVsc2Uge1xuICAvLyBvbGQgc2Nob29sIHNoaW0gZm9yIG9sZCBicm93c2Vyc1xuICBtb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIGluaGVyaXRzKGN0b3IsIHN1cGVyQ3Rvcikge1xuICAgIGN0b3Iuc3VwZXJfID0gc3VwZXJDdG9yXG4gICAgdmFyIFRlbXBDdG9yID0gZnVuY3Rpb24gKCkge31cbiAgICBUZW1wQ3Rvci5wcm90b3R5cGUgPSBzdXBlckN0b3IucHJvdG90eXBlXG4gICAgY3Rvci5wcm90b3R5cGUgPSBuZXcgVGVtcEN0b3IoKVxuICAgIGN0b3IucHJvdG90eXBlLmNvbnN0cnVjdG9yID0gY3RvclxuICB9XG59XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gSU5URVJOQUw7XG5cbmZ1bmN0aW9uIElOVEVSTkFMKCkge30iLCIndXNlIHN0cmljdCc7XG52YXIgUHJvbWlzZSA9IHJlcXVpcmUoJy4vcHJvbWlzZScpO1xudmFyIHJlamVjdCA9IHJlcXVpcmUoJy4vcmVqZWN0Jyk7XG52YXIgcmVzb2x2ZSA9IHJlcXVpcmUoJy4vcmVzb2x2ZScpO1xudmFyIElOVEVSTkFMID0gcmVxdWlyZSgnLi9JTlRFUk5BTCcpO1xudmFyIGhhbmRsZXJzID0gcmVxdWlyZSgnLi9oYW5kbGVycycpO1xubW9kdWxlLmV4cG9ydHMgPSBhbGw7XG5mdW5jdGlvbiBhbGwoaXRlcmFibGUpIHtcbiAgaWYgKE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbChpdGVyYWJsZSkgIT09ICdbb2JqZWN0IEFycmF5XScpIHtcbiAgICByZXR1cm4gcmVqZWN0KG5ldyBUeXBlRXJyb3IoJ211c3QgYmUgYW4gYXJyYXknKSk7XG4gIH1cblxuICB2YXIgbGVuID0gaXRlcmFibGUubGVuZ3RoO1xuICB2YXIgY2FsbGVkID0gZmFsc2U7XG4gIGlmICghbGVuKSB7XG4gICAgcmV0dXJuIHJlc29sdmUoW10pO1xuICB9XG5cbiAgdmFyIHZhbHVlcyA9IG5ldyBBcnJheShsZW4pO1xuICB2YXIgcmVzb2x2ZWQgPSAwO1xuICB2YXIgaSA9IC0xO1xuICB2YXIgcHJvbWlzZSA9IG5ldyBQcm9taXNlKElOVEVSTkFMKTtcbiAgXG4gIHdoaWxlICgrK2kgPCBsZW4pIHtcbiAgICBhbGxSZXNvbHZlcihpdGVyYWJsZVtpXSwgaSk7XG4gIH1cbiAgcmV0dXJuIHByb21pc2U7XG4gIGZ1bmN0aW9uIGFsbFJlc29sdmVyKHZhbHVlLCBpKSB7XG4gICAgcmVzb2x2ZSh2YWx1ZSkudGhlbihyZXNvbHZlRnJvbUFsbCwgZnVuY3Rpb24gKGVycm9yKSB7XG4gICAgICBpZiAoIWNhbGxlZCkge1xuICAgICAgICBjYWxsZWQgPSB0cnVlO1xuICAgICAgICBoYW5kbGVycy5yZWplY3QocHJvbWlzZSwgZXJyb3IpO1xuICAgICAgfVxuICAgIH0pO1xuICAgIGZ1bmN0aW9uIHJlc29sdmVGcm9tQWxsKG91dFZhbHVlKSB7XG4gICAgICB2YWx1ZXNbaV0gPSBvdXRWYWx1ZTtcbiAgICAgIGlmICgrK3Jlc29sdmVkID09PSBsZW4gJiAhY2FsbGVkKSB7XG4gICAgICAgIGNhbGxlZCA9IHRydWU7XG4gICAgICAgIGhhbmRsZXJzLnJlc29sdmUocHJvbWlzZSwgdmFsdWVzKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbn0iLCIndXNlIHN0cmljdCc7XG52YXIgdHJ5Q2F0Y2ggPSByZXF1aXJlKCcuL3RyeUNhdGNoJyk7XG52YXIgcmVzb2x2ZVRoZW5hYmxlID0gcmVxdWlyZSgnLi9yZXNvbHZlVGhlbmFibGUnKTtcbnZhciBzdGF0ZXMgPSByZXF1aXJlKCcuL3N0YXRlcycpO1xuXG5leHBvcnRzLnJlc29sdmUgPSBmdW5jdGlvbiAoc2VsZiwgdmFsdWUpIHtcbiAgdmFyIHJlc3VsdCA9IHRyeUNhdGNoKGdldFRoZW4sIHZhbHVlKTtcbiAgaWYgKHJlc3VsdC5zdGF0dXMgPT09ICdlcnJvcicpIHtcbiAgICByZXR1cm4gZXhwb3J0cy5yZWplY3Qoc2VsZiwgcmVzdWx0LnZhbHVlKTtcbiAgfVxuICB2YXIgdGhlbmFibGUgPSByZXN1bHQudmFsdWU7XG5cbiAgaWYgKHRoZW5hYmxlKSB7XG4gICAgcmVzb2x2ZVRoZW5hYmxlLnNhZmVseShzZWxmLCB0aGVuYWJsZSk7XG4gIH0gZWxzZSB7XG4gICAgc2VsZi5zdGF0ZSA9IHN0YXRlcy5GVUxGSUxMRUQ7XG4gICAgc2VsZi5vdXRjb21lID0gdmFsdWU7XG4gICAgdmFyIGkgPSAtMTtcbiAgICB2YXIgbGVuID0gc2VsZi5xdWV1ZS5sZW5ndGg7XG4gICAgd2hpbGUgKCsraSA8IGxlbikge1xuICAgICAgc2VsZi5xdWV1ZVtpXS5jYWxsRnVsZmlsbGVkKHZhbHVlKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHNlbGY7XG59O1xuZXhwb3J0cy5yZWplY3QgPSBmdW5jdGlvbiAoc2VsZiwgZXJyb3IpIHtcbiAgc2VsZi5zdGF0ZSA9IHN0YXRlcy5SRUpFQ1RFRDtcbiAgc2VsZi5vdXRjb21lID0gZXJyb3I7XG4gIHZhciBpID0gLTE7XG4gIHZhciBsZW4gPSBzZWxmLnF1ZXVlLmxlbmd0aDtcbiAgd2hpbGUgKCsraSA8IGxlbikge1xuICAgIHNlbGYucXVldWVbaV0uY2FsbFJlamVjdGVkKGVycm9yKTtcbiAgfVxuICByZXR1cm4gc2VsZjtcbn07XG5cbmZ1bmN0aW9uIGdldFRoZW4ob2JqKSB7XG4gIC8vIE1ha2Ugc3VyZSB3ZSBvbmx5IGFjY2VzcyB0aGUgYWNjZXNzb3Igb25jZSBhcyByZXF1aXJlZCBieSB0aGUgc3BlY1xuICB2YXIgdGhlbiA9IG9iaiAmJiBvYmoudGhlbjtcbiAgaWYgKG9iaiAmJiB0eXBlb2Ygb2JqID09PSAnb2JqZWN0JyAmJiB0eXBlb2YgdGhlbiA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIHJldHVybiBmdW5jdGlvbiBhcHB5VGhlbigpIHtcbiAgICAgIHRoZW4uYXBwbHkob2JqLCBhcmd1bWVudHMpO1xuICAgIH07XG4gIH1cbn0iLCJtb2R1bGUuZXhwb3J0cyA9IGV4cG9ydHMgPSByZXF1aXJlKCcuL3Byb21pc2UnKTtcblxuZXhwb3J0cy5yZXNvbHZlID0gcmVxdWlyZSgnLi9yZXNvbHZlJyk7XG5leHBvcnRzLnJlamVjdCA9IHJlcXVpcmUoJy4vcmVqZWN0Jyk7XG5leHBvcnRzLmFsbCA9IHJlcXVpcmUoJy4vYWxsJyk7XG5leHBvcnRzLnJhY2UgPSByZXF1aXJlKCcuL3JhY2UnKTsiLCIndXNlIHN0cmljdCc7XG5cbnZhciB1bndyYXAgPSByZXF1aXJlKCcuL3Vud3JhcCcpO1xudmFyIElOVEVSTkFMID0gcmVxdWlyZSgnLi9JTlRFUk5BTCcpO1xudmFyIHJlc29sdmVUaGVuYWJsZSA9IHJlcXVpcmUoJy4vcmVzb2x2ZVRoZW5hYmxlJyk7XG52YXIgc3RhdGVzID0gcmVxdWlyZSgnLi9zdGF0ZXMnKTtcbnZhciBRdWV1ZUl0ZW0gPSByZXF1aXJlKCcuL3F1ZXVlSXRlbScpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFByb21pc2U7XG5mdW5jdGlvbiBQcm9taXNlKHJlc29sdmVyKSB7XG4gIGlmICghKHRoaXMgaW5zdGFuY2VvZiBQcm9taXNlKSkge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZShyZXNvbHZlcik7XG4gIH1cbiAgaWYgKHR5cGVvZiByZXNvbHZlciAhPT0gJ2Z1bmN0aW9uJykge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3Jlc29sdmVyIG11c3QgYmUgYSBmdW5jdGlvbicpO1xuICB9XG4gIHRoaXMuc3RhdGUgPSBzdGF0ZXMuUEVORElORztcbiAgdGhpcy5xdWV1ZSA9IFtdO1xuICB0aGlzLm91dGNvbWUgPSB2b2lkIDA7XG4gIGlmIChyZXNvbHZlciAhPT0gSU5URVJOQUwpIHtcbiAgICByZXNvbHZlVGhlbmFibGUuc2FmZWx5KHRoaXMsIHJlc29sdmVyKTtcbiAgfVxufVxuXG5Qcm9taXNlLnByb3RvdHlwZVsnY2F0Y2gnXSA9IGZ1bmN0aW9uIChvblJlamVjdGVkKSB7XG4gIHJldHVybiB0aGlzLnRoZW4obnVsbCwgb25SZWplY3RlZCk7XG59O1xuUHJvbWlzZS5wcm90b3R5cGUudGhlbiA9IGZ1bmN0aW9uIChvbkZ1bGZpbGxlZCwgb25SZWplY3RlZCkge1xuICBpZiAodHlwZW9mIG9uRnVsZmlsbGVkICE9PSAnZnVuY3Rpb24nICYmIHRoaXMuc3RhdGUgPT09IHN0YXRlcy5GVUxGSUxMRUQgfHxcbiAgICB0eXBlb2Ygb25SZWplY3RlZCAhPT0gJ2Z1bmN0aW9uJyAmJiB0aGlzLnN0YXRlID09PSBzdGF0ZXMuUkVKRUNURUQpIHtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuICB2YXIgcHJvbWlzZSA9IG5ldyBQcm9taXNlKElOVEVSTkFMKTtcblxuICBcbiAgaWYgKHRoaXMuc3RhdGUgIT09IHN0YXRlcy5QRU5ESU5HKSB7XG4gICAgdmFyIHJlc29sdmVyID0gdGhpcy5zdGF0ZSA9PT0gc3RhdGVzLkZVTEZJTExFRCA/IG9uRnVsZmlsbGVkOiBvblJlamVjdGVkO1xuICAgIHVud3JhcChwcm9taXNlLCByZXNvbHZlciwgdGhpcy5vdXRjb21lKTtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLnF1ZXVlLnB1c2gobmV3IFF1ZXVlSXRlbShwcm9taXNlLCBvbkZ1bGZpbGxlZCwgb25SZWplY3RlZCkpO1xuICB9XG5cbiAgcmV0dXJuIHByb21pc2U7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xudmFyIGhhbmRsZXJzID0gcmVxdWlyZSgnLi9oYW5kbGVycycpO1xudmFyIHVud3JhcCA9IHJlcXVpcmUoJy4vdW53cmFwJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gUXVldWVJdGVtO1xuZnVuY3Rpb24gUXVldWVJdGVtKHByb21pc2UsIG9uRnVsZmlsbGVkLCBvblJlamVjdGVkKSB7XG4gIHRoaXMucHJvbWlzZSA9IHByb21pc2U7XG4gIGlmICh0eXBlb2Ygb25GdWxmaWxsZWQgPT09ICdmdW5jdGlvbicpIHtcbiAgICB0aGlzLm9uRnVsZmlsbGVkID0gb25GdWxmaWxsZWQ7XG4gICAgdGhpcy5jYWxsRnVsZmlsbGVkID0gdGhpcy5vdGhlckNhbGxGdWxmaWxsZWQ7XG4gIH1cbiAgaWYgKHR5cGVvZiBvblJlamVjdGVkID09PSAnZnVuY3Rpb24nKSB7XG4gICAgdGhpcy5vblJlamVjdGVkID0gb25SZWplY3RlZDtcbiAgICB0aGlzLmNhbGxSZWplY3RlZCA9IHRoaXMub3RoZXJDYWxsUmVqZWN0ZWQ7XG4gIH1cbn1cblF1ZXVlSXRlbS5wcm90b3R5cGUuY2FsbEZ1bGZpbGxlZCA9IGZ1bmN0aW9uICh2YWx1ZSkge1xuICBoYW5kbGVycy5yZXNvbHZlKHRoaXMucHJvbWlzZSwgdmFsdWUpO1xufTtcblF1ZXVlSXRlbS5wcm90b3R5cGUub3RoZXJDYWxsRnVsZmlsbGVkID0gZnVuY3Rpb24gKHZhbHVlKSB7XG4gIHVud3JhcCh0aGlzLnByb21pc2UsIHRoaXMub25GdWxmaWxsZWQsIHZhbHVlKTtcbn07XG5RdWV1ZUl0ZW0ucHJvdG90eXBlLmNhbGxSZWplY3RlZCA9IGZ1bmN0aW9uICh2YWx1ZSkge1xuICBoYW5kbGVycy5yZWplY3QodGhpcy5wcm9taXNlLCB2YWx1ZSk7XG59O1xuUXVldWVJdGVtLnByb3RvdHlwZS5vdGhlckNhbGxSZWplY3RlZCA9IGZ1bmN0aW9uICh2YWx1ZSkge1xuICB1bndyYXAodGhpcy5wcm9taXNlLCB0aGlzLm9uUmVqZWN0ZWQsIHZhbHVlKTtcbn07IiwiJ3VzZSBzdHJpY3QnO1xudmFyIFByb21pc2UgPSByZXF1aXJlKCcuL3Byb21pc2UnKTtcbnZhciByZWplY3QgPSByZXF1aXJlKCcuL3JlamVjdCcpO1xudmFyIHJlc29sdmUgPSByZXF1aXJlKCcuL3Jlc29sdmUnKTtcbnZhciBJTlRFUk5BTCA9IHJlcXVpcmUoJy4vSU5URVJOQUwnKTtcbnZhciBoYW5kbGVycyA9IHJlcXVpcmUoJy4vaGFuZGxlcnMnKTtcbm1vZHVsZS5leHBvcnRzID0gcmFjZTtcbmZ1bmN0aW9uIHJhY2UoaXRlcmFibGUpIHtcbiAgaWYgKE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbChpdGVyYWJsZSkgIT09ICdbb2JqZWN0IEFycmF5XScpIHtcbiAgICByZXR1cm4gcmVqZWN0KG5ldyBUeXBlRXJyb3IoJ211c3QgYmUgYW4gYXJyYXknKSk7XG4gIH1cblxuICB2YXIgbGVuID0gaXRlcmFibGUubGVuZ3RoO1xuICB2YXIgY2FsbGVkID0gZmFsc2U7XG4gIGlmICghbGVuKSB7XG4gICAgcmV0dXJuIHJlc29sdmUoW10pO1xuICB9XG5cbiAgdmFyIHJlc29sdmVkID0gMDtcbiAgdmFyIGkgPSAtMTtcbiAgdmFyIHByb21pc2UgPSBuZXcgUHJvbWlzZShJTlRFUk5BTCk7XG4gIFxuICB3aGlsZSAoKytpIDwgbGVuKSB7XG4gICAgcmVzb2x2ZXIoaXRlcmFibGVbaV0pO1xuICB9XG4gIHJldHVybiBwcm9taXNlO1xuICBmdW5jdGlvbiByZXNvbHZlcih2YWx1ZSkge1xuICAgIHJlc29sdmUodmFsdWUpLnRoZW4oZnVuY3Rpb24gKHJlc3BvbnNlKSB7XG4gICAgICBpZiAoIWNhbGxlZCkge1xuICAgICAgICBjYWxsZWQgPSB0cnVlO1xuICAgICAgICBoYW5kbGVycy5yZXNvbHZlKHByb21pc2UsIHJlc3BvbnNlKTtcbiAgICAgIH1cbiAgICB9LCBmdW5jdGlvbiAoZXJyb3IpIHtcbiAgICAgIGlmICghY2FsbGVkKSB7XG4gICAgICAgIGNhbGxlZCA9IHRydWU7XG4gICAgICAgIGhhbmRsZXJzLnJlamVjdChwcm9taXNlLCBlcnJvcik7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cbn0iLCIndXNlIHN0cmljdCc7XG5cbnZhciBQcm9taXNlID0gcmVxdWlyZSgnLi9wcm9taXNlJyk7XG52YXIgSU5URVJOQUwgPSByZXF1aXJlKCcuL0lOVEVSTkFMJyk7XG52YXIgaGFuZGxlcnMgPSByZXF1aXJlKCcuL2hhbmRsZXJzJyk7XG5tb2R1bGUuZXhwb3J0cyA9IHJlamVjdDtcblxuZnVuY3Rpb24gcmVqZWN0KHJlYXNvbikge1xuXHR2YXIgcHJvbWlzZSA9IG5ldyBQcm9taXNlKElOVEVSTkFMKTtcblx0cmV0dXJuIGhhbmRsZXJzLnJlamVjdChwcm9taXNlLCByZWFzb24pO1xufSIsIid1c2Ugc3RyaWN0JztcblxudmFyIFByb21pc2UgPSByZXF1aXJlKCcuL3Byb21pc2UnKTtcbnZhciBJTlRFUk5BTCA9IHJlcXVpcmUoJy4vSU5URVJOQUwnKTtcbnZhciBoYW5kbGVycyA9IHJlcXVpcmUoJy4vaGFuZGxlcnMnKTtcbm1vZHVsZS5leHBvcnRzID0gcmVzb2x2ZTtcblxudmFyIEZBTFNFID0gaGFuZGxlcnMucmVzb2x2ZShuZXcgUHJvbWlzZShJTlRFUk5BTCksIGZhbHNlKTtcbnZhciBOVUxMID0gaGFuZGxlcnMucmVzb2x2ZShuZXcgUHJvbWlzZShJTlRFUk5BTCksIG51bGwpO1xudmFyIFVOREVGSU5FRCA9IGhhbmRsZXJzLnJlc29sdmUobmV3IFByb21pc2UoSU5URVJOQUwpLCB2b2lkIDApO1xudmFyIFpFUk8gPSBoYW5kbGVycy5yZXNvbHZlKG5ldyBQcm9taXNlKElOVEVSTkFMKSwgMCk7XG52YXIgRU1QVFlTVFJJTkcgPSBoYW5kbGVycy5yZXNvbHZlKG5ldyBQcm9taXNlKElOVEVSTkFMKSwgJycpO1xuXG5mdW5jdGlvbiByZXNvbHZlKHZhbHVlKSB7XG4gIGlmICh2YWx1ZSkge1xuICAgIGlmICh2YWx1ZSBpbnN0YW5jZW9mIFByb21pc2UpIHtcbiAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9XG4gICAgcmV0dXJuIGhhbmRsZXJzLnJlc29sdmUobmV3IFByb21pc2UoSU5URVJOQUwpLCB2YWx1ZSk7XG4gIH1cbiAgdmFyIHZhbHVlVHlwZSA9IHR5cGVvZiB2YWx1ZTtcbiAgc3dpdGNoICh2YWx1ZVR5cGUpIHtcbiAgICBjYXNlICdib29sZWFuJzpcbiAgICAgIHJldHVybiBGQUxTRTtcbiAgICBjYXNlICd1bmRlZmluZWQnOlxuICAgICAgcmV0dXJuIFVOREVGSU5FRDtcbiAgICBjYXNlICdvYmplY3QnOlxuICAgICAgcmV0dXJuIE5VTEw7XG4gICAgY2FzZSAnbnVtYmVyJzpcbiAgICAgIHJldHVybiBaRVJPO1xuICAgIGNhc2UgJ3N0cmluZyc6XG4gICAgICByZXR1cm4gRU1QVFlTVFJJTkc7XG4gIH1cbn0iLCIndXNlIHN0cmljdCc7XG52YXIgaGFuZGxlcnMgPSByZXF1aXJlKCcuL2hhbmRsZXJzJyk7XG52YXIgdHJ5Q2F0Y2ggPSByZXF1aXJlKCcuL3RyeUNhdGNoJyk7XG5mdW5jdGlvbiBzYWZlbHlSZXNvbHZlVGhlbmFibGUoc2VsZiwgdGhlbmFibGUpIHtcbiAgLy8gRWl0aGVyIGZ1bGZpbGwsIHJlamVjdCBvciByZWplY3Qgd2l0aCBlcnJvclxuICB2YXIgY2FsbGVkID0gZmFsc2U7XG4gIGZ1bmN0aW9uIG9uRXJyb3IodmFsdWUpIHtcbiAgICBpZiAoY2FsbGVkKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNhbGxlZCA9IHRydWU7XG4gICAgaGFuZGxlcnMucmVqZWN0KHNlbGYsIHZhbHVlKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIG9uU3VjY2Vzcyh2YWx1ZSkge1xuICAgIGlmIChjYWxsZWQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY2FsbGVkID0gdHJ1ZTtcbiAgICBoYW5kbGVycy5yZXNvbHZlKHNlbGYsIHZhbHVlKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHRyeVRvVW53cmFwKCkge1xuICAgIHRoZW5hYmxlKG9uU3VjY2Vzcywgb25FcnJvcik7XG4gIH1cbiAgXG4gIHZhciByZXN1bHQgPSB0cnlDYXRjaCh0cnlUb1Vud3JhcCk7XG4gIGlmIChyZXN1bHQuc3RhdHVzID09PSAnZXJyb3InKSB7XG4gICAgb25FcnJvcihyZXN1bHQudmFsdWUpO1xuICB9XG59XG5leHBvcnRzLnNhZmVseSA9IHNhZmVseVJlc29sdmVUaGVuYWJsZTsiLCIvLyBMYXp5IG1hbidzIHN5bWJvbHMgZm9yIHN0YXRlc1xuXG5leHBvcnRzLlJFSkVDVEVEID0gWydSRUpFQ1RFRCddO1xuZXhwb3J0cy5GVUxGSUxMRUQgPSBbJ0ZVTEZJTExFRCddO1xuZXhwb3J0cy5QRU5ESU5HID0gWydQRU5ESU5HJ107IiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IHRyeUNhdGNoO1xuXG5mdW5jdGlvbiB0cnlDYXRjaChmdW5jLCB2YWx1ZSkge1xuICB2YXIgb3V0ID0ge307XG4gIHRyeSB7XG4gICAgb3V0LnZhbHVlID0gZnVuYyh2YWx1ZSk7XG4gICAgb3V0LnN0YXR1cyA9ICdzdWNjZXNzJztcbiAgfSBjYXRjaCAoZSkge1xuICAgIG91dC5zdGF0dXMgPSAnZXJyb3InO1xuICAgIG91dC52YWx1ZSA9IGU7XG4gIH1cbiAgcmV0dXJuIG91dDtcbn0iLCIndXNlIHN0cmljdCc7XG5cbnZhciBpbW1lZGlhdGUgPSByZXF1aXJlKCdpbW1lZGlhdGUnKTtcbnZhciBoYW5kbGVycyA9IHJlcXVpcmUoJy4vaGFuZGxlcnMnKTtcbm1vZHVsZS5leHBvcnRzID0gdW53cmFwO1xuXG5mdW5jdGlvbiB1bndyYXAocHJvbWlzZSwgZnVuYywgdmFsdWUpIHtcbiAgaW1tZWRpYXRlKGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgcmV0dXJuVmFsdWU7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVyblZhbHVlID0gZnVuYyh2YWx1ZSk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgcmV0dXJuIGhhbmRsZXJzLnJlamVjdChwcm9taXNlLCBlKTtcbiAgICB9XG4gICAgaWYgKHJldHVyblZhbHVlID09PSBwcm9taXNlKSB7XG4gICAgICBoYW5kbGVycy5yZWplY3QocHJvbWlzZSwgbmV3IFR5cGVFcnJvcignQ2Fubm90IHJlc29sdmUgcHJvbWlzZSB3aXRoIGl0c2VsZicpKTtcbiAgICB9IGVsc2Uge1xuICAgICAgaGFuZGxlcnMucmVzb2x2ZShwcm9taXNlLCByZXR1cm5WYWx1ZSk7XG4gICAgfVxuICB9KTtcbn0iLCIndXNlIHN0cmljdCc7XG52YXIgdHlwZXMgPSBbXG4gIHJlcXVpcmUoJy4vbmV4dFRpY2snKSxcbiAgcmVxdWlyZSgnLi9tdXRhdGlvbi5qcycpLFxuICByZXF1aXJlKCcuL21lc3NhZ2VDaGFubmVsJyksXG4gIHJlcXVpcmUoJy4vc3RhdGVDaGFuZ2UnKSxcbiAgcmVxdWlyZSgnLi90aW1lb3V0Jylcbl07XG52YXIgZHJhaW5pbmc7XG52YXIgY3VycmVudFF1ZXVlO1xudmFyIHF1ZXVlSW5kZXggPSAtMTtcbnZhciBxdWV1ZSA9IFtdO1xuZnVuY3Rpb24gY2xlYW5VcE5leHRUaWNrKCkge1xuICAgIGRyYWluaW5nID0gZmFsc2U7XG4gICAgaWYgKGN1cnJlbnRRdWV1ZSAmJiBjdXJyZW50UXVldWUubGVuZ3RoKSB7XG4gICAgICBxdWV1ZSA9IGN1cnJlbnRRdWV1ZS5jb25jYXQocXVldWUpO1xuICAgIH0gZWxzZSB7XG4gICAgICBxdWV1ZUluZGV4ID0gLTE7XG4gICAgfVxuICAgIGlmIChxdWV1ZS5sZW5ndGgpIHtcbiAgICAgIG5leHRUaWNrKCk7XG4gICAgfVxufVxuXG4vL25hbWVkIG5leHRUaWNrIGZvciBsZXNzIGNvbmZ1c2luZyBzdGFjayB0cmFjZXNcbmZ1bmN0aW9uIG5leHRUaWNrKCkge1xuICBkcmFpbmluZyA9IHRydWU7XG4gIHZhciBsZW4gPSBxdWV1ZS5sZW5ndGg7XG4gIHZhciB0aW1lb3V0ID0gc2V0VGltZW91dChjbGVhblVwTmV4dFRpY2spO1xuICB3aGlsZSAobGVuKSB7XG4gICAgY3VycmVudFF1ZXVlID0gcXVldWU7XG4gICAgcXVldWUgPSBbXTtcbiAgICB3aGlsZSAoKytxdWV1ZUluZGV4IDwgbGVuKSB7XG4gICAgICBjdXJyZW50UXVldWVbcXVldWVJbmRleF0oKTtcbiAgICB9XG4gICAgcXVldWVJbmRleCA9IC0xO1xuICAgIGxlbiA9IHF1ZXVlLmxlbmd0aDtcbiAgfVxuICBxdWV1ZUluZGV4ID0gLTE7XG4gIGRyYWluaW5nID0gZmFsc2U7XG4gIGNsZWFyVGltZW91dCh0aW1lb3V0KTtcbn1cbnZhciBzY2hlZHVsZURyYWluO1xudmFyIGkgPSAtMTtcbnZhciBsZW4gPSB0eXBlcy5sZW5ndGg7XG53aGlsZSAoKysgaSA8IGxlbikge1xuICBpZiAodHlwZXNbaV0gJiYgdHlwZXNbaV0udGVzdCAmJiB0eXBlc1tpXS50ZXN0KCkpIHtcbiAgICBzY2hlZHVsZURyYWluID0gdHlwZXNbaV0uaW5zdGFsbChuZXh0VGljayk7XG4gICAgYnJlYWs7XG4gIH1cbn1cbm1vZHVsZS5leHBvcnRzID0gaW1tZWRpYXRlO1xuZnVuY3Rpb24gaW1tZWRpYXRlKHRhc2spIHtcbiAgaWYgKHF1ZXVlLnB1c2godGFzaykgPT09IDEgJiYgIWRyYWluaW5nKSB7XG4gICAgc2NoZWR1bGVEcmFpbigpO1xuICB9XG59IiwiJ3VzZSBzdHJpY3QnO1xuXG5leHBvcnRzLnRlc3QgPSBmdW5jdGlvbiAoKSB7XG4gIGlmIChnbG9iYWwuc2V0SW1tZWRpYXRlKSB7XG4gICAgLy8gd2UgY2FuIG9ubHkgZ2V0IGhlcmUgaW4gSUUxMFxuICAgIC8vIHdoaWNoIGRvZXNuJ3QgaGFuZGVsIHBvc3RNZXNzYWdlIHdlbGxcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgcmV0dXJuIHR5cGVvZiBnbG9iYWwuTWVzc2FnZUNoYW5uZWwgIT09ICd1bmRlZmluZWQnO1xufTtcblxuZXhwb3J0cy5pbnN0YWxsID0gZnVuY3Rpb24gKGZ1bmMpIHtcbiAgdmFyIGNoYW5uZWwgPSBuZXcgZ2xvYmFsLk1lc3NhZ2VDaGFubmVsKCk7XG4gIGNoYW5uZWwucG9ydDEub25tZXNzYWdlID0gZnVuYztcbiAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICBjaGFubmVsLnBvcnQyLnBvc3RNZXNzYWdlKDApO1xuICB9O1xufTsiLCIndXNlIHN0cmljdCc7XG4vL2Jhc2VkIG9mZiByc3ZwIGh0dHBzOi8vZ2l0aHViLmNvbS90aWxkZWlvL3JzdnAuanNcbi8vbGljZW5zZSBodHRwczovL2dpdGh1Yi5jb20vdGlsZGVpby9yc3ZwLmpzL2Jsb2IvbWFzdGVyL0xJQ0VOU0Vcbi8vaHR0cHM6Ly9naXRodWIuY29tL3RpbGRlaW8vcnN2cC5qcy9ibG9iL21hc3Rlci9saWIvcnN2cC9hc2FwLmpzXG5cbnZhciBNdXRhdGlvbiA9IGdsb2JhbC5NdXRhdGlvbk9ic2VydmVyIHx8IGdsb2JhbC5XZWJLaXRNdXRhdGlvbk9ic2VydmVyO1xuXG5leHBvcnRzLnRlc3QgPSBmdW5jdGlvbiAoKSB7XG4gIHJldHVybiBNdXRhdGlvbjtcbn07XG5cbmV4cG9ydHMuaW5zdGFsbCA9IGZ1bmN0aW9uIChoYW5kbGUpIHtcbiAgdmFyIGNhbGxlZCA9IDA7XG4gIHZhciBvYnNlcnZlciA9IG5ldyBNdXRhdGlvbihoYW5kbGUpO1xuICB2YXIgZWxlbWVudCA9IGdsb2JhbC5kb2N1bWVudC5jcmVhdGVUZXh0Tm9kZSgnJyk7XG4gIG9ic2VydmVyLm9ic2VydmUoZWxlbWVudCwge1xuICAgIGNoYXJhY3RlckRhdGE6IHRydWVcbiAgfSk7XG4gIHJldHVybiBmdW5jdGlvbiAoKSB7XG4gICAgZWxlbWVudC5kYXRhID0gKGNhbGxlZCA9ICsrY2FsbGVkICUgMik7XG4gIH07XG59OyIsIid1c2Ugc3RyaWN0JztcblxuZXhwb3J0cy50ZXN0ID0gZnVuY3Rpb24gKCkge1xuICByZXR1cm4gJ2RvY3VtZW50JyBpbiBnbG9iYWwgJiYgJ29ucmVhZHlzdGF0ZWNoYW5nZScgaW4gZ2xvYmFsLmRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3NjcmlwdCcpO1xufTtcblxuZXhwb3J0cy5pbnN0YWxsID0gZnVuY3Rpb24gKGhhbmRsZSkge1xuICByZXR1cm4gZnVuY3Rpb24gKCkge1xuXG4gICAgLy8gQ3JlYXRlIGEgPHNjcmlwdD4gZWxlbWVudDsgaXRzIHJlYWR5c3RhdGVjaGFuZ2UgZXZlbnQgd2lsbCBiZSBmaXJlZCBhc3luY2hyb25vdXNseSBvbmNlIGl0IGlzIGluc2VydGVkXG4gICAgLy8gaW50byB0aGUgZG9jdW1lbnQuIERvIHNvLCB0aHVzIHF1ZXVpbmcgdXAgdGhlIHRhc2suIFJlbWVtYmVyIHRvIGNsZWFuIHVwIG9uY2UgaXQncyBiZWVuIGNhbGxlZC5cbiAgICB2YXIgc2NyaXB0RWwgPSBnbG9iYWwuZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc2NyaXB0Jyk7XG4gICAgc2NyaXB0RWwub25yZWFkeXN0YXRlY2hhbmdlID0gZnVuY3Rpb24gKCkge1xuICAgICAgaGFuZGxlKCk7XG5cbiAgICAgIHNjcmlwdEVsLm9ucmVhZHlzdGF0ZWNoYW5nZSA9IG51bGw7XG4gICAgICBzY3JpcHRFbC5wYXJlbnROb2RlLnJlbW92ZUNoaWxkKHNjcmlwdEVsKTtcbiAgICAgIHNjcmlwdEVsID0gbnVsbDtcbiAgICB9O1xuICAgIGdsb2JhbC5kb2N1bWVudC5kb2N1bWVudEVsZW1lbnQuYXBwZW5kQ2hpbGQoc2NyaXB0RWwpO1xuXG4gICAgcmV0dXJuIGhhbmRsZTtcbiAgfTtcbn07IiwiJ3VzZSBzdHJpY3QnO1xuZXhwb3J0cy50ZXN0ID0gZnVuY3Rpb24gKCkge1xuICByZXR1cm4gdHJ1ZTtcbn07XG5cbmV4cG9ydHMuaW5zdGFsbCA9IGZ1bmN0aW9uICh0KSB7XG4gIHJldHVybiBmdW5jdGlvbiAoKSB7XG4gICAgc2V0VGltZW91dCh0LCAwKTtcbiAgfTtcbn07IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgTUlOX01BR05JVFVERSA9IC0zMjQ7IC8vIHZlcmlmaWVkIGJ5IC1OdW1iZXIuTUlOX1ZBTFVFXG52YXIgTUFHTklUVURFX0RJR0lUUyA9IDM7IC8vIGRpdHRvXG52YXIgU0VQID0gJyc7IC8vIHNldCB0byAnXycgZm9yIGVhc2llciBkZWJ1Z2dpbmcgXG5cbnZhciB1dGlscyA9IHJlcXVpcmUoJy4vdXRpbHMnKTtcblxuZXhwb3J0cy5jb2xsYXRlID0gZnVuY3Rpb24gKGEsIGIpIHtcblxuICBpZiAoYSA9PT0gYikge1xuICAgIHJldHVybiAwO1xuICB9XG5cbiAgYSA9IGV4cG9ydHMubm9ybWFsaXplS2V5KGEpO1xuICBiID0gZXhwb3J0cy5ub3JtYWxpemVLZXkoYik7XG5cbiAgdmFyIGFpID0gY29sbGF0aW9uSW5kZXgoYSk7XG4gIHZhciBiaSA9IGNvbGxhdGlvbkluZGV4KGIpO1xuICBpZiAoKGFpIC0gYmkpICE9PSAwKSB7XG4gICAgcmV0dXJuIGFpIC0gYmk7XG4gIH1cbiAgaWYgKGEgPT09IG51bGwpIHtcbiAgICByZXR1cm4gMDtcbiAgfVxuICBzd2l0Y2ggKHR5cGVvZiBhKSB7XG4gICAgY2FzZSAnbnVtYmVyJzpcbiAgICAgIHJldHVybiBhIC0gYjtcbiAgICBjYXNlICdib29sZWFuJzpcbiAgICAgIHJldHVybiBhID09PSBiID8gMCA6IChhIDwgYiA/IC0xIDogMSk7XG4gICAgY2FzZSAnc3RyaW5nJzpcbiAgICAgIHJldHVybiBzdHJpbmdDb2xsYXRlKGEsIGIpO1xuICB9XG4gIHJldHVybiBBcnJheS5pc0FycmF5KGEpID8gYXJyYXlDb2xsYXRlKGEsIGIpIDogb2JqZWN0Q29sbGF0ZShhLCBiKTtcbn07XG5cbi8vIGNvdWNoIGNvbnNpZGVycyBudWxsL05hTi9JbmZpbml0eS8tSW5maW5pdHkgPT09IHVuZGVmaW5lZCxcbi8vIGZvciB0aGUgcHVycG9zZXMgb2YgbWFwcmVkdWNlIGluZGV4ZXMuIGFsc28sIGRhdGVzIGdldCBzdHJpbmdpZmllZC5cbmV4cG9ydHMubm9ybWFsaXplS2V5ID0gZnVuY3Rpb24gKGtleSkge1xuICBzd2l0Y2ggKHR5cGVvZiBrZXkpIHtcbiAgICBjYXNlICd1bmRlZmluZWQnOlxuICAgICAgcmV0dXJuIG51bGw7XG4gICAgY2FzZSAnbnVtYmVyJzpcbiAgICAgIGlmIChrZXkgPT09IEluZmluaXR5IHx8IGtleSA9PT0gLUluZmluaXR5IHx8IGlzTmFOKGtleSkpIHtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICB9XG4gICAgICByZXR1cm4ga2V5O1xuICAgIGNhc2UgJ29iamVjdCc6XG4gICAgICB2YXIgb3JpZ0tleSA9IGtleTtcbiAgICAgIGlmIChBcnJheS5pc0FycmF5KGtleSkpIHtcbiAgICAgICAgdmFyIGxlbiA9IGtleS5sZW5ndGg7XG4gICAgICAgIGtleSA9IG5ldyBBcnJheShsZW4pO1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgICAgICAga2V5W2ldID0gZXhwb3J0cy5ub3JtYWxpemVLZXkob3JpZ0tleVtpXSk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAoa2V5IGluc3RhbmNlb2YgRGF0ZSkge1xuICAgICAgICByZXR1cm4ga2V5LnRvSlNPTigpO1xuICAgICAgfSBlbHNlIGlmIChrZXkgIT09IG51bGwpIHsgLy8gZ2VuZXJpYyBvYmplY3RcbiAgICAgICAga2V5ID0ge307XG4gICAgICAgIGZvciAodmFyIGsgaW4gb3JpZ0tleSkge1xuICAgICAgICAgIGlmIChvcmlnS2V5Lmhhc093blByb3BlcnR5KGspKSB7XG4gICAgICAgICAgICB2YXIgdmFsID0gb3JpZ0tleVtrXTtcbiAgICAgICAgICAgIGlmICh0eXBlb2YgdmFsICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgICAgICAgICBrZXlba10gPSBleHBvcnRzLm5vcm1hbGl6ZUtleSh2YWwpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICB9XG4gIHJldHVybiBrZXk7XG59O1xuXG5mdW5jdGlvbiBpbmRleGlmeShrZXkpIHtcbiAgaWYgKGtleSAhPT0gbnVsbCkge1xuICAgIHN3aXRjaCAodHlwZW9mIGtleSkge1xuICAgICAgY2FzZSAnYm9vbGVhbic6XG4gICAgICAgIHJldHVybiBrZXkgPyAxIDogMDtcbiAgICAgIGNhc2UgJ251bWJlcic6XG4gICAgICAgIHJldHVybiBudW1Ub0luZGV4YWJsZVN0cmluZyhrZXkpO1xuICAgICAgY2FzZSAnc3RyaW5nJzpcbiAgICAgICAgLy8gV2UndmUgdG8gYmUgc3VyZSB0aGF0IGtleSBkb2VzIG5vdCBjb250YWluIFxcdTAwMDBcbiAgICAgICAgLy8gRG8gb3JkZXItcHJlc2VydmluZyByZXBsYWNlbWVudHM6XG4gICAgICAgIC8vIDAgLT4gMSwgMVxuICAgICAgICAvLyAxIC0+IDEsIDJcbiAgICAgICAgLy8gMiAtPiAyLCAyXG4gICAgICAgIHJldHVybiBrZXlcbiAgICAgICAgICAucmVwbGFjZSgvXFx1MDAwMi9nLCAnXFx1MDAwMlxcdTAwMDInKVxuICAgICAgICAgIC5yZXBsYWNlKC9cXHUwMDAxL2csICdcXHUwMDAxXFx1MDAwMicpXG4gICAgICAgICAgLnJlcGxhY2UoL1xcdTAwMDAvZywgJ1xcdTAwMDFcXHUwMDAxJyk7XG4gICAgICBjYXNlICdvYmplY3QnOlxuICAgICAgICB2YXIgaXNBcnJheSA9IEFycmF5LmlzQXJyYXkoa2V5KTtcbiAgICAgICAgdmFyIGFyciA9IGlzQXJyYXkgPyBrZXkgOiBPYmplY3Qua2V5cyhrZXkpO1xuICAgICAgICB2YXIgaSA9IC0xO1xuICAgICAgICB2YXIgbGVuID0gYXJyLmxlbmd0aDtcbiAgICAgICAgdmFyIHJlc3VsdCA9ICcnO1xuICAgICAgICBpZiAoaXNBcnJheSkge1xuICAgICAgICAgIHdoaWxlICgrK2kgPCBsZW4pIHtcbiAgICAgICAgICAgIHJlc3VsdCArPSBleHBvcnRzLnRvSW5kZXhhYmxlU3RyaW5nKGFycltpXSk7XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHdoaWxlICgrK2kgPCBsZW4pIHtcbiAgICAgICAgICAgIHZhciBvYmpLZXkgPSBhcnJbaV07XG4gICAgICAgICAgICByZXN1bHQgKz0gZXhwb3J0cy50b0luZGV4YWJsZVN0cmluZyhvYmpLZXkpICtcbiAgICAgICAgICAgICAgICBleHBvcnRzLnRvSW5kZXhhYmxlU3RyaW5nKGtleVtvYmpLZXldKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9XG4gIH1cbiAgcmV0dXJuICcnO1xufVxuXG4vLyBjb252ZXJ0IHRoZSBnaXZlbiBrZXkgdG8gYSBzdHJpbmcgdGhhdCB3b3VsZCBiZSBhcHByb3ByaWF0ZVxuLy8gZm9yIGxleGljYWwgc29ydGluZywgZS5nLiB3aXRoaW4gYSBkYXRhYmFzZSwgd2hlcmUgdGhlXG4vLyBzb3J0aW5nIGlzIHRoZSBzYW1lIGdpdmVuIGJ5IHRoZSBjb2xsYXRlKCkgZnVuY3Rpb24uXG5leHBvcnRzLnRvSW5kZXhhYmxlU3RyaW5nID0gZnVuY3Rpb24gKGtleSkge1xuICB2YXIgemVybyA9ICdcXHUwMDAwJztcbiAga2V5ID0gZXhwb3J0cy5ub3JtYWxpemVLZXkoa2V5KTtcbiAgcmV0dXJuIGNvbGxhdGlvbkluZGV4KGtleSkgKyBTRVAgKyBpbmRleGlmeShrZXkpICsgemVybztcbn07XG5cbmZ1bmN0aW9uIHBhcnNlTnVtYmVyKHN0ciwgaSkge1xuICB2YXIgb3JpZ2luYWxJZHggPSBpO1xuICB2YXIgbnVtO1xuICB2YXIgemVybyA9IHN0cltpXSA9PT0gJzEnO1xuICBpZiAoemVybykge1xuICAgIG51bSA9IDA7XG4gICAgaSsrO1xuICB9IGVsc2Uge1xuICAgIHZhciBuZWcgPSBzdHJbaV0gPT09ICcwJztcbiAgICBpKys7XG4gICAgdmFyIG51bUFzU3RyaW5nID0gJyc7XG4gICAgdmFyIG1hZ0FzU3RyaW5nID0gc3RyLnN1YnN0cmluZyhpLCBpICsgTUFHTklUVURFX0RJR0lUUyk7XG4gICAgdmFyIG1hZ25pdHVkZSA9IHBhcnNlSW50KG1hZ0FzU3RyaW5nLCAxMCkgKyBNSU5fTUFHTklUVURFO1xuICAgIGlmIChuZWcpIHtcbiAgICAgIG1hZ25pdHVkZSA9IC1tYWduaXR1ZGU7XG4gICAgfVxuICAgIGkgKz0gTUFHTklUVURFX0RJR0lUUztcbiAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgdmFyIGNoID0gc3RyW2ldO1xuICAgICAgaWYgKGNoID09PSAnXFx1MDAwMCcpIHtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBudW1Bc1N0cmluZyArPSBjaDtcbiAgICAgIH1cbiAgICAgIGkrKztcbiAgICB9XG4gICAgbnVtQXNTdHJpbmcgPSBudW1Bc1N0cmluZy5zcGxpdCgnLicpO1xuICAgIGlmIChudW1Bc1N0cmluZy5sZW5ndGggPT09IDEpIHtcbiAgICAgIG51bSA9IHBhcnNlSW50KG51bUFzU3RyaW5nLCAxMCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIG51bSA9IHBhcnNlRmxvYXQobnVtQXNTdHJpbmdbMF0gKyAnLicgKyBudW1Bc1N0cmluZ1sxXSk7XG4gICAgfVxuICAgIGlmIChuZWcpIHtcbiAgICAgIG51bSA9IG51bSAtIDEwO1xuICAgIH1cbiAgICBpZiAobWFnbml0dWRlICE9PSAwKSB7XG4gICAgICAvLyBwYXJzZUZsb2F0IGlzIG1vcmUgcmVsaWFibGUgdGhhbiBwb3cgZHVlIHRvIHJvdW5kaW5nIGVycm9yc1xuICAgICAgLy8gZS5nLiBOdW1iZXIuTUFYX1ZBTFVFIHdvdWxkIHJldHVybiBJbmZpbml0eSBpZiB3ZSBkaWRcbiAgICAgIC8vIG51bSAqIE1hdGgucG93KDEwLCBtYWduaXR1ZGUpO1xuICAgICAgbnVtID0gcGFyc2VGbG9hdChudW0gKyAnZScgKyBtYWduaXR1ZGUpO1xuICAgIH1cbiAgfVxuICByZXR1cm4ge251bTogbnVtLCBsZW5ndGggOiBpIC0gb3JpZ2luYWxJZHh9O1xufVxuXG4vLyBtb3ZlIHVwIHRoZSBzdGFjayB3aGlsZSBwYXJzaW5nXG4vLyB0aGlzIGZ1bmN0aW9uIG1vdmVkIG91dHNpZGUgb2YgcGFyc2VJbmRleGFibGVTdHJpbmcgZm9yIHBlcmZvcm1hbmNlXG5mdW5jdGlvbiBwb3Aoc3RhY2ssIG1ldGFTdGFjaykge1xuICB2YXIgb2JqID0gc3RhY2sucG9wKCk7XG5cbiAgaWYgKG1ldGFTdGFjay5sZW5ndGgpIHtcbiAgICB2YXIgbGFzdE1ldGFFbGVtZW50ID0gbWV0YVN0YWNrW21ldGFTdGFjay5sZW5ndGggLSAxXTtcbiAgICBpZiAob2JqID09PSBsYXN0TWV0YUVsZW1lbnQuZWxlbWVudCkge1xuICAgICAgLy8gcG9wcGluZyBhIG1ldGEtZWxlbWVudCwgZS5nLiBhbiBvYmplY3Qgd2hvc2UgdmFsdWUgaXMgYW5vdGhlciBvYmplY3RcbiAgICAgIG1ldGFTdGFjay5wb3AoKTtcbiAgICAgIGxhc3RNZXRhRWxlbWVudCA9IG1ldGFTdGFja1ttZXRhU3RhY2subGVuZ3RoIC0gMV07XG4gICAgfVxuICAgIHZhciBlbGVtZW50ID0gbGFzdE1ldGFFbGVtZW50LmVsZW1lbnQ7XG4gICAgdmFyIGxhc3RFbGVtZW50SW5kZXggPSBsYXN0TWV0YUVsZW1lbnQuaW5kZXg7XG4gICAgaWYgKEFycmF5LmlzQXJyYXkoZWxlbWVudCkpIHtcbiAgICAgIGVsZW1lbnQucHVzaChvYmopO1xuICAgIH0gZWxzZSBpZiAobGFzdEVsZW1lbnRJbmRleCA9PT0gc3RhY2subGVuZ3RoIC0gMikgeyAvLyBvYmogd2l0aCBrZXkrdmFsdWVcbiAgICAgIHZhciBrZXkgPSBzdGFjay5wb3AoKTtcbiAgICAgIGVsZW1lbnRba2V5XSA9IG9iajtcbiAgICB9IGVsc2Uge1xuICAgICAgc3RhY2sucHVzaChvYmopOyAvLyBvYmogd2l0aCBrZXkgb25seVxuICAgIH1cbiAgfVxufVxuXG5leHBvcnRzLnBhcnNlSW5kZXhhYmxlU3RyaW5nID0gZnVuY3Rpb24gKHN0cikge1xuICB2YXIgc3RhY2sgPSBbXTtcbiAgdmFyIG1ldGFTdGFjayA9IFtdOyAvLyBzdGFjayBmb3IgYXJyYXlzIGFuZCBvYmplY3RzXG4gIHZhciBpID0gMDtcblxuICB3aGlsZSAodHJ1ZSkge1xuICAgIHZhciBjb2xsYXRpb25JbmRleCA9IHN0cltpKytdO1xuICAgIGlmIChjb2xsYXRpb25JbmRleCA9PT0gJ1xcdTAwMDAnKSB7XG4gICAgICBpZiAoc3RhY2subGVuZ3RoID09PSAxKSB7XG4gICAgICAgIHJldHVybiBzdGFjay5wb3AoKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHBvcChzdGFjaywgbWV0YVN0YWNrKTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgfVxuICAgIHN3aXRjaCAoY29sbGF0aW9uSW5kZXgpIHtcbiAgICAgIGNhc2UgJzEnOlxuICAgICAgICBzdGFjay5wdXNoKG51bGwpO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJzInOlxuICAgICAgICBzdGFjay5wdXNoKHN0cltpXSA9PT0gJzEnKTtcbiAgICAgICAgaSsrO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJzMnOlxuICAgICAgICB2YXIgcGFyc2VkTnVtID0gcGFyc2VOdW1iZXIoc3RyLCBpKTtcbiAgICAgICAgc3RhY2sucHVzaChwYXJzZWROdW0ubnVtKTtcbiAgICAgICAgaSArPSBwYXJzZWROdW0ubGVuZ3RoO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJzQnOlxuICAgICAgICB2YXIgcGFyc2VkU3RyID0gJyc7XG4gICAgICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICAgICAgdmFyIGNoID0gc3RyW2ldO1xuICAgICAgICAgIGlmIChjaCA9PT0gJ1xcdTAwMDAnKSB7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgICAgcGFyc2VkU3RyICs9IGNoO1xuICAgICAgICAgIGkrKztcbiAgICAgICAgfVxuICAgICAgICAvLyBwZXJmb3JtIHRoZSByZXZlcnNlIG9mIHRoZSBvcmRlci1wcmVzZXJ2aW5nIHJlcGxhY2VtZW50XG4gICAgICAgIC8vIGFsZ29yaXRobSAoc2VlIGFib3ZlKVxuICAgICAgICBwYXJzZWRTdHIgPSBwYXJzZWRTdHIucmVwbGFjZSgvXFx1MDAwMVxcdTAwMDEvZywgJ1xcdTAwMDAnKVxuICAgICAgICAgIC5yZXBsYWNlKC9cXHUwMDAxXFx1MDAwMi9nLCAnXFx1MDAwMScpXG4gICAgICAgICAgLnJlcGxhY2UoL1xcdTAwMDJcXHUwMDAyL2csICdcXHUwMDAyJyk7XG4gICAgICAgIHN0YWNrLnB1c2gocGFyc2VkU3RyKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICc1JzpcbiAgICAgICAgdmFyIGFycmF5RWxlbWVudCA9IHsgZWxlbWVudDogW10sIGluZGV4OiBzdGFjay5sZW5ndGggfTtcbiAgICAgICAgc3RhY2sucHVzaChhcnJheUVsZW1lbnQuZWxlbWVudCk7XG4gICAgICAgIG1ldGFTdGFjay5wdXNoKGFycmF5RWxlbWVudCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnNic6XG4gICAgICAgIHZhciBvYmpFbGVtZW50ID0geyBlbGVtZW50OiB7fSwgaW5kZXg6IHN0YWNrLmxlbmd0aCB9O1xuICAgICAgICBzdGFjay5wdXNoKG9iakVsZW1lbnQuZWxlbWVudCk7XG4gICAgICAgIG1ldGFTdGFjay5wdXNoKG9iakVsZW1lbnQpO1xuICAgICAgICBicmVhaztcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICAnYmFkIGNvbGxhdGlvbkluZGV4IG9yIHVuZXhwZWN0ZWRseSByZWFjaGVkIGVuZCBvZiBpbnB1dDogJyArIGNvbGxhdGlvbkluZGV4KTtcbiAgICB9XG4gIH1cbn07XG5cbmZ1bmN0aW9uIGFycmF5Q29sbGF0ZShhLCBiKSB7XG4gIHZhciBsZW4gPSBNYXRoLm1pbihhLmxlbmd0aCwgYi5sZW5ndGgpO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgdmFyIHNvcnQgPSBleHBvcnRzLmNvbGxhdGUoYVtpXSwgYltpXSk7XG4gICAgaWYgKHNvcnQgIT09IDApIHtcbiAgICAgIHJldHVybiBzb3J0O1xuICAgIH1cbiAgfVxuICByZXR1cm4gKGEubGVuZ3RoID09PSBiLmxlbmd0aCkgPyAwIDpcbiAgICAoYS5sZW5ndGggPiBiLmxlbmd0aCkgPyAxIDogLTE7XG59XG5mdW5jdGlvbiBzdHJpbmdDb2xsYXRlKGEsIGIpIHtcbiAgLy8gU2VlOiBodHRwczovL2dpdGh1Yi5jb20vZGFsZWhhcnZleS9wb3VjaGRiL2lzc3Vlcy80MFxuICAvLyBUaGlzIGlzIGluY29tcGF0aWJsZSB3aXRoIHRoZSBDb3VjaERCIGltcGxlbWVudGF0aW9uLCBidXQgaXRzIHRoZVxuICAvLyBiZXN0IHdlIGNhbiBkbyBmb3Igbm93XG4gIHJldHVybiAoYSA9PT0gYikgPyAwIDogKChhID4gYikgPyAxIDogLTEpO1xufVxuZnVuY3Rpb24gb2JqZWN0Q29sbGF0ZShhLCBiKSB7XG4gIHZhciBhayA9IE9iamVjdC5rZXlzKGEpLCBiayA9IE9iamVjdC5rZXlzKGIpO1xuICB2YXIgbGVuID0gTWF0aC5taW4oYWsubGVuZ3RoLCBiay5sZW5ndGgpO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgLy8gRmlyc3Qgc29ydCB0aGUga2V5c1xuICAgIHZhciBzb3J0ID0gZXhwb3J0cy5jb2xsYXRlKGFrW2ldLCBia1tpXSk7XG4gICAgaWYgKHNvcnQgIT09IDApIHtcbiAgICAgIHJldHVybiBzb3J0O1xuICAgIH1cbiAgICAvLyBpZiB0aGUga2V5cyBhcmUgZXF1YWwgc29ydCB0aGUgdmFsdWVzXG4gICAgc29ydCA9IGV4cG9ydHMuY29sbGF0ZShhW2FrW2ldXSwgYltia1tpXV0pO1xuICAgIGlmIChzb3J0ICE9PSAwKSB7XG4gICAgICByZXR1cm4gc29ydDtcbiAgICB9XG5cbiAgfVxuICByZXR1cm4gKGFrLmxlbmd0aCA9PT0gYmsubGVuZ3RoKSA/IDAgOlxuICAgIChhay5sZW5ndGggPiBiay5sZW5ndGgpID8gMSA6IC0xO1xufVxuLy8gVGhlIGNvbGxhdGlvbiBpcyBkZWZpbmVkIGJ5IGVybGFuZ3Mgb3JkZXJlZCB0ZXJtc1xuLy8gdGhlIGF0b21zIG51bGwsIHRydWUsIGZhbHNlIGNvbWUgZmlyc3QsIHRoZW4gbnVtYmVycywgc3RyaW5ncyxcbi8vIGFycmF5cywgdGhlbiBvYmplY3RzXG4vLyBudWxsL3VuZGVmaW5lZC9OYU4vSW5maW5pdHkvLUluZmluaXR5IGFyZSBhbGwgY29uc2lkZXJlZCBudWxsXG5mdW5jdGlvbiBjb2xsYXRpb25JbmRleCh4KSB7XG4gIHZhciBpZCA9IFsnYm9vbGVhbicsICdudW1iZXInLCAnc3RyaW5nJywgJ29iamVjdCddO1xuICB2YXIgaWR4ID0gaWQuaW5kZXhPZih0eXBlb2YgeCk7XG4gIC8vZmFsc2UgaWYgLTEgb3RoZXJ3aXNlIHRydWUsIGJ1dCBmYXN0ISEhITFcbiAgaWYgKH5pZHgpIHtcbiAgICBpZiAoeCA9PT0gbnVsbCkge1xuICAgICAgcmV0dXJuIDE7XG4gICAgfVxuICAgIGlmIChBcnJheS5pc0FycmF5KHgpKSB7XG4gICAgICByZXR1cm4gNTtcbiAgICB9XG4gICAgcmV0dXJuIGlkeCA8IDMgPyAoaWR4ICsgMikgOiAoaWR4ICsgMyk7XG4gIH1cbiAgaWYgKEFycmF5LmlzQXJyYXkoeCkpIHtcbiAgICByZXR1cm4gNTtcbiAgfVxufVxuXG4vLyBjb252ZXJzaW9uOlxuLy8geCB5eXkgenouLi56elxuLy8geCA9IDAgZm9yIG5lZ2F0aXZlLCAxIGZvciAwLCAyIGZvciBwb3NpdGl2ZVxuLy8geSA9IGV4cG9uZW50IChmb3IgbmVnYXRpdmUgbnVtYmVycyBuZWdhdGVkKSBtb3ZlZCBzbyB0aGF0IGl0J3MgPj0gMFxuLy8geiA9IG1hbnRpc3NlXG5mdW5jdGlvbiBudW1Ub0luZGV4YWJsZVN0cmluZyhudW0pIHtcblxuICBpZiAobnVtID09PSAwKSB7XG4gICAgcmV0dXJuICcxJztcbiAgfVxuXG4gIC8vIGNvbnZlcnQgbnVtYmVyIHRvIGV4cG9uZW50aWFsIGZvcm1hdCBmb3IgZWFzaWVyIGFuZFxuICAvLyBtb3JlIHN1Y2NpbmN0IHN0cmluZyBzb3J0aW5nXG4gIHZhciBleHBGb3JtYXQgPSBudW0udG9FeHBvbmVudGlhbCgpLnNwbGl0KC9lXFwrPy8pO1xuICB2YXIgbWFnbml0dWRlID0gcGFyc2VJbnQoZXhwRm9ybWF0WzFdLCAxMCk7XG5cbiAgdmFyIG5lZyA9IG51bSA8IDA7XG5cbiAgdmFyIHJlc3VsdCA9IG5lZyA/ICcwJyA6ICcyJztcblxuICAvLyBmaXJzdCBzb3J0IGJ5IG1hZ25pdHVkZVxuICAvLyBpdCdzIGVhc2llciBpZiBhbGwgbWFnbml0dWRlcyBhcmUgcG9zaXRpdmVcbiAgdmFyIG1hZ0ZvckNvbXBhcmlzb24gPSAoKG5lZyA/IC1tYWduaXR1ZGUgOiBtYWduaXR1ZGUpIC0gTUlOX01BR05JVFVERSk7XG4gIHZhciBtYWdTdHJpbmcgPSB1dGlscy5wYWRMZWZ0KChtYWdGb3JDb21wYXJpc29uKS50b1N0cmluZygpLCAnMCcsIE1BR05JVFVERV9ESUdJVFMpO1xuXG4gIHJlc3VsdCArPSBTRVAgKyBtYWdTdHJpbmc7XG5cbiAgLy8gdGhlbiBzb3J0IGJ5IHRoZSBmYWN0b3JcbiAgdmFyIGZhY3RvciA9IE1hdGguYWJzKHBhcnNlRmxvYXQoZXhwRm9ybWF0WzBdKSk7IC8vIFsxLi4xMClcbiAgaWYgKG5lZykgeyAvLyBmb3IgbmVnYXRpdmUgcmV2ZXJzZSBvcmRlcmluZ1xuICAgIGZhY3RvciA9IDEwIC0gZmFjdG9yO1xuICB9XG5cbiAgdmFyIGZhY3RvclN0ciA9IGZhY3Rvci50b0ZpeGVkKDIwKTtcblxuICAvLyBzdHJpcCB6ZXJvcyBmcm9tIHRoZSBlbmRcbiAgZmFjdG9yU3RyID0gZmFjdG9yU3RyLnJlcGxhY2UoL1xcLj8wKyQvLCAnJyk7XG5cbiAgcmVzdWx0ICs9IFNFUCArIGZhY3RvclN0cjtcblxuICByZXR1cm4gcmVzdWx0O1xufVxuIiwiJ3VzZSBzdHJpY3QnO1xuXG5mdW5jdGlvbiBwYWQoc3RyLCBwYWRXaXRoLCB1cFRvTGVuZ3RoKSB7XG4gIHZhciBwYWRkaW5nID0gJyc7XG4gIHZhciB0YXJnZXRMZW5ndGggPSB1cFRvTGVuZ3RoIC0gc3RyLmxlbmd0aDtcbiAgd2hpbGUgKHBhZGRpbmcubGVuZ3RoIDwgdGFyZ2V0TGVuZ3RoKSB7XG4gICAgcGFkZGluZyArPSBwYWRXaXRoO1xuICB9XG4gIHJldHVybiBwYWRkaW5nO1xufVxuXG5leHBvcnRzLnBhZExlZnQgPSBmdW5jdGlvbiAoc3RyLCBwYWRXaXRoLCB1cFRvTGVuZ3RoKSB7XG4gIHZhciBwYWRkaW5nID0gcGFkKHN0ciwgcGFkV2l0aCwgdXBUb0xlbmd0aCk7XG4gIHJldHVybiBwYWRkaW5nICsgc3RyO1xufTtcblxuZXhwb3J0cy5wYWRSaWdodCA9IGZ1bmN0aW9uIChzdHIsIHBhZFdpdGgsIHVwVG9MZW5ndGgpIHtcbiAgdmFyIHBhZGRpbmcgPSBwYWQoc3RyLCBwYWRXaXRoLCB1cFRvTGVuZ3RoKTtcbiAgcmV0dXJuIHN0ciArIHBhZGRpbmc7XG59O1xuXG5leHBvcnRzLnN0cmluZ0xleENvbXBhcmUgPSBmdW5jdGlvbiAoYSwgYikge1xuXG4gIHZhciBhTGVuID0gYS5sZW5ndGg7XG4gIHZhciBiTGVuID0gYi5sZW5ndGg7XG5cbiAgdmFyIGk7XG4gIGZvciAoaSA9IDA7IGkgPCBhTGVuOyBpKyspIHtcbiAgICBpZiAoaSA9PT0gYkxlbikge1xuICAgICAgLy8gYiBpcyBzaG9ydGVyIHN1YnN0cmluZyBvZiBhXG4gICAgICByZXR1cm4gMTtcbiAgICB9XG4gICAgdmFyIGFDaGFyID0gYS5jaGFyQXQoaSk7XG4gICAgdmFyIGJDaGFyID0gYi5jaGFyQXQoaSk7XG4gICAgaWYgKGFDaGFyICE9PSBiQ2hhcikge1xuICAgICAgcmV0dXJuIGFDaGFyIDwgYkNoYXIgPyAtMSA6IDE7XG4gICAgfVxuICB9XG5cbiAgaWYgKGFMZW4gPCBiTGVuKSB7XG4gICAgLy8gYSBpcyBzaG9ydGVyIHN1YnN0cmluZyBvZiBiXG4gICAgcmV0dXJuIC0xO1xuICB9XG5cbiAgcmV0dXJuIDA7XG59O1xuXG4vKlxuICogcmV0dXJucyB0aGUgZGVjaW1hbCBmb3JtIGZvciB0aGUgZ2l2ZW4gaW50ZWdlciwgaS5lLiB3cml0ZXNcbiAqIG91dCBhbGwgdGhlIGRpZ2l0cyAoaW4gYmFzZS0xMCkgaW5zdGVhZCBvZiB1c2luZyBzY2llbnRpZmljIG5vdGF0aW9uXG4gKi9cbmV4cG9ydHMuaW50VG9EZWNpbWFsRm9ybSA9IGZ1bmN0aW9uIChpbnQpIHtcblxuICB2YXIgaXNOZWcgPSBpbnQgPCAwO1xuICB2YXIgcmVzdWx0ID0gJyc7XG5cbiAgZG8ge1xuICAgIHZhciByZW1haW5kZXIgPSBpc05lZyA/IC1NYXRoLmNlaWwoaW50ICUgMTApIDogTWF0aC5mbG9vcihpbnQgJSAxMCk7XG5cbiAgICByZXN1bHQgPSByZW1haW5kZXIgKyByZXN1bHQ7XG4gICAgaW50ID0gaXNOZWcgPyBNYXRoLmNlaWwoaW50IC8gMTApIDogTWF0aC5mbG9vcihpbnQgLyAxMCk7XG4gIH0gd2hpbGUgKGludCk7XG5cblxuICBpZiAoaXNOZWcgJiYgcmVzdWx0ICE9PSAnMCcpIHtcbiAgICByZXN1bHQgPSAnLScgKyByZXN1bHQ7XG4gIH1cblxuICByZXR1cm4gcmVzdWx0O1xufTsiLCIndXNlIHN0cmljdCc7XG5leHBvcnRzLk1hcCA9IExhenlNYXA7IC8vIFRPRE86IHVzZSBFUzYgbWFwXG5leHBvcnRzLlNldCA9IExhenlTZXQ7IC8vIFRPRE86IHVzZSBFUzYgc2V0XG4vLyBiYXNlZCBvbiBodHRwczovL2dpdGh1Yi5jb20vbW9udGFnZWpzL2NvbGxlY3Rpb25zXG5mdW5jdGlvbiBMYXp5TWFwKCkge1xuICB0aGlzLnN0b3JlID0ge307XG59XG5MYXp5TWFwLnByb3RvdHlwZS5tYW5nbGUgPSBmdW5jdGlvbiAoa2V5KSB7XG4gIGlmICh0eXBlb2Yga2V5ICE9PSBcInN0cmluZ1wiKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcImtleSBtdXN0IGJlIGEgc3RyaW5nIGJ1dCBHb3QgXCIgKyBrZXkpO1xuICB9XG4gIHJldHVybiAnJCcgKyBrZXk7XG59O1xuTGF6eU1hcC5wcm90b3R5cGUudW5tYW5nbGUgPSBmdW5jdGlvbiAoa2V5KSB7XG4gIHJldHVybiBrZXkuc3Vic3RyaW5nKDEpO1xufTtcbkxhenlNYXAucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uIChrZXkpIHtcbiAgdmFyIG1hbmdsZWQgPSB0aGlzLm1hbmdsZShrZXkpO1xuICBpZiAobWFuZ2xlZCBpbiB0aGlzLnN0b3JlKSB7XG4gICAgcmV0dXJuIHRoaXMuc3RvcmVbbWFuZ2xlZF07XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIHZvaWQgMDtcbiAgfVxufTtcbkxhenlNYXAucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uIChrZXksIHZhbHVlKSB7XG4gIHZhciBtYW5nbGVkID0gdGhpcy5tYW5nbGUoa2V5KTtcbiAgdGhpcy5zdG9yZVttYW5nbGVkXSA9IHZhbHVlO1xuICByZXR1cm4gdHJ1ZTtcbn07XG5MYXp5TWFwLnByb3RvdHlwZS5oYXMgPSBmdW5jdGlvbiAoa2V5KSB7XG4gIHZhciBtYW5nbGVkID0gdGhpcy5tYW5nbGUoa2V5KTtcbiAgcmV0dXJuIG1hbmdsZWQgaW4gdGhpcy5zdG9yZTtcbn07XG5MYXp5TWFwLnByb3RvdHlwZS5kZWxldGUgPSBmdW5jdGlvbiAoa2V5KSB7XG4gIHZhciBtYW5nbGVkID0gdGhpcy5tYW5nbGUoa2V5KTtcbiAgaWYgKG1hbmdsZWQgaW4gdGhpcy5zdG9yZSkge1xuICAgIGRlbGV0ZSB0aGlzLnN0b3JlW21hbmdsZWRdO1xuICAgIHJldHVybiB0cnVlO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn07XG5MYXp5TWFwLnByb3RvdHlwZS5mb3JFYWNoID0gZnVuY3Rpb24gKGNiKSB7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgdmFyIGtleXMgPSBPYmplY3Qua2V5cyhzZWxmLnN0b3JlKTtcbiAga2V5cy5mb3JFYWNoKGZ1bmN0aW9uIChrZXkpIHtcbiAgICB2YXIgdmFsdWUgPSBzZWxmLnN0b3JlW2tleV07XG4gICAga2V5ID0gc2VsZi51bm1hbmdsZShrZXkpO1xuICAgIGNiKHZhbHVlLCBrZXkpO1xuICB9KTtcbn07XG5cbmZ1bmN0aW9uIExhenlTZXQoYXJyYXkpIHtcbiAgdGhpcy5zdG9yZSA9IG5ldyBMYXp5TWFwKCk7XG5cbiAgLy8gaW5pdCB3aXRoIGFuIGFycmF5XG4gIGlmIChhcnJheSAmJiBBcnJheS5pc0FycmF5KGFycmF5KSkge1xuICAgIGZvciAodmFyIGkgPSAwLCBsZW4gPSBhcnJheS5sZW5ndGg7IGkgPCBsZW47IGkrKykge1xuICAgICAgdGhpcy5hZGQoYXJyYXlbaV0pO1xuICAgIH1cbiAgfVxufVxuTGF6eVNldC5wcm90b3R5cGUuYWRkID0gZnVuY3Rpb24gKGtleSkge1xuICByZXR1cm4gdGhpcy5zdG9yZS5zZXQoa2V5LCB0cnVlKTtcbn07XG5MYXp5U2V0LnByb3RvdHlwZS5oYXMgPSBmdW5jdGlvbiAoa2V5KSB7XG4gIHJldHVybiB0aGlzLnN0b3JlLmhhcyhrZXkpO1xufTtcbkxhenlTZXQucHJvdG90eXBlLmRlbGV0ZSA9IGZ1bmN0aW9uIChrZXkpIHtcbiAgcmV0dXJuIHRoaXMuc3RvcmUuZGVsZXRlKGtleSk7XG59O1xuIiwiXCJ1c2Ugc3RyaWN0XCI7XG5cbi8vIEV4dGVuZHMgbWV0aG9kXG4vLyAodGFrZW4gZnJvbSBodHRwOi8vY29kZS5qcXVlcnkuY29tL2pxdWVyeS0xLjkuMC5qcylcbi8vIFBvcHVsYXRlIHRoZSBjbGFzczJ0eXBlIG1hcFxudmFyIGNsYXNzMnR5cGUgPSB7fTtcblxudmFyIHR5cGVzID0gW1xuICBcIkJvb2xlYW5cIiwgXCJOdW1iZXJcIiwgXCJTdHJpbmdcIiwgXCJGdW5jdGlvblwiLCBcIkFycmF5XCIsXG4gIFwiRGF0ZVwiLCBcIlJlZ0V4cFwiLCBcIk9iamVjdFwiLCBcIkVycm9yXCJcbl07XG5mb3IgKHZhciBpID0gMDsgaSA8IHR5cGVzLmxlbmd0aDsgaSsrKSB7XG4gIHZhciB0eXBlbmFtZSA9IHR5cGVzW2ldO1xuICBjbGFzczJ0eXBlW1wiW29iamVjdCBcIiArIHR5cGVuYW1lICsgXCJdXCJdID0gdHlwZW5hbWUudG9Mb3dlckNhc2UoKTtcbn1cblxudmFyIGNvcmVfdG9TdHJpbmcgPSBjbGFzczJ0eXBlLnRvU3RyaW5nO1xudmFyIGNvcmVfaGFzT3duID0gY2xhc3MydHlwZS5oYXNPd25Qcm9wZXJ0eTtcblxuZnVuY3Rpb24gdHlwZShvYmopIHtcbiAgaWYgKG9iaiA9PT0gbnVsbCkge1xuICAgIHJldHVybiBTdHJpbmcob2JqKTtcbiAgfVxuICByZXR1cm4gdHlwZW9mIG9iaiA9PT0gXCJvYmplY3RcIiB8fCB0eXBlb2Ygb2JqID09PSBcImZ1bmN0aW9uXCIgP1xuICAgIGNsYXNzMnR5cGVbY29yZV90b1N0cmluZy5jYWxsKG9iaildIHx8IFwib2JqZWN0XCIgOlxuICAgIHR5cGVvZiBvYmo7XG59XG5cbmZ1bmN0aW9uIGlzV2luZG93KG9iaikge1xuICByZXR1cm4gb2JqICE9PSBudWxsICYmIG9iaiA9PT0gb2JqLndpbmRvdztcbn1cblxuZnVuY3Rpb24gaXNQbGFpbk9iamVjdChvYmopIHtcbiAgLy8gTXVzdCBiZSBhbiBPYmplY3QuXG4gIC8vIEJlY2F1c2Ugb2YgSUUsIHdlIGFsc28gaGF2ZSB0byBjaGVjayB0aGUgcHJlc2VuY2Ugb2ZcbiAgLy8gdGhlIGNvbnN0cnVjdG9yIHByb3BlcnR5LlxuICAvLyBNYWtlIHN1cmUgdGhhdCBET00gbm9kZXMgYW5kIHdpbmRvdyBvYmplY3RzIGRvbid0IHBhc3MgdGhyb3VnaCwgYXMgd2VsbFxuICBpZiAoIW9iaiB8fCB0eXBlKG9iaikgIT09IFwib2JqZWN0XCIgfHwgb2JqLm5vZGVUeXBlIHx8IGlzV2luZG93KG9iaikpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICB0cnkge1xuICAgIC8vIE5vdCBvd24gY29uc3RydWN0b3IgcHJvcGVydHkgbXVzdCBiZSBPYmplY3RcbiAgICBpZiAob2JqLmNvbnN0cnVjdG9yICYmXG4gICAgICAhY29yZV9oYXNPd24uY2FsbChvYmosIFwiY29uc3RydWN0b3JcIikgJiZcbiAgICAgICFjb3JlX2hhc093bi5jYWxsKG9iai5jb25zdHJ1Y3Rvci5wcm90b3R5cGUsIFwiaXNQcm90b3R5cGVPZlwiKSkge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfSBjYXRjaCAoIGUgKSB7XG4gICAgLy8gSUU4LDkgV2lsbCB0aHJvdyBleGNlcHRpb25zIG9uIGNlcnRhaW4gaG9zdCBvYmplY3RzICM5ODk3XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgLy8gT3duIHByb3BlcnRpZXMgYXJlIGVudW1lcmF0ZWQgZmlyc3RseSwgc28gdG8gc3BlZWQgdXAsXG4gIC8vIGlmIGxhc3Qgb25lIGlzIG93biwgdGhlbiBhbGwgcHJvcGVydGllcyBhcmUgb3duLlxuICB2YXIga2V5O1xuICBmb3IgKGtleSBpbiBvYmopIHt9XG5cbiAgcmV0dXJuIGtleSA9PT0gdW5kZWZpbmVkIHx8IGNvcmVfaGFzT3duLmNhbGwob2JqLCBrZXkpO1xufVxuXG5cbmZ1bmN0aW9uIGlzRnVuY3Rpb24ob2JqKSB7XG4gIHJldHVybiB0eXBlKG9iaikgPT09IFwiZnVuY3Rpb25cIjtcbn1cblxudmFyIGlzQXJyYXkgPSBBcnJheS5pc0FycmF5IHx8IGZ1bmN0aW9uIChvYmopIHtcbiAgcmV0dXJuIHR5cGUob2JqKSA9PT0gXCJhcnJheVwiO1xufTtcblxuZnVuY3Rpb24gZXh0ZW5kKCkge1xuICAvLyBvcmlnaW5hbGx5IGV4dGVuZCgpIHdhcyByZWN1cnNpdmUsIGJ1dCB0aGlzIGVuZGVkIHVwIGdpdmluZyB1c1xuICAvLyBcImNhbGwgc3RhY2sgZXhjZWVkZWRcIiwgc28gaXQncyBiZWVuIHVucm9sbGVkIHRvIHVzZSBhIGxpdGVyYWwgc3RhY2tcbiAgLy8gKHNlZSBodHRwczovL2dpdGh1Yi5jb20vcG91Y2hkYi9wb3VjaGRiL2lzc3Vlcy8yNTQzKVxuICB2YXIgc3RhY2sgPSBbXTtcbiAgdmFyIGkgPSAtMTtcbiAgdmFyIGxlbiA9IGFyZ3VtZW50cy5sZW5ndGg7XG4gIHZhciBhcmdzID0gbmV3IEFycmF5KGxlbik7XG4gIHdoaWxlICgrK2kgPCBsZW4pIHtcbiAgICBhcmdzW2ldID0gYXJndW1lbnRzW2ldO1xuICB9XG4gIHZhciBjb250YWluZXIgPSB7fTtcbiAgc3RhY2sucHVzaCh7YXJnczogYXJncywgcmVzdWx0OiB7Y29udGFpbmVyOiBjb250YWluZXIsIGtleTogJ2tleSd9fSk7XG4gIHZhciBuZXh0O1xuICB3aGlsZSAoKG5leHQgPSBzdGFjay5wb3AoKSkpIHtcbiAgICBleHRlbmRJbm5lcihzdGFjaywgbmV4dC5hcmdzLCBuZXh0LnJlc3VsdCk7XG4gIH1cbiAgcmV0dXJuIGNvbnRhaW5lci5rZXk7XG59XG5cbmZ1bmN0aW9uIGV4dGVuZElubmVyKHN0YWNrLCBhcmdzLCByZXN1bHQpIHtcbiAgdmFyIG9wdGlvbnMsIG5hbWUsIHNyYywgY29weSwgY29weUlzQXJyYXksIGNsb25lLFxuICAgIHRhcmdldCA9IGFyZ3NbMF0gfHwge30sXG4gICAgaSA9IDEsXG4gICAgbGVuZ3RoID0gYXJncy5sZW5ndGgsXG4gICAgZGVlcCA9IGZhbHNlLFxuICAgIG51bWVyaWNTdHJpbmdSZWdleCA9IC9cXGQrLyxcbiAgICBvcHRpb25zSXNBcnJheTtcblxuICAvLyBIYW5kbGUgYSBkZWVwIGNvcHkgc2l0dWF0aW9uXG4gIGlmICh0eXBlb2YgdGFyZ2V0ID09PSBcImJvb2xlYW5cIikge1xuICAgIGRlZXAgPSB0YXJnZXQ7XG4gICAgdGFyZ2V0ID0gYXJnc1sxXSB8fCB7fTtcbiAgICAvLyBza2lwIHRoZSBib29sZWFuIGFuZCB0aGUgdGFyZ2V0XG4gICAgaSA9IDI7XG4gIH1cblxuICAvLyBIYW5kbGUgY2FzZSB3aGVuIHRhcmdldCBpcyBhIHN0cmluZyBvciBzb21ldGhpbmcgKHBvc3NpYmxlIGluIGRlZXAgY29weSlcbiAgaWYgKHR5cGVvZiB0YXJnZXQgIT09IFwib2JqZWN0XCIgJiYgIWlzRnVuY3Rpb24odGFyZ2V0KSkge1xuICAgIHRhcmdldCA9IHt9O1xuICB9XG5cbiAgLy8gZXh0ZW5kIGpRdWVyeSBpdHNlbGYgaWYgb25seSBvbmUgYXJndW1lbnQgaXMgcGFzc2VkXG4gIGlmIChsZW5ndGggPT09IGkpIHtcbiAgICAvKiBqc2hpbnQgdmFsaWR0aGlzOiB0cnVlICovXG4gICAgdGFyZ2V0ID0gdGhpcztcbiAgICAtLWk7XG4gIH1cblxuICBmb3IgKDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgLy8gT25seSBkZWFsIHdpdGggbm9uLW51bGwvdW5kZWZpbmVkIHZhbHVlc1xuICAgIGlmICgob3B0aW9ucyA9IGFyZ3NbaV0pICE9IG51bGwpIHtcbiAgICAgIG9wdGlvbnNJc0FycmF5ID0gaXNBcnJheShvcHRpb25zKTtcbiAgICAgIC8vIEV4dGVuZCB0aGUgYmFzZSBvYmplY3RcbiAgICAgIGZvciAobmFtZSBpbiBvcHRpb25zKSB7XG4gICAgICAgIC8vaWYgKG9wdGlvbnMuaGFzT3duUHJvcGVydHkobmFtZSkpIHtcbiAgICAgICAgaWYgKCEobmFtZSBpbiBPYmplY3QucHJvdG90eXBlKSkge1xuICAgICAgICAgIGlmIChvcHRpb25zSXNBcnJheSAmJiAhbnVtZXJpY1N0cmluZ1JlZ2V4LnRlc3QobmFtZSkpIHtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIHNyYyA9IHRhcmdldFtuYW1lXTtcbiAgICAgICAgICBjb3B5ID0gb3B0aW9uc1tuYW1lXTtcblxuICAgICAgICAgIC8vIFByZXZlbnQgbmV2ZXItZW5kaW5nIGxvb3BcbiAgICAgICAgICBpZiAodGFyZ2V0ID09PSBjb3B5KSB7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICAvLyBSZWN1cnNlIGlmIHdlJ3JlIG1lcmdpbmcgcGxhaW4gb2JqZWN0cyBvciBhcnJheXNcbiAgICAgICAgICBpZiAoZGVlcCAmJiBjb3B5ICYmIChpc1BsYWluT2JqZWN0KGNvcHkpIHx8XG4gICAgICAgICAgICAgIChjb3B5SXNBcnJheSA9IGlzQXJyYXkoY29weSkpKSkge1xuICAgICAgICAgICAgaWYgKGNvcHlJc0FycmF5KSB7XG4gICAgICAgICAgICAgIGNvcHlJc0FycmF5ID0gZmFsc2U7XG4gICAgICAgICAgICAgIGNsb25lID0gc3JjICYmIGlzQXJyYXkoc3JjKSA/IHNyYyA6IFtdO1xuXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBjbG9uZSA9IHNyYyAmJiBpc1BsYWluT2JqZWN0KHNyYykgPyBzcmMgOiB7fTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gTmV2ZXIgbW92ZSBvcmlnaW5hbCBvYmplY3RzLCBjbG9uZSB0aGVtXG4gICAgICAgICAgICBzdGFjay5wdXNoKHtcbiAgICAgICAgICAgICAgYXJnczogW2RlZXAsIGNsb25lLCBjb3B5XSxcbiAgICAgICAgICAgICAgcmVzdWx0OiB7XG4gICAgICAgICAgICAgICAgY29udGFpbmVyOiB0YXJnZXQsXG4gICAgICAgICAgICAgICAga2V5OiBuYW1lXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgLy8gRG9uJ3QgYnJpbmcgaW4gdW5kZWZpbmVkIHZhbHVlc1xuICAgICAgICAgIH0gZWxzZSBpZiAoY29weSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBpZiAoIShpc0FycmF5KG9wdGlvbnMpICYmIGlzRnVuY3Rpb24oY29weSkpKSB7XG4gICAgICAgICAgICAgIHRhcmdldFtuYW1lXSA9IGNvcHk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gXCJSZXR1cm5cIiB0aGUgbW9kaWZpZWQgb2JqZWN0IGJ5IHNldHRpbmcgdGhlIGtleVxuICAvLyBvbiB0aGUgZ2l2ZW4gY29udGFpbmVyXG4gIHJlc3VsdC5jb250YWluZXJbcmVzdWx0LmtleV0gPSB0YXJnZXQ7XG59XG5cblxubW9kdWxlLmV4cG9ydHMgPSBleHRlbmQ7XG5cblxuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgdXBzZXJ0ID0gcmVxdWlyZSgnLi91cHNlcnQnKTtcbnZhciB1dGlscyA9IHJlcXVpcmUoJy4vdXRpbHMnKTtcbnZhciBQcm9taXNlID0gdXRpbHMuUHJvbWlzZTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAob3B0cykge1xuICB2YXIgc291cmNlREIgPSBvcHRzLmRiO1xuICB2YXIgdmlld05hbWUgPSBvcHRzLnZpZXdOYW1lO1xuICB2YXIgbWFwRnVuID0gb3B0cy5tYXA7XG4gIHZhciByZWR1Y2VGdW4gPSBvcHRzLnJlZHVjZTtcbiAgdmFyIHRlbXBvcmFyeSA9IG9wdHMudGVtcG9yYXJ5O1xuXG4gIC8vIHRoZSBcInVuZGVmaW5lZFwiIHBhcnQgaXMgZm9yIGJhY2t3YXJkcyBjb21wYXRpYmlsaXR5XG4gIHZhciB2aWV3U2lnbmF0dXJlID0gbWFwRnVuLnRvU3RyaW5nKCkgKyAocmVkdWNlRnVuICYmIHJlZHVjZUZ1bi50b1N0cmluZygpKSArXG4gICAgJ3VuZGVmaW5lZCc7XG5cbiAgaWYgKCF0ZW1wb3JhcnkgJiYgc291cmNlREIuX2NhY2hlZFZpZXdzKSB7XG4gICAgdmFyIGNhY2hlZFZpZXcgPSBzb3VyY2VEQi5fY2FjaGVkVmlld3Nbdmlld1NpZ25hdHVyZV07XG4gICAgaWYgKGNhY2hlZFZpZXcpIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoY2FjaGVkVmlldyk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHNvdXJjZURCLmluZm8oKS50aGVuKGZ1bmN0aW9uIChpbmZvKSB7XG5cbiAgICB2YXIgZGVwRGJOYW1lID0gaW5mby5kYl9uYW1lICsgJy1tcnZpZXctJyArXG4gICAgICAodGVtcG9yYXJ5ID8gJ3RlbXAnIDogdXRpbHMuTUQ1KHZpZXdTaWduYXR1cmUpKTtcblxuICAgIC8vIHNhdmUgdGhlIHZpZXcgbmFtZSBpbiB0aGUgc291cmNlIFBvdWNoREIgc28gaXQgY2FuIGJlIGNsZWFuZWQgdXAgaWYgbmVjZXNzYXJ5XG4gICAgLy8gKGUuZy4gd2hlbiB0aGUgX2Rlc2lnbiBkb2MgaXMgZGVsZXRlZCwgcmVtb3ZlIGFsbCBhc3NvY2lhdGVkIHZpZXcgZGF0YSlcbiAgICBmdW5jdGlvbiBkaWZmRnVuY3Rpb24oZG9jKSB7XG4gICAgICBkb2Mudmlld3MgPSBkb2Mudmlld3MgfHwge307XG4gICAgICB2YXIgZnVsbFZpZXdOYW1lID0gdmlld05hbWU7XG4gICAgICBpZiAoZnVsbFZpZXdOYW1lLmluZGV4T2YoJy8nKSA9PT0gLTEpIHtcbiAgICAgICAgZnVsbFZpZXdOYW1lID0gdmlld05hbWUgKyAnLycgKyB2aWV3TmFtZTtcbiAgICAgIH1cbiAgICAgIHZhciBkZXBEYnMgPSBkb2Mudmlld3NbZnVsbFZpZXdOYW1lXSA9IGRvYy52aWV3c1tmdWxsVmlld05hbWVdIHx8IHt9O1xuICAgICAgLyogaXN0YW5idWwgaWdub3JlIGlmICovXG4gICAgICBpZiAoZGVwRGJzW2RlcERiTmFtZV0pIHtcbiAgICAgICAgcmV0dXJuOyAvLyBubyB1cGRhdGUgbmVjZXNzYXJ5XG4gICAgICB9XG4gICAgICBkZXBEYnNbZGVwRGJOYW1lXSA9IHRydWU7XG4gICAgICByZXR1cm4gZG9jO1xuICAgIH1cbiAgICByZXR1cm4gdXBzZXJ0KHNvdXJjZURCLCAnX2xvY2FsL21ydmlld3MnLCBkaWZmRnVuY3Rpb24pLnRoZW4oZnVuY3Rpb24gKCkge1xuICAgICAgcmV0dXJuIHNvdXJjZURCLnJlZ2lzdGVyRGVwZW5kZW50RGF0YWJhc2UoZGVwRGJOYW1lKS50aGVuKGZ1bmN0aW9uIChyZXMpIHtcbiAgICAgICAgdmFyIGRiID0gcmVzLmRiO1xuICAgICAgICBkYi5hdXRvX2NvbXBhY3Rpb24gPSB0cnVlO1xuICAgICAgICB2YXIgdmlldyA9IHtcbiAgICAgICAgICBuYW1lOiBkZXBEYk5hbWUsXG4gICAgICAgICAgZGI6IGRiLCBcbiAgICAgICAgICBzb3VyY2VEQjogc291cmNlREIsXG4gICAgICAgICAgYWRhcHRlcjogc291cmNlREIuYWRhcHRlcixcbiAgICAgICAgICBtYXBGdW46IG1hcEZ1bixcbiAgICAgICAgICByZWR1Y2VGdW46IHJlZHVjZUZ1blxuICAgICAgICB9O1xuICAgICAgICByZXR1cm4gdmlldy5kYi5nZXQoJ19sb2NhbC9sYXN0U2VxJylbXCJjYXRjaFwiXShmdW5jdGlvbiAoZXJyKSB7XG4gICAgICAgICAgLyogaXN0YW5idWwgaWdub3JlIGlmICovXG4gICAgICAgICAgaWYgKGVyci5zdGF0dXMgIT09IDQwNCkge1xuICAgICAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgICAgIH1cbiAgICAgICAgfSkudGhlbihmdW5jdGlvbiAobGFzdFNlcURvYykge1xuICAgICAgICAgIHZpZXcuc2VxID0gbGFzdFNlcURvYyA/IGxhc3RTZXFEb2Muc2VxIDogMDtcbiAgICAgICAgICBpZiAoIXRlbXBvcmFyeSkge1xuICAgICAgICAgICAgc291cmNlREIuX2NhY2hlZFZpZXdzID0gc291cmNlREIuX2NhY2hlZFZpZXdzIHx8IHt9O1xuICAgICAgICAgICAgc291cmNlREIuX2NhY2hlZFZpZXdzW3ZpZXdTaWduYXR1cmVdID0gdmlldztcbiAgICAgICAgICAgIHZpZXcuZGIub24oJ2Rlc3Ryb3llZCcsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgZGVsZXRlIHNvdXJjZURCLl9jYWNoZWRWaWV3c1t2aWV3U2lnbmF0dXJlXTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4gdmlldztcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSk7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChmdW5jLCBlbWl0LCBzdW0sIGxvZywgaXNBcnJheSwgdG9KU09OKSB7XG4gIC8qanNoaW50IGV2aWw6dHJ1ZSx1bnVzZWQ6ZmFsc2UgKi9cbiAgcmV0dXJuIGV2YWwoXCIndXNlIHN0cmljdCc7IChcIiArIGZ1bmMucmVwbGFjZSgvO1xccyokLywgXCJcIikgKyBcIik7XCIpO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIHBvdWNoQ29sbGF0ZSA9IHJlcXVpcmUoJ3BvdWNoZGItY29sbGF0ZScpO1xudmFyIFRhc2tRdWV1ZSA9IHJlcXVpcmUoJy4vdGFza3F1ZXVlJyk7XG52YXIgY29sbGF0ZSA9IHBvdWNoQ29sbGF0ZS5jb2xsYXRlO1xudmFyIHRvSW5kZXhhYmxlU3RyaW5nID0gcG91Y2hDb2xsYXRlLnRvSW5kZXhhYmxlU3RyaW5nO1xudmFyIG5vcm1hbGl6ZUtleSA9IHBvdWNoQ29sbGF0ZS5ub3JtYWxpemVLZXk7XG52YXIgY3JlYXRlVmlldyA9IHJlcXVpcmUoJy4vY3JlYXRlLXZpZXcnKTtcbnZhciBldmFsRnVuYyA9IHJlcXVpcmUoJy4vZXZhbGZ1bmMnKTtcbnZhciBsb2c7IFxuLyogaXN0YW5idWwgaWdub3JlIGVsc2UgKi9cbmlmICgodHlwZW9mIGNvbnNvbGUgIT09ICd1bmRlZmluZWQnKSAmJiAodHlwZW9mIGNvbnNvbGUubG9nID09PSAnZnVuY3Rpb24nKSkge1xuICBsb2cgPSBGdW5jdGlvbi5wcm90b3R5cGUuYmluZC5jYWxsKGNvbnNvbGUubG9nLCBjb25zb2xlKTtcbn0gZWxzZSB7XG4gIGxvZyA9IGZ1bmN0aW9uICgpIHt9O1xufVxudmFyIHV0aWxzID0gcmVxdWlyZSgnLi91dGlscycpO1xudmFyIFByb21pc2UgPSB1dGlscy5Qcm9taXNlO1xudmFyIHBlcnNpc3RlbnRRdWV1ZXMgPSB7fTtcbnZhciB0ZW1wVmlld1F1ZXVlID0gbmV3IFRhc2tRdWV1ZSgpO1xudmFyIENIQU5HRVNfQkFUQ0hfU0laRSA9IDUwO1xuXG5mdW5jdGlvbiBwYXJzZVZpZXdOYW1lKG5hbWUpIHtcbiAgLy8gY2FuIGJlIGVpdGhlciAnZGRvY25hbWUvdmlld25hbWUnIG9yIGp1c3QgJ3ZpZXduYW1lJ1xuICAvLyAod2hlcmUgdGhlIGRkb2MgbmFtZSBpcyB0aGUgc2FtZSlcbiAgcmV0dXJuIG5hbWUuaW5kZXhPZignLycpID09PSAtMSA/IFtuYW1lLCBuYW1lXSA6IG5hbWUuc3BsaXQoJy8nKTtcbn1cblxuZnVuY3Rpb24gaXNHZW5PbmUoY2hhbmdlcykge1xuICAvLyBvbmx5IHJldHVybiB0cnVlIGlmIHRoZSBjdXJyZW50IGNoYW5nZSBpcyAxLVxuICAvLyBhbmQgdGhlcmUgYXJlIG5vIG90aGVyIGxlYWZzXG4gIHJldHVybiBjaGFuZ2VzLmxlbmd0aCA9PT0gMSAmJiAvXjEtLy50ZXN0KGNoYW5nZXNbMF0ucmV2KTtcbn1cblxuZnVuY3Rpb24gZW1pdEVycm9yKGRiLCBlKSB7XG4gIHRyeSB7XG4gICAgZGIuZW1pdCgnZXJyb3InLCBlKTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgY29uc29sZS5lcnJvcihcbiAgICAgICdUaGUgdXNlclxcJ3MgbWFwL3JlZHVjZSBmdW5jdGlvbiB0aHJldyBhbiB1bmNhdWdodCBlcnJvci5cXG4nICtcbiAgICAgICdZb3UgY2FuIGRlYnVnIHRoaXMgZXJyb3IgYnkgZG9pbmc6XFxuJyArXG4gICAgICAnbXlEYXRhYmFzZS5vbihcXCdlcnJvclxcJywgZnVuY3Rpb24gKGVycikgeyBkZWJ1Z2dlcjsgfSk7XFxuJyArXG4gICAgICAnUGxlYXNlIGRvdWJsZS1jaGVjayB5b3VyIG1hcC9yZWR1Y2UgZnVuY3Rpb24uJyk7XG4gICAgY29uc29sZS5lcnJvcihlKTtcbiAgfVxufVxuXG5mdW5jdGlvbiB0cnlDb2RlKGRiLCBmdW4sIGFyZ3MpIHtcbiAgLy8gZW1pdCBhbiBldmVudCBpZiB0aGVyZSB3YXMgYW4gZXJyb3IgdGhyb3duIGJ5IGEgbWFwL3JlZHVjZSBmdW5jdGlvbi5cbiAgLy8gcHV0dGluZyB0cnkvY2F0Y2hlcyBpbiBhIHNpbmdsZSBmdW5jdGlvbiBhbHNvIGF2b2lkcyBkZW9wdGltaXphdGlvbnMuXG4gIHRyeSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIG91dHB1dCA6IGZ1bi5hcHBseShudWxsLCBhcmdzKVxuICAgIH07XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBlbWl0RXJyb3IoZGIsIGUpO1xuICAgIHJldHVybiB7ZXJyb3I6IGV9O1xuICB9XG59XG5cbmZ1bmN0aW9uIHNvcnRCeUtleVRoZW5WYWx1ZSh4LCB5KSB7XG4gIHZhciBrZXlDb21wYXJlID0gY29sbGF0ZSh4LmtleSwgeS5rZXkpO1xuICByZXR1cm4ga2V5Q29tcGFyZSAhPT0gMCA/IGtleUNvbXBhcmUgOiBjb2xsYXRlKHgudmFsdWUsIHkudmFsdWUpO1xufVxuXG5mdW5jdGlvbiBzbGljZVJlc3VsdHMocmVzdWx0cywgbGltaXQsIHNraXApIHtcbiAgc2tpcCA9IHNraXAgfHwgMDtcbiAgaWYgKHR5cGVvZiBsaW1pdCA9PT0gJ251bWJlcicpIHtcbiAgICByZXR1cm4gcmVzdWx0cy5zbGljZShza2lwLCBsaW1pdCArIHNraXApO1xuICB9IGVsc2UgaWYgKHNraXAgPiAwKSB7XG4gICAgcmV0dXJuIHJlc3VsdHMuc2xpY2Uoc2tpcCk7XG4gIH1cbiAgcmV0dXJuIHJlc3VsdHM7XG59XG5cbmZ1bmN0aW9uIHJvd1RvRG9jSWQocm93KSB7XG4gIHZhciB2YWwgPSByb3cudmFsdWU7XG4gIC8vIFVzZXJzIGNhbiBleHBsaWNpdGx5IHNwZWNpZnkgYSBqb2luZWQgZG9jIF9pZCwgb3IgaXRcbiAgLy8gZGVmYXVsdHMgdG8gdGhlIGRvYyBfaWQgdGhhdCBlbWl0dGVkIHRoZSBrZXkvdmFsdWUuXG4gIHZhciBkb2NJZCA9ICh2YWwgJiYgdHlwZW9mIHZhbCA9PT0gJ29iamVjdCcgJiYgdmFsLl9pZCkgfHwgcm93LmlkO1xuICByZXR1cm4gZG9jSWQ7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZUJ1aWx0SW5FcnJvcihuYW1lKSB7XG4gIHZhciBtZXNzYWdlID0gJ2J1aWx0aW4gJyArIG5hbWUgK1xuICAgICcgZnVuY3Rpb24gcmVxdWlyZXMgbWFwIHZhbHVlcyB0byBiZSBudW1iZXJzJyArXG4gICAgJyBvciBudW1iZXIgYXJyYXlzJztcbiAgcmV0dXJuIG5ldyBCdWlsdEluRXJyb3IobWVzc2FnZSk7XG59XG5cbmZ1bmN0aW9uIHN1bSh2YWx1ZXMpIHtcbiAgdmFyIHJlc3VsdCA9IDA7XG4gIGZvciAodmFyIGkgPSAwLCBsZW4gPSB2YWx1ZXMubGVuZ3RoOyBpIDwgbGVuOyBpKyspIHtcbiAgICB2YXIgbnVtID0gdmFsdWVzW2ldO1xuICAgIGlmICh0eXBlb2YgbnVtICE9PSAnbnVtYmVyJykge1xuICAgICAgaWYgKEFycmF5LmlzQXJyYXkobnVtKSkge1xuICAgICAgICAvLyBsaXN0cyBvZiBudW1iZXJzIGFyZSBhbHNvIGFsbG93ZWQsIHN1bSB0aGVtIHNlcGFyYXRlbHlcbiAgICAgICAgcmVzdWx0ID0gdHlwZW9mIHJlc3VsdCA9PT0gJ251bWJlcicgPyBbcmVzdWx0XSA6IHJlc3VsdDtcbiAgICAgICAgZm9yICh2YXIgaiA9IDAsIGpMZW4gPSBudW0ubGVuZ3RoOyBqIDwgakxlbjsgaisrKSB7XG4gICAgICAgICAgdmFyIGpOdW0gPSBudW1bal07XG4gICAgICAgICAgaWYgKHR5cGVvZiBqTnVtICE9PSAnbnVtYmVyJykge1xuICAgICAgICAgICAgdGhyb3cgY3JlYXRlQnVpbHRJbkVycm9yKCdfc3VtJyk7XG4gICAgICAgICAgfSBlbHNlIGlmICh0eXBlb2YgcmVzdWx0W2pdID09PSAndW5kZWZpbmVkJykge1xuICAgICAgICAgICAgcmVzdWx0LnB1c2goak51bSk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJlc3VsdFtqXSArPSBqTnVtO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHsgLy8gbm90IGFycmF5L251bWJlclxuICAgICAgICB0aHJvdyBjcmVhdGVCdWlsdEluRXJyb3IoJ19zdW0nKTtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHR5cGVvZiByZXN1bHQgPT09ICdudW1iZXInKSB7XG4gICAgICByZXN1bHQgKz0gbnVtO1xuICAgIH0gZWxzZSB7IC8vIGFkZCBudW1iZXIgdG8gYXJyYXlcbiAgICAgIHJlc3VsdFswXSArPSBudW07XG4gICAgfVxuICB9XG4gIHJldHVybiByZXN1bHQ7XG59XG5cbnZhciBidWlsdEluUmVkdWNlID0ge1xuICBfc3VtOiBmdW5jdGlvbiAoa2V5cywgdmFsdWVzKSB7XG4gICAgcmV0dXJuIHN1bSh2YWx1ZXMpO1xuICB9LFxuXG4gIF9jb3VudDogZnVuY3Rpb24gKGtleXMsIHZhbHVlcykge1xuICAgIHJldHVybiB2YWx1ZXMubGVuZ3RoO1xuICB9LFxuXG4gIF9zdGF0czogZnVuY3Rpb24gKGtleXMsIHZhbHVlcykge1xuICAgIC8vIG5vIG5lZWQgdG8gaW1wbGVtZW50IHJlcmVkdWNlPXRydWUsIGJlY2F1c2UgUG91Y2hcbiAgICAvLyB3aWxsIG5ldmVyIGNhbGwgaXRcbiAgICBmdW5jdGlvbiBzdW1zcXIodmFsdWVzKSB7XG4gICAgICB2YXIgX3N1bXNxciA9IDA7XG4gICAgICBmb3IgKHZhciBpID0gMCwgbGVuID0gdmFsdWVzLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgICAgIHZhciBudW0gPSB2YWx1ZXNbaV07XG4gICAgICAgIF9zdW1zcXIgKz0gKG51bSAqIG51bSk7XG4gICAgICB9XG4gICAgICByZXR1cm4gX3N1bXNxcjtcbiAgICB9XG4gICAgcmV0dXJuIHtcbiAgICAgIHN1bSAgICAgOiBzdW0odmFsdWVzKSxcbiAgICAgIG1pbiAgICAgOiBNYXRoLm1pbi5hcHBseShudWxsLCB2YWx1ZXMpLFxuICAgICAgbWF4ICAgICA6IE1hdGgubWF4LmFwcGx5KG51bGwsIHZhbHVlcyksXG4gICAgICBjb3VudCAgIDogdmFsdWVzLmxlbmd0aCxcbiAgICAgIHN1bXNxciA6IHN1bXNxcih2YWx1ZXMpXG4gICAgfTtcbiAgfVxufTtcblxuZnVuY3Rpb24gYWRkSHR0cFBhcmFtKHBhcmFtTmFtZSwgb3B0cywgcGFyYW1zLCBhc0pzb24pIHtcbiAgLy8gYWRkIGFuIGh0dHAgcGFyYW0gZnJvbSBvcHRzIHRvIHBhcmFtcywgb3B0aW9uYWxseSBqc29uLWVuY29kZWRcbiAgdmFyIHZhbCA9IG9wdHNbcGFyYW1OYW1lXTtcbiAgaWYgKHR5cGVvZiB2YWwgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgaWYgKGFzSnNvbikge1xuICAgICAgdmFsID0gZW5jb2RlVVJJQ29tcG9uZW50KEpTT04uc3RyaW5naWZ5KHZhbCkpO1xuICAgIH1cbiAgICBwYXJhbXMucHVzaChwYXJhbU5hbWUgKyAnPScgKyB2YWwpO1xuICB9XG59XG5cbmZ1bmN0aW9uIGNoZWNrUXVlcnlQYXJzZUVycm9yKG9wdGlvbnMsIGZ1bikge1xuICB2YXIgc3RhcnRrZXlOYW1lID0gb3B0aW9ucy5kZXNjZW5kaW5nID8gJ2VuZGtleScgOiAnc3RhcnRrZXknO1xuICB2YXIgZW5ka2V5TmFtZSA9IG9wdGlvbnMuZGVzY2VuZGluZyA/ICdzdGFydGtleScgOiAnZW5ka2V5JztcblxuICBpZiAodHlwZW9mIG9wdGlvbnNbc3RhcnRrZXlOYW1lXSAhPT0gJ3VuZGVmaW5lZCcgJiZcbiAgICB0eXBlb2Ygb3B0aW9uc1tlbmRrZXlOYW1lXSAhPT0gJ3VuZGVmaW5lZCcgJiZcbiAgICBjb2xsYXRlKG9wdGlvbnNbc3RhcnRrZXlOYW1lXSwgb3B0aW9uc1tlbmRrZXlOYW1lXSkgPiAwKSB7XG4gICAgdGhyb3cgbmV3IFF1ZXJ5UGFyc2VFcnJvcignTm8gcm93cyBjYW4gbWF0Y2ggeW91ciBrZXkgcmFuZ2UsIHJldmVyc2UgeW91ciAnICtcbiAgICAgICAgJ3N0YXJ0X2tleSBhbmQgZW5kX2tleSBvciBzZXQge2Rlc2NlbmRpbmcgOiB0cnVlfScpO1xuICB9IGVsc2UgaWYgKGZ1bi5yZWR1Y2UgJiYgb3B0aW9ucy5yZWR1Y2UgIT09IGZhbHNlKSB7XG4gICAgaWYgKG9wdGlvbnMuaW5jbHVkZV9kb2NzKSB7XG4gICAgICB0aHJvdyBuZXcgUXVlcnlQYXJzZUVycm9yKCd7aW5jbHVkZV9kb2NzOnRydWV9IGlzIGludmFsaWQgZm9yIHJlZHVjZScpO1xuICAgIH0gZWxzZSBpZiAob3B0aW9ucy5rZXlzICYmIG9wdGlvbnMua2V5cy5sZW5ndGggPiAxICYmXG4gICAgICAgICFvcHRpb25zLmdyb3VwICYmICFvcHRpb25zLmdyb3VwX2xldmVsKSB7XG4gICAgICB0aHJvdyBuZXcgUXVlcnlQYXJzZUVycm9yKCdNdWx0aS1rZXkgZmV0Y2hlcyBmb3IgcmVkdWNlIHZpZXdzIG11c3QgdXNlIHtncm91cDogdHJ1ZX0nKTtcbiAgICB9XG4gIH1cbiAgaWYgKG9wdGlvbnMuZ3JvdXBfbGV2ZWwpIHtcbiAgICBpZiAodHlwZW9mIG9wdGlvbnMuZ3JvdXBfbGV2ZWwgIT09ICdudW1iZXInKSB7XG4gICAgICB0aHJvdyBuZXcgUXVlcnlQYXJzZUVycm9yKCdJbnZhbGlkIHZhbHVlIGZvciBpbnRlZ2VyOiBcIicgKyBvcHRpb25zLmdyb3VwX2xldmVsICsgJ1wiJyk7XG4gICAgfVxuICAgIGlmIChvcHRpb25zLmdyb3VwX2xldmVsIDwgMCkge1xuICAgICAgdGhyb3cgbmV3IFF1ZXJ5UGFyc2VFcnJvcignSW52YWxpZCB2YWx1ZSBmb3IgcG9zaXRpdmUgaW50ZWdlcjogJyArXG4gICAgICAgICdcIicgKyBvcHRpb25zLmdyb3VwX2xldmVsICsgJ1wiJyk7XG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIGh0dHBRdWVyeShkYiwgZnVuLCBvcHRzKSB7XG4gIC8vIExpc3Qgb2YgcGFyYW1ldGVycyB0byBhZGQgdG8gdGhlIFBVVCByZXF1ZXN0XG4gIHZhciBwYXJhbXMgPSBbXTtcbiAgdmFyIGJvZHk7XG4gIHZhciBtZXRob2QgPSAnR0VUJztcblxuICAvLyBJZiBvcHRzLnJlZHVjZSBleGlzdHMgYW5kIGlzIGRlZmluZWQsIHRoZW4gYWRkIGl0IHRvIHRoZSBsaXN0XG4gIC8vIG9mIHBhcmFtZXRlcnMuXG4gIC8vIElmIHJlZHVjZT1mYWxzZSB0aGVuIHRoZSByZXN1bHRzIGFyZSB0aGF0IG9mIG9ubHkgdGhlIG1hcCBmdW5jdGlvblxuICAvLyBub3QgdGhlIGZpbmFsIHJlc3VsdCBvZiBtYXAgYW5kIHJlZHVjZS5cbiAgYWRkSHR0cFBhcmFtKCdyZWR1Y2UnLCBvcHRzLCBwYXJhbXMpO1xuICBhZGRIdHRwUGFyYW0oJ2luY2x1ZGVfZG9jcycsIG9wdHMsIHBhcmFtcyk7XG4gIGFkZEh0dHBQYXJhbSgnYXR0YWNobWVudHMnLCBvcHRzLCBwYXJhbXMpO1xuICBhZGRIdHRwUGFyYW0oJ2xpbWl0Jywgb3B0cywgcGFyYW1zKTtcbiAgYWRkSHR0cFBhcmFtKCdkZXNjZW5kaW5nJywgb3B0cywgcGFyYW1zKTtcbiAgYWRkSHR0cFBhcmFtKCdncm91cCcsIG9wdHMsIHBhcmFtcyk7XG4gIGFkZEh0dHBQYXJhbSgnZ3JvdXBfbGV2ZWwnLCBvcHRzLCBwYXJhbXMpO1xuICBhZGRIdHRwUGFyYW0oJ3NraXAnLCBvcHRzLCBwYXJhbXMpO1xuICBhZGRIdHRwUGFyYW0oJ3N0YWxlJywgb3B0cywgcGFyYW1zKTtcbiAgYWRkSHR0cFBhcmFtKCdjb25mbGljdHMnLCBvcHRzLCBwYXJhbXMpO1xuICBhZGRIdHRwUGFyYW0oJ3N0YXJ0a2V5Jywgb3B0cywgcGFyYW1zLCB0cnVlKTtcbiAgYWRkSHR0cFBhcmFtKCdlbmRrZXknLCBvcHRzLCBwYXJhbXMsIHRydWUpO1xuICBhZGRIdHRwUGFyYW0oJ2luY2x1c2l2ZV9lbmQnLCBvcHRzLCBwYXJhbXMpO1xuICBhZGRIdHRwUGFyYW0oJ2tleScsIG9wdHMsIHBhcmFtcywgdHJ1ZSk7XG5cbiAgLy8gRm9ybWF0IHRoZSBsaXN0IG9mIHBhcmFtZXRlcnMgaW50byBhIHZhbGlkIFVSSSBxdWVyeSBzdHJpbmdcbiAgcGFyYW1zID0gcGFyYW1zLmpvaW4oJyYnKTtcbiAgcGFyYW1zID0gcGFyYW1zID09PSAnJyA/ICcnIDogJz8nICsgcGFyYW1zO1xuXG4gIC8vIElmIGtleXMgYXJlIHN1cHBsaWVkLCBpc3N1ZSBhIFBPU1QgcmVxdWVzdCB0byBjaXJjdW12ZW50IEdFVCBxdWVyeSBzdHJpbmcgbGltaXRzXG4gIC8vIHNlZSBodHRwOi8vd2lraS5hcGFjaGUub3JnL2NvdWNoZGIvSFRUUF92aWV3X0FQSSNRdWVyeWluZ19PcHRpb25zXG4gIGlmICh0eXBlb2Ygb3B0cy5rZXlzICE9PSAndW5kZWZpbmVkJykge1xuICAgIHZhciBNQVhfVVJMX0xFTkdUSCA9IDIwMDA7XG4gICAgLy8gYWNjb3JkaW5nIHRvIGh0dHA6Ly9zdGFja292ZXJmbG93LmNvbS9hLzQxNzE4NC82ODA3NDIsXG4gICAgLy8gdGhlIGRlIGZhY3RvIFVSTCBsZW5ndGggbGltaXQgaXMgMjAwMCBjaGFyYWN0ZXJzXG5cbiAgICB2YXIga2V5c0FzU3RyaW5nID1cbiAgICAgICdrZXlzPScgKyBlbmNvZGVVUklDb21wb25lbnQoSlNPTi5zdHJpbmdpZnkob3B0cy5rZXlzKSk7XG4gICAgaWYgKGtleXNBc1N0cmluZy5sZW5ndGggKyBwYXJhbXMubGVuZ3RoICsgMSA8PSBNQVhfVVJMX0xFTkdUSCkge1xuICAgICAgLy8gSWYgdGhlIGtleXMgYXJlIHNob3J0IGVub3VnaCwgZG8gYSBHRVQuIHdlIGRvIHRoaXMgdG8gd29yayBhcm91bmRcbiAgICAgIC8vIFNhZmFyaSBub3QgdW5kZXJzdGFuZGluZyAzMDRzIG9uIFBPU1RzIChzZWUgcG91Y2hkYi9wb3VjaGRiIzEyMzkpXG4gICAgICBwYXJhbXMgKz0gKHBhcmFtc1swXSA9PT0gJz8nID8gJyYnIDogJz8nKSArIGtleXNBc1N0cmluZztcbiAgICB9IGVsc2Uge1xuICAgICAgbWV0aG9kID0gJ1BPU1QnO1xuICAgICAgaWYgKHR5cGVvZiBmdW4gPT09ICdzdHJpbmcnKSB7XG4gICAgICAgIGJvZHkgPSBKU09OLnN0cmluZ2lmeSh7a2V5czogb3B0cy5rZXlzfSk7XG4gICAgICB9IGVsc2UgeyAvLyBmdW4gaXMge21hcCA6IG1hcGZ1bn0sIHNvIGFwcGVuZCB0byB0aGlzXG4gICAgICAgIGZ1bi5rZXlzID0gb3B0cy5rZXlzO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vIFdlIGFyZSByZWZlcmVuY2luZyBhIHF1ZXJ5IGRlZmluZWQgaW4gdGhlIGRlc2lnbiBkb2NcbiAgaWYgKHR5cGVvZiBmdW4gPT09ICdzdHJpbmcnKSB7XG4gICAgdmFyIHBhcnRzID0gcGFyc2VWaWV3TmFtZShmdW4pO1xuICAgIHJldHVybiBkYi5yZXF1ZXN0KHtcbiAgICAgIG1ldGhvZDogbWV0aG9kLFxuICAgICAgdXJsOiAnX2Rlc2lnbi8nICsgcGFydHNbMF0gKyAnL192aWV3LycgKyBwYXJ0c1sxXSArIHBhcmFtcyxcbiAgICAgIGJvZHk6IGJvZHlcbiAgICB9KTtcbiAgfVxuXG4gIC8vIFdlIGFyZSB1c2luZyBhIHRlbXBvcmFyeSB2aWV3LCB0ZXJyaWJsZSBmb3IgcGVyZm9ybWFuY2UgYnV0IGdvb2QgZm9yIHRlc3RpbmdcbiAgYm9keSA9IGJvZHkgfHwge307XG4gIE9iamVjdC5rZXlzKGZ1bikuZm9yRWFjaChmdW5jdGlvbiAoa2V5KSB7XG4gICAgaWYgKEFycmF5LmlzQXJyYXkoZnVuW2tleV0pKSB7XG4gICAgICBib2R5W2tleV0gPSBmdW5ba2V5XTtcbiAgICB9IGVsc2Uge1xuICAgICAgYm9keVtrZXldID0gZnVuW2tleV0udG9TdHJpbmcoKTtcbiAgICB9XG4gIH0pO1xuICByZXR1cm4gZGIucmVxdWVzdCh7XG4gICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgdXJsOiAnX3RlbXBfdmlldycgKyBwYXJhbXMsXG4gICAgYm9keTogYm9keVxuICB9KTtcbn1cblxuZnVuY3Rpb24gZGVmYXVsdHNUbyh2YWx1ZSkge1xuICByZXR1cm4gZnVuY3Rpb24gKHJlYXNvbikge1xuICAgIC8qIGlzdGFuYnVsIGlnbm9yZSBlbHNlICovXG4gICAgaWYgKHJlYXNvbi5zdGF0dXMgPT09IDQwNCkge1xuICAgICAgcmV0dXJuIHZhbHVlO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyByZWFzb247XG4gICAgfVxuICB9O1xufVxuXG4vLyByZXR1cm5zIGEgcHJvbWlzZSBmb3IgYSBsaXN0IG9mIGRvY3MgdG8gdXBkYXRlLCBiYXNlZCBvbiB0aGUgaW5wdXQgZG9jSWQuXG4vLyB0aGUgb3JkZXIgZG9lc24ndCBtYXR0ZXIsIGJlY2F1c2UgcG9zdC0zLjIuMCwgYnVsa0RvY3Ncbi8vIGlzIGFuIGF0b21pYyBvcGVyYXRpb24gaW4gYWxsIHRocmVlIGFkYXB0ZXJzLlxuZnVuY3Rpb24gZ2V0RG9jc1RvUGVyc2lzdChkb2NJZCwgdmlldywgZG9jSWRzVG9DaGFuZ2VzQW5kRW1pdHMpIHtcbiAgdmFyIG1ldGFEb2NJZCA9ICdfbG9jYWwvZG9jXycgKyBkb2NJZDtcbiAgdmFyIGRlZmF1bHRNZXRhRG9jID0ge19pZDogbWV0YURvY0lkLCBrZXlzOiBbXX07XG4gIHZhciBkb2NEYXRhID0gZG9jSWRzVG9DaGFuZ2VzQW5kRW1pdHNbZG9jSWRdO1xuICB2YXIgaW5kZXhhYmxlS2V5c1RvS2V5VmFsdWVzID0gZG9jRGF0YS5pbmRleGFibGVLZXlzVG9LZXlWYWx1ZXM7XG4gIHZhciBjaGFuZ2VzID0gZG9jRGF0YS5jaGFuZ2VzO1xuXG4gIGZ1bmN0aW9uIGdldE1ldGFEb2MoKSB7XG4gICAgaWYgKGlzR2VuT25lKGNoYW5nZXMpKSB7XG4gICAgICAvLyBnZW5lcmF0aW9uIDEsIHNvIHdlIGNhbiBzYWZlbHkgYXNzdW1lIGluaXRpYWwgc3RhdGVcbiAgICAgIC8vIGZvciBwZXJmb3JtYW5jZSByZWFzb25zIChhdm9pZHMgdW5uZWNlc3NhcnkgR0VUcylcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoZGVmYXVsdE1ldGFEb2MpO1xuICAgIH1cbiAgICByZXR1cm4gdmlldy5kYi5nZXQobWV0YURvY0lkKVtcImNhdGNoXCJdKGRlZmF1bHRzVG8oZGVmYXVsdE1ldGFEb2MpKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGdldEtleVZhbHVlRG9jcyhtZXRhRG9jKSB7XG4gICAgaWYgKCFtZXRhRG9jLmtleXMubGVuZ3RoKSB7XG4gICAgICAvLyBubyBrZXlzLCBubyBuZWVkIGZvciBhIGxvb2t1cFxuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh7cm93czogW119KTtcbiAgICB9XG4gICAgcmV0dXJuIHZpZXcuZGIuYWxsRG9jcyh7XG4gICAgICBrZXlzOiBtZXRhRG9jLmtleXMsXG4gICAgICBpbmNsdWRlX2RvY3M6IHRydWVcbiAgICB9KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHByb2Nlc3NLdkRvY3MobWV0YURvYywga3ZEb2NzUmVzKSB7XG4gICAgdmFyIGt2RG9jcyA9IFtdO1xuICAgIHZhciBvbGRLZXlzTWFwID0ge307XG5cbiAgICBmb3IgKHZhciBpID0gMCwgbGVuID0ga3ZEb2NzUmVzLnJvd3MubGVuZ3RoOyBpIDwgbGVuOyBpKyspIHtcbiAgICAgIHZhciByb3cgPSBrdkRvY3NSZXMucm93c1tpXTtcbiAgICAgIHZhciBkb2MgPSByb3cuZG9jO1xuICAgICAgaWYgKCFkb2MpIHsgLy8gZGVsZXRlZFxuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGt2RG9jcy5wdXNoKGRvYyk7XG4gICAgICBvbGRLZXlzTWFwW2RvYy5faWRdID0gdHJ1ZTtcbiAgICAgIGRvYy5fZGVsZXRlZCA9ICFpbmRleGFibGVLZXlzVG9LZXlWYWx1ZXNbZG9jLl9pZF07XG4gICAgICBpZiAoIWRvYy5fZGVsZXRlZCkge1xuICAgICAgICB2YXIga2V5VmFsdWUgPSBpbmRleGFibGVLZXlzVG9LZXlWYWx1ZXNbZG9jLl9pZF07XG4gICAgICAgIGlmICgndmFsdWUnIGluIGtleVZhbHVlKSB7XG4gICAgICAgICAgZG9jLnZhbHVlID0ga2V5VmFsdWUudmFsdWU7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICB2YXIgbmV3S2V5cyA9IE9iamVjdC5rZXlzKGluZGV4YWJsZUtleXNUb0tleVZhbHVlcyk7XG4gICAgbmV3S2V5cy5mb3JFYWNoKGZ1bmN0aW9uIChrZXkpIHtcbiAgICAgIGlmICghb2xkS2V5c01hcFtrZXldKSB7XG4gICAgICAgIC8vIG5ldyBkb2NcbiAgICAgICAgdmFyIGt2RG9jID0ge1xuICAgICAgICAgIF9pZDoga2V5XG4gICAgICAgIH07XG4gICAgICAgIHZhciBrZXlWYWx1ZSA9IGluZGV4YWJsZUtleXNUb0tleVZhbHVlc1trZXldO1xuICAgICAgICBpZiAoJ3ZhbHVlJyBpbiBrZXlWYWx1ZSkge1xuICAgICAgICAgIGt2RG9jLnZhbHVlID0ga2V5VmFsdWUudmFsdWU7XG4gICAgICAgIH1cbiAgICAgICAga3ZEb2NzLnB1c2goa3ZEb2MpO1xuICAgICAgfVxuICAgIH0pO1xuICAgIG1ldGFEb2Mua2V5cyA9IHV0aWxzLnVuaXEobmV3S2V5cy5jb25jYXQobWV0YURvYy5rZXlzKSk7XG4gICAga3ZEb2NzLnB1c2gobWV0YURvYyk7XG5cbiAgICByZXR1cm4ga3ZEb2NzO1xuICB9XG5cbiAgcmV0dXJuIGdldE1ldGFEb2MoKS50aGVuKGZ1bmN0aW9uIChtZXRhRG9jKSB7XG4gICAgcmV0dXJuIGdldEtleVZhbHVlRG9jcyhtZXRhRG9jKS50aGVuKGZ1bmN0aW9uIChrdkRvY3NSZXMpIHtcbiAgICAgIHJldHVybiBwcm9jZXNzS3ZEb2NzKG1ldGFEb2MsIGt2RG9jc1Jlcyk7XG4gICAgfSk7XG4gIH0pO1xufVxuXG4vLyB1cGRhdGVzIGFsbCBlbWl0dGVkIGtleS92YWx1ZSBkb2NzIGFuZCBtZXRhRG9jcyBpbiB0aGUgbXJ2aWV3IGRhdGFiYXNlXG4vLyBmb3IgdGhlIGdpdmVuIGJhdGNoIG9mIGRvY3VtZW50cyBmcm9tIHRoZSBzb3VyY2UgZGF0YWJhc2VcbmZ1bmN0aW9uIHNhdmVLZXlWYWx1ZXModmlldywgZG9jSWRzVG9DaGFuZ2VzQW5kRW1pdHMsIHNlcSkge1xuICB2YXIgc2VxRG9jSWQgPSAnX2xvY2FsL2xhc3RTZXEnO1xuICByZXR1cm4gdmlldy5kYi5nZXQoc2VxRG9jSWQpW1xuICBcImNhdGNoXCJdKGRlZmF1bHRzVG8oe19pZDogc2VxRG9jSWQsIHNlcTogMH0pKVxuICAudGhlbihmdW5jdGlvbiAobGFzdFNlcURvYykge1xuICAgIHZhciBkb2NJZHMgPSBPYmplY3Qua2V5cyhkb2NJZHNUb0NoYW5nZXNBbmRFbWl0cyk7XG4gICAgcmV0dXJuIFByb21pc2UuYWxsKGRvY0lkcy5tYXAoZnVuY3Rpb24gKGRvY0lkKSB7XG4gICAgICByZXR1cm4gZ2V0RG9jc1RvUGVyc2lzdChkb2NJZCwgdmlldywgZG9jSWRzVG9DaGFuZ2VzQW5kRW1pdHMpO1xuICAgIH0pKS50aGVuKGZ1bmN0aW9uIChsaXN0T2ZEb2NzVG9QZXJzaXN0KSB7XG4gICAgICB2YXIgZG9jc1RvUGVyc2lzdCA9IHV0aWxzLmZsYXR0ZW4obGlzdE9mRG9jc1RvUGVyc2lzdCk7XG4gICAgICBsYXN0U2VxRG9jLnNlcSA9IHNlcTtcbiAgICAgIGRvY3NUb1BlcnNpc3QucHVzaChsYXN0U2VxRG9jKTtcbiAgICAgIC8vIHdyaXRlIGFsbCBkb2NzIGluIGEgc2luZ2xlIG9wZXJhdGlvbiwgdXBkYXRlIHRoZSBzZXEgb25jZVxuICAgICAgcmV0dXJuIHZpZXcuZGIuYnVsa0RvY3Moe2RvY3MgOiBkb2NzVG9QZXJzaXN0fSk7XG4gICAgfSk7XG4gIH0pO1xufVxuXG5mdW5jdGlvbiBnZXRRdWV1ZSh2aWV3KSB7XG4gIHZhciB2aWV3TmFtZSA9IHR5cGVvZiB2aWV3ID09PSAnc3RyaW5nJyA/IHZpZXcgOiB2aWV3Lm5hbWU7XG4gIHZhciBxdWV1ZSA9IHBlcnNpc3RlbnRRdWV1ZXNbdmlld05hbWVdO1xuICBpZiAoIXF1ZXVlKSB7XG4gICAgcXVldWUgPSBwZXJzaXN0ZW50UXVldWVzW3ZpZXdOYW1lXSA9IG5ldyBUYXNrUXVldWUoKTtcbiAgfVxuICByZXR1cm4gcXVldWU7XG59XG5cbmZ1bmN0aW9uIHVwZGF0ZVZpZXcodmlldykge1xuICByZXR1cm4gdXRpbHMuc2VxdWVudGlhbGl6ZShnZXRRdWV1ZSh2aWV3KSwgZnVuY3Rpb24gKCkge1xuICAgIHJldHVybiB1cGRhdGVWaWV3SW5RdWV1ZSh2aWV3KTtcbiAgfSkoKTtcbn1cblxuZnVuY3Rpb24gdXBkYXRlVmlld0luUXVldWUodmlldykge1xuICAvLyBiaW5kIHRoZSBlbWl0IGZ1bmN0aW9uIG9uY2VcbiAgdmFyIG1hcFJlc3VsdHM7XG4gIHZhciBkb2M7XG5cbiAgZnVuY3Rpb24gZW1pdChrZXksIHZhbHVlKSB7XG4gICAgdmFyIG91dHB1dCA9IHtpZDogZG9jLl9pZCwga2V5OiBub3JtYWxpemVLZXkoa2V5KX07XG4gICAgLy8gRG9uJ3QgZXhwbGljaXRseSBzdG9yZSB0aGUgdmFsdWUgdW5sZXNzIGl0J3MgZGVmaW5lZCBhbmQgbm9uLW51bGwuXG4gICAgLy8gVGhpcyBzYXZlcyBvbiBzdG9yYWdlIHNwYWNlLCBiZWNhdXNlIG9mdGVuIHBlb3BsZSBkb24ndCB1c2UgaXQuXG4gICAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gJ3VuZGVmaW5lZCcgJiYgdmFsdWUgIT09IG51bGwpIHtcbiAgICAgIG91dHB1dC52YWx1ZSA9IG5vcm1hbGl6ZUtleSh2YWx1ZSk7XG4gICAgfVxuICAgIG1hcFJlc3VsdHMucHVzaChvdXRwdXQpO1xuICB9XG5cbiAgdmFyIG1hcEZ1bjtcbiAgLy8gZm9yIHRlbXBfdmlld3Mgb25lIGNhbiB1c2UgZW1pdChkb2MsIGVtaXQpLCBzZWUgIzM4XG4gIGlmICh0eXBlb2Ygdmlldy5tYXBGdW4gPT09IFwiZnVuY3Rpb25cIiAmJiB2aWV3Lm1hcEZ1bi5sZW5ndGggPT09IDIpIHtcbiAgICB2YXIgb3JpZ01hcCA9IHZpZXcubWFwRnVuO1xuICAgIG1hcEZ1biA9IGZ1bmN0aW9uIChkb2MpIHtcbiAgICAgIHJldHVybiBvcmlnTWFwKGRvYywgZW1pdCk7XG4gICAgfTtcbiAgfSBlbHNlIHtcbiAgICBtYXBGdW4gPSBldmFsRnVuYyh2aWV3Lm1hcEZ1bi50b1N0cmluZygpLCBlbWl0LCBzdW0sIGxvZywgQXJyYXkuaXNBcnJheSwgSlNPTi5wYXJzZSk7XG4gIH1cblxuICB2YXIgY3VycmVudFNlcSA9IHZpZXcuc2VxIHx8IDA7XG5cbiAgZnVuY3Rpb24gcHJvY2Vzc0NoYW5nZShkb2NJZHNUb0NoYW5nZXNBbmRFbWl0cywgc2VxKSB7XG4gICAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICAgIHJldHVybiBzYXZlS2V5VmFsdWVzKHZpZXcsIGRvY0lkc1RvQ2hhbmdlc0FuZEVtaXRzLCBzZXEpO1xuICAgIH07XG4gIH1cblxuICB2YXIgcXVldWUgPSBuZXcgVGFza1F1ZXVlKCk7XG4gIC8vIFRPRE8obmVvanNraSk6IGh0dHBzOi8vZ2l0aHViLmNvbS9kYWxlaGFydmV5L3BvdWNoZGIvaXNzdWVzLzE1MjFcblxuICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24gKHJlc29sdmUsIHJlamVjdCkge1xuXG4gICAgZnVuY3Rpb24gY29tcGxldGUoKSB7XG4gICAgICBxdWV1ZS5maW5pc2goKS50aGVuKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdmlldy5zZXEgPSBjdXJyZW50U2VxO1xuICAgICAgICByZXNvbHZlKCk7XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBwcm9jZXNzTmV4dEJhdGNoKCkge1xuICAgICAgdmlldy5zb3VyY2VEQi5jaGFuZ2VzKHtcbiAgICAgICAgY29uZmxpY3RzOiB0cnVlLFxuICAgICAgICBpbmNsdWRlX2RvY3M6IHRydWUsXG4gICAgICAgIHN0eWxlOiAnYWxsX2RvY3MnLFxuICAgICAgICBzaW5jZTogY3VycmVudFNlcSxcbiAgICAgICAgbGltaXQ6IENIQU5HRVNfQkFUQ0hfU0laRVxuICAgICAgfSkub24oJ2NvbXBsZXRlJywgZnVuY3Rpb24gKHJlc3BvbnNlKSB7XG4gICAgICAgIHZhciByZXN1bHRzID0gcmVzcG9uc2UucmVzdWx0cztcbiAgICAgICAgaWYgKCFyZXN1bHRzLmxlbmd0aCkge1xuICAgICAgICAgIHJldHVybiBjb21wbGV0ZSgpO1xuICAgICAgICB9XG4gICAgICAgIHZhciBkb2NJZHNUb0NoYW5nZXNBbmRFbWl0cyA9IHt9O1xuICAgICAgICBmb3IgKHZhciBpID0gMCwgbCA9IHJlc3VsdHMubGVuZ3RoOyBpIDwgbDsgaSsrKSB7XG4gICAgICAgICAgdmFyIGNoYW5nZSA9IHJlc3VsdHNbaV07XG4gICAgICAgICAgaWYgKGNoYW5nZS5kb2MuX2lkWzBdICE9PSAnXycpIHtcbiAgICAgICAgICAgIG1hcFJlc3VsdHMgPSBbXTtcbiAgICAgICAgICAgIGRvYyA9IGNoYW5nZS5kb2M7XG5cbiAgICAgICAgICAgIGlmICghZG9jLl9kZWxldGVkKSB7XG4gICAgICAgICAgICAgIHRyeUNvZGUodmlldy5zb3VyY2VEQiwgbWFwRnVuLCBbZG9jXSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBtYXBSZXN1bHRzLnNvcnQoc29ydEJ5S2V5VGhlblZhbHVlKTtcblxuICAgICAgICAgICAgdmFyIGluZGV4YWJsZUtleXNUb0tleVZhbHVlcyA9IHt9O1xuICAgICAgICAgICAgdmFyIGxhc3RLZXk7XG4gICAgICAgICAgICBmb3IgKHZhciBqID0gMCwgamwgPSBtYXBSZXN1bHRzLmxlbmd0aDsgaiA8IGpsOyBqKyspIHtcbiAgICAgICAgICAgICAgdmFyIG9iaiA9IG1hcFJlc3VsdHNbal07XG4gICAgICAgICAgICAgIHZhciBjb21wbGV4S2V5ID0gW29iai5rZXksIG9iai5pZF07XG4gICAgICAgICAgICAgIGlmIChjb2xsYXRlKG9iai5rZXksIGxhc3RLZXkpID09PSAwKSB7XG4gICAgICAgICAgICAgICAgY29tcGxleEtleS5wdXNoKGopOyAvLyBkdXAga2V5K2lkLCBzbyBtYWtlIGl0IHVuaXF1ZVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIHZhciBpbmRleGFibGVLZXkgPSB0b0luZGV4YWJsZVN0cmluZyhjb21wbGV4S2V5KTtcbiAgICAgICAgICAgICAgaW5kZXhhYmxlS2V5c1RvS2V5VmFsdWVzW2luZGV4YWJsZUtleV0gPSBvYmo7XG4gICAgICAgICAgICAgIGxhc3RLZXkgPSBvYmoua2V5O1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZG9jSWRzVG9DaGFuZ2VzQW5kRW1pdHNbY2hhbmdlLmRvYy5faWRdID0ge1xuICAgICAgICAgICAgICBpbmRleGFibGVLZXlzVG9LZXlWYWx1ZXM6IGluZGV4YWJsZUtleXNUb0tleVZhbHVlcyxcbiAgICAgICAgICAgICAgY2hhbmdlczogY2hhbmdlLmNoYW5nZXNcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgfVxuICAgICAgICAgIGN1cnJlbnRTZXEgPSBjaGFuZ2Uuc2VxO1xuICAgICAgICB9XG4gICAgICAgIHF1ZXVlLmFkZChwcm9jZXNzQ2hhbmdlKGRvY0lkc1RvQ2hhbmdlc0FuZEVtaXRzLCBjdXJyZW50U2VxKSk7XG4gICAgICAgIGlmIChyZXN1bHRzLmxlbmd0aCA8IENIQU5HRVNfQkFUQ0hfU0laRSkge1xuICAgICAgICAgIHJldHVybiBjb21wbGV0ZSgpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBwcm9jZXNzTmV4dEJhdGNoKCk7XG4gICAgICB9KS5vbignZXJyb3InLCBvbkVycm9yKTtcbiAgICAgIC8qIGlzdGFuYnVsIGlnbm9yZSBuZXh0ICovXG4gICAgICBmdW5jdGlvbiBvbkVycm9yKGVycikge1xuICAgICAgICByZWplY3QoZXJyKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBwcm9jZXNzTmV4dEJhdGNoKCk7XG4gIH0pO1xufVxuXG5mdW5jdGlvbiByZWR1Y2VWaWV3KHZpZXcsIHJlc3VsdHMsIG9wdGlvbnMpIHtcbiAgaWYgKG9wdGlvbnMuZ3JvdXBfbGV2ZWwgPT09IDApIHtcbiAgICBkZWxldGUgb3B0aW9ucy5ncm91cF9sZXZlbDtcbiAgfVxuXG4gIHZhciBzaG91bGRHcm91cCA9IG9wdGlvbnMuZ3JvdXAgfHwgb3B0aW9ucy5ncm91cF9sZXZlbDtcblxuICB2YXIgcmVkdWNlRnVuO1xuICBpZiAoYnVpbHRJblJlZHVjZVt2aWV3LnJlZHVjZUZ1bl0pIHtcbiAgICByZWR1Y2VGdW4gPSBidWlsdEluUmVkdWNlW3ZpZXcucmVkdWNlRnVuXTtcbiAgfSBlbHNlIHtcbiAgICByZWR1Y2VGdW4gPSBldmFsRnVuYyhcbiAgICAgIHZpZXcucmVkdWNlRnVuLnRvU3RyaW5nKCksIG51bGwsIHN1bSwgbG9nLCBBcnJheS5pc0FycmF5LCBKU09OLnBhcnNlKTtcbiAgfVxuXG4gIHZhciBncm91cHMgPSBbXTtcbiAgdmFyIGx2bCA9IG9wdGlvbnMuZ3JvdXBfbGV2ZWw7XG4gIHJlc3VsdHMuZm9yRWFjaChmdW5jdGlvbiAoZSkge1xuICAgIHZhciBsYXN0ID0gZ3JvdXBzW2dyb3Vwcy5sZW5ndGggLSAxXTtcbiAgICB2YXIga2V5ID0gc2hvdWxkR3JvdXAgPyBlLmtleSA6IG51bGw7XG5cbiAgICAvLyBvbmx5IHNldCBncm91cF9sZXZlbCBmb3IgYXJyYXkga2V5c1xuICAgIGlmIChzaG91bGRHcm91cCAmJiBBcnJheS5pc0FycmF5KGtleSkgJiYgdHlwZW9mIGx2bCA9PT0gJ251bWJlcicpIHtcbiAgICAgIGtleSA9IGtleS5sZW5ndGggPiBsdmwgPyBrZXkuc2xpY2UoMCwgbHZsKSA6IGtleTtcbiAgICB9XG5cbiAgICBpZiAobGFzdCAmJiBjb2xsYXRlKGxhc3Qua2V5WzBdWzBdLCBrZXkpID09PSAwKSB7XG4gICAgICBsYXN0LmtleS5wdXNoKFtrZXksIGUuaWRdKTtcbiAgICAgIGxhc3QudmFsdWUucHVzaChlLnZhbHVlKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgZ3JvdXBzLnB1c2goe2tleTogW1xuICAgICAgW2tleSwgZS5pZF1cbiAgICBdLCB2YWx1ZTogW2UudmFsdWVdfSk7XG4gIH0pO1xuICBmb3IgKHZhciBpID0gMCwgbGVuID0gZ3JvdXBzLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgdmFyIGUgPSBncm91cHNbaV07XG4gICAgdmFyIHJlZHVjZVRyeSA9IHRyeUNvZGUodmlldy5zb3VyY2VEQiwgcmVkdWNlRnVuLCBbZS5rZXksIGUudmFsdWUsIGZhbHNlXSk7XG4gICAgaWYgKHJlZHVjZVRyeS5lcnJvciAmJiByZWR1Y2VUcnkuZXJyb3IgaW5zdGFuY2VvZiBCdWlsdEluRXJyb3IpIHtcbiAgICAgIC8vIENvdWNoREIgcmV0dXJucyBhbiBlcnJvciBpZiBhIGJ1aWx0LWluIGVycm9ycyBvdXRcbiAgICAgIHRocm93IHJlZHVjZVRyeS5lcnJvcjtcbiAgICB9XG4gICAgLy8gQ291Y2hEQiBqdXN0IHNldHMgdGhlIHZhbHVlIHRvIG51bGwgaWYgYSBub24tYnVpbHQtaW4gZXJyb3JzIG91dFxuICAgIGUudmFsdWUgPSByZWR1Y2VUcnkuZXJyb3IgPyBudWxsIDogcmVkdWNlVHJ5Lm91dHB1dDtcbiAgICBlLmtleSA9IGUua2V5WzBdWzBdO1xuICB9XG4gIC8vIG5vIHRvdGFsX3Jvd3Mvb2Zmc2V0IHdoZW4gcmVkdWNpbmdcbiAgcmV0dXJuIHtyb3dzOiBzbGljZVJlc3VsdHMoZ3JvdXBzLCBvcHRpb25zLmxpbWl0LCBvcHRpb25zLnNraXApfTtcbn1cblxuZnVuY3Rpb24gcXVlcnlWaWV3KHZpZXcsIG9wdHMpIHtcbiAgcmV0dXJuIHV0aWxzLnNlcXVlbnRpYWxpemUoZ2V0UXVldWUodmlldyksIGZ1bmN0aW9uICgpIHtcbiAgICByZXR1cm4gcXVlcnlWaWV3SW5RdWV1ZSh2aWV3LCBvcHRzKTtcbiAgfSkoKTtcbn1cblxuZnVuY3Rpb24gcXVlcnlWaWV3SW5RdWV1ZSh2aWV3LCBvcHRzKSB7XG4gIHZhciB0b3RhbFJvd3M7XG4gIHZhciBzaG91bGRSZWR1Y2UgPSB2aWV3LnJlZHVjZUZ1biAmJiBvcHRzLnJlZHVjZSAhPT0gZmFsc2U7XG4gIHZhciBza2lwID0gb3B0cy5za2lwIHx8IDA7XG4gIGlmICh0eXBlb2Ygb3B0cy5rZXlzICE9PSAndW5kZWZpbmVkJyAmJiAhb3B0cy5rZXlzLmxlbmd0aCkge1xuICAgIC8vIGVxdWl2YWxlbnQgcXVlcnlcbiAgICBvcHRzLmxpbWl0ID0gMDtcbiAgICBkZWxldGUgb3B0cy5rZXlzO1xuICB9XG5cbiAgZnVuY3Rpb24gZmV0Y2hGcm9tVmlldyh2aWV3T3B0cykge1xuICAgIHZpZXdPcHRzLmluY2x1ZGVfZG9jcyA9IHRydWU7XG4gICAgcmV0dXJuIHZpZXcuZGIuYWxsRG9jcyh2aWV3T3B0cykudGhlbihmdW5jdGlvbiAocmVzKSB7XG4gICAgICB0b3RhbFJvd3MgPSByZXMudG90YWxfcm93cztcbiAgICAgIHJldHVybiByZXMucm93cy5tYXAoZnVuY3Rpb24gKHJlc3VsdCkge1xuXG4gICAgICAgIC8vIGltcGxpY2l0IG1pZ3JhdGlvbiAtIGluIG9sZGVyIHZlcnNpb25zIG9mIFBvdWNoREIsXG4gICAgICAgIC8vIHdlIGV4cGxpY2l0bHkgc3RvcmVkIHRoZSBkb2MgYXMge2lkOiAuLi4sIGtleTogLi4uLCB2YWx1ZTogLi4ufVxuICAgICAgICAvLyB0aGlzIGlzIHRlc3RlZCBpbiBhIG1pZ3JhdGlvbiB0ZXN0XG4gICAgICAgIC8qIGlzdGFuYnVsIGlnbm9yZSBuZXh0ICovXG4gICAgICAgIGlmICgndmFsdWUnIGluIHJlc3VsdC5kb2MgJiYgdHlwZW9mIHJlc3VsdC5kb2MudmFsdWUgPT09ICdvYmplY3QnICYmXG4gICAgICAgICAgICByZXN1bHQuZG9jLnZhbHVlICE9PSBudWxsKSB7XG4gICAgICAgICAgdmFyIGtleXMgPSBPYmplY3Qua2V5cyhyZXN1bHQuZG9jLnZhbHVlKS5zb3J0KCk7XG4gICAgICAgICAgLy8gdGhpcyBkZXRlY3Rpb24gbWV0aG9kIGlzIG5vdCBwZXJmZWN0LCBidXQgaXQncyB1bmxpa2VseSB0aGUgdXNlclxuICAgICAgICAgIC8vIGVtaXR0ZWQgYSB2YWx1ZSB3aGljaCB3YXMgYW4gb2JqZWN0IHdpdGggdGhlc2UgMyBleGFjdCBrZXlzXG4gICAgICAgICAgdmFyIGV4cGVjdGVkS2V5cyA9IFsnaWQnLCAna2V5JywgJ3ZhbHVlJ107XG4gICAgICAgICAgaWYgKCEoa2V5cyA8IGV4cGVjdGVkS2V5cyB8fCBrZXlzID4gZXhwZWN0ZWRLZXlzKSkge1xuICAgICAgICAgICAgcmV0dXJuIHJlc3VsdC5kb2MudmFsdWU7XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgdmFyIHBhcnNlZEtleUFuZERvY0lkID0gcG91Y2hDb2xsYXRlLnBhcnNlSW5kZXhhYmxlU3RyaW5nKHJlc3VsdC5kb2MuX2lkKTtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBrZXk6IHBhcnNlZEtleUFuZERvY0lkWzBdLFxuICAgICAgICAgIGlkOiBwYXJzZWRLZXlBbmREb2NJZFsxXSxcbiAgICAgICAgICB2YWx1ZTogKCd2YWx1ZScgaW4gcmVzdWx0LmRvYyA/IHJlc3VsdC5kb2MudmFsdWUgOiBudWxsKVxuICAgICAgICB9O1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBmdW5jdGlvbiBvbk1hcFJlc3VsdHNSZWFkeShyb3dzKSB7XG4gICAgdmFyIGZpbmFsUmVzdWx0cztcbiAgICBpZiAoc2hvdWxkUmVkdWNlKSB7XG4gICAgICBmaW5hbFJlc3VsdHMgPSByZWR1Y2VWaWV3KHZpZXcsIHJvd3MsIG9wdHMpO1xuICAgIH0gZWxzZSB7XG4gICAgICBmaW5hbFJlc3VsdHMgPSB7XG4gICAgICAgIHRvdGFsX3Jvd3M6IHRvdGFsUm93cyxcbiAgICAgICAgb2Zmc2V0OiBza2lwLFxuICAgICAgICByb3dzOiByb3dzXG4gICAgICB9O1xuICAgIH1cbiAgICBpZiAob3B0cy5pbmNsdWRlX2RvY3MpIHtcbiAgICAgIHZhciBkb2NJZHMgPSB1dGlscy51bmlxKHJvd3MubWFwKHJvd1RvRG9jSWQpKTtcblxuICAgICAgcmV0dXJuIHZpZXcuc291cmNlREIuYWxsRG9jcyh7XG4gICAgICAgIGtleXM6IGRvY0lkcyxcbiAgICAgICAgaW5jbHVkZV9kb2NzOiB0cnVlLFxuICAgICAgICBjb25mbGljdHM6IG9wdHMuY29uZmxpY3RzLFxuICAgICAgICBhdHRhY2htZW50czogb3B0cy5hdHRhY2htZW50c1xuICAgICAgfSkudGhlbihmdW5jdGlvbiAoYWxsRG9jc1Jlcykge1xuICAgICAgICB2YXIgZG9jSWRzVG9Eb2NzID0ge307XG4gICAgICAgIGFsbERvY3NSZXMucm93cy5mb3JFYWNoKGZ1bmN0aW9uIChyb3cpIHtcbiAgICAgICAgICBpZiAocm93LmRvYykge1xuICAgICAgICAgICAgZG9jSWRzVG9Eb2NzWyckJyArIHJvdy5pZF0gPSByb3cuZG9jO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIHJvd3MuZm9yRWFjaChmdW5jdGlvbiAocm93KSB7XG4gICAgICAgICAgdmFyIGRvY0lkID0gcm93VG9Eb2NJZChyb3cpO1xuICAgICAgICAgIHZhciBkb2MgPSBkb2NJZHNUb0RvY3NbJyQnICsgZG9jSWRdO1xuICAgICAgICAgIGlmIChkb2MpIHtcbiAgICAgICAgICAgIHJvdy5kb2MgPSBkb2M7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIGZpbmFsUmVzdWx0cztcbiAgICAgIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gZmluYWxSZXN1bHRzO1xuICAgIH1cbiAgfVxuXG4gIHZhciBmbGF0dGVuID0gZnVuY3Rpb24gKGFycmF5KSB7XG4gICAgcmV0dXJuIGFycmF5LnJlZHVjZShmdW5jdGlvbiAocHJldiwgY3VyKSB7XG4gICAgICByZXR1cm4gcHJldi5jb25jYXQoY3VyKTtcbiAgICB9KTtcbiAgfTtcblxuICBpZiAodHlwZW9mIG9wdHMua2V5cyAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICB2YXIga2V5cyA9IG9wdHMua2V5cztcbiAgICB2YXIgZmV0Y2hQcm9taXNlcyA9IGtleXMubWFwKGZ1bmN0aW9uIChrZXkpIHtcbiAgICAgIHZhciB2aWV3T3B0cyA9IHtcbiAgICAgICAgc3RhcnRrZXkgOiB0b0luZGV4YWJsZVN0cmluZyhba2V5XSksXG4gICAgICAgIGVuZGtleSAgIDogdG9JbmRleGFibGVTdHJpbmcoW2tleSwge31dKVxuICAgICAgfTtcbiAgICAgIHJldHVybiBmZXRjaEZyb21WaWV3KHZpZXdPcHRzKTtcbiAgICB9KTtcbiAgICByZXR1cm4gUHJvbWlzZS5hbGwoZmV0Y2hQcm9taXNlcykudGhlbihmbGF0dGVuKS50aGVuKG9uTWFwUmVzdWx0c1JlYWR5KTtcbiAgfSBlbHNlIHsgLy8gbm9ybWFsIHF1ZXJ5LCBubyAna2V5cydcbiAgICB2YXIgdmlld09wdHMgPSB7XG4gICAgICBkZXNjZW5kaW5nIDogb3B0cy5kZXNjZW5kaW5nXG4gICAgfTtcbiAgICBpZiAodHlwZW9mIG9wdHMuc3RhcnRrZXkgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICB2aWV3T3B0cy5zdGFydGtleSA9IG9wdHMuZGVzY2VuZGluZyA/XG4gICAgICAgIHRvSW5kZXhhYmxlU3RyaW5nKFtvcHRzLnN0YXJ0a2V5LCB7fV0pIDpcbiAgICAgICAgdG9JbmRleGFibGVTdHJpbmcoW29wdHMuc3RhcnRrZXldKTtcbiAgICB9XG4gICAgaWYgKHR5cGVvZiBvcHRzLmVuZGtleSAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgIHZhciBpbmNsdXNpdmVFbmQgPSBvcHRzLmluY2x1c2l2ZV9lbmQgIT09IGZhbHNlO1xuICAgICAgaWYgKG9wdHMuZGVzY2VuZGluZykge1xuICAgICAgICBpbmNsdXNpdmVFbmQgPSAhaW5jbHVzaXZlRW5kO1xuICAgICAgfVxuXG4gICAgICB2aWV3T3B0cy5lbmRrZXkgPSB0b0luZGV4YWJsZVN0cmluZyhpbmNsdXNpdmVFbmQgPyBbb3B0cy5lbmRrZXksIHt9XSA6IFtvcHRzLmVuZGtleV0pO1xuICAgIH1cbiAgICBpZiAodHlwZW9mIG9wdHMua2V5ICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgdmFyIGtleVN0YXJ0ID0gdG9JbmRleGFibGVTdHJpbmcoW29wdHMua2V5XSk7XG4gICAgICB2YXIga2V5RW5kID0gdG9JbmRleGFibGVTdHJpbmcoW29wdHMua2V5LCB7fV0pO1xuICAgICAgaWYgKHZpZXdPcHRzLmRlc2NlbmRpbmcpIHtcbiAgICAgICAgdmlld09wdHMuZW5ka2V5ID0ga2V5U3RhcnQ7XG4gICAgICAgIHZpZXdPcHRzLnN0YXJ0a2V5ID0ga2V5RW5kO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdmlld09wdHMuc3RhcnRrZXkgPSBrZXlTdGFydDtcbiAgICAgICAgdmlld09wdHMuZW5ka2V5ID0ga2V5RW5kO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAoIXNob3VsZFJlZHVjZSkge1xuICAgICAgaWYgKHR5cGVvZiBvcHRzLmxpbWl0ID09PSAnbnVtYmVyJykge1xuICAgICAgICB2aWV3T3B0cy5saW1pdCA9IG9wdHMubGltaXQ7XG4gICAgICB9XG4gICAgICB2aWV3T3B0cy5za2lwID0gc2tpcDtcbiAgICB9XG4gICAgcmV0dXJuIGZldGNoRnJvbVZpZXcodmlld09wdHMpLnRoZW4ob25NYXBSZXN1bHRzUmVhZHkpO1xuICB9XG59XG5cbmZ1bmN0aW9uIGh0dHBWaWV3Q2xlYW51cChkYikge1xuICByZXR1cm4gZGIucmVxdWVzdCh7XG4gICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgdXJsOiAnX3ZpZXdfY2xlYW51cCdcbiAgfSk7XG59XG5cbmZ1bmN0aW9uIGxvY2FsVmlld0NsZWFudXAoZGIpIHtcbiAgcmV0dXJuIGRiLmdldCgnX2xvY2FsL21ydmlld3MnKS50aGVuKGZ1bmN0aW9uIChtZXRhRG9jKSB7XG4gICAgdmFyIGRvY3NUb1ZpZXdzID0ge307XG4gICAgT2JqZWN0LmtleXMobWV0YURvYy52aWV3cykuZm9yRWFjaChmdW5jdGlvbiAoZnVsbFZpZXdOYW1lKSB7XG4gICAgICB2YXIgcGFydHMgPSBwYXJzZVZpZXdOYW1lKGZ1bGxWaWV3TmFtZSk7XG4gICAgICB2YXIgZGVzaWduRG9jTmFtZSA9ICdfZGVzaWduLycgKyBwYXJ0c1swXTtcbiAgICAgIHZhciB2aWV3TmFtZSA9IHBhcnRzWzFdO1xuICAgICAgZG9jc1RvVmlld3NbZGVzaWduRG9jTmFtZV0gPSBkb2NzVG9WaWV3c1tkZXNpZ25Eb2NOYW1lXSB8fCB7fTtcbiAgICAgIGRvY3NUb1ZpZXdzW2Rlc2lnbkRvY05hbWVdW3ZpZXdOYW1lXSA9IHRydWU7XG4gICAgfSk7XG4gICAgdmFyIG9wdHMgPSB7XG4gICAgICBrZXlzIDogT2JqZWN0LmtleXMoZG9jc1RvVmlld3MpLFxuICAgICAgaW5jbHVkZV9kb2NzIDogdHJ1ZVxuICAgIH07XG4gICAgcmV0dXJuIGRiLmFsbERvY3Mob3B0cykudGhlbihmdW5jdGlvbiAocmVzKSB7XG4gICAgICB2YXIgdmlld3NUb1N0YXR1cyA9IHt9O1xuICAgICAgcmVzLnJvd3MuZm9yRWFjaChmdW5jdGlvbiAocm93KSB7XG4gICAgICAgIHZhciBkZG9jTmFtZSA9IHJvdy5rZXkuc3Vic3RyaW5nKDgpO1xuICAgICAgICBPYmplY3Qua2V5cyhkb2NzVG9WaWV3c1tyb3cua2V5XSkuZm9yRWFjaChmdW5jdGlvbiAodmlld05hbWUpIHtcbiAgICAgICAgICB2YXIgZnVsbFZpZXdOYW1lID0gZGRvY05hbWUgKyAnLycgKyB2aWV3TmFtZTtcbiAgICAgICAgICAvKiBpc3RhbmJ1bCBpZ25vcmUgaWYgKi9cbiAgICAgICAgICBpZiAoIW1ldGFEb2Mudmlld3NbZnVsbFZpZXdOYW1lXSkge1xuICAgICAgICAgICAgLy8gbmV3IGZvcm1hdCwgd2l0aG91dCBzbGFzaGVzLCB0byBzdXBwb3J0IFBvdWNoREIgMi4yLjBcbiAgICAgICAgICAgIC8vIG1pZ3JhdGlvbiB0ZXN0IGluIHBvdWNoZGIncyBicm93c2VyLm1pZ3JhdGlvbi5qcyB2ZXJpZmllcyB0aGlzXG4gICAgICAgICAgICBmdWxsVmlld05hbWUgPSB2aWV3TmFtZTtcbiAgICAgICAgICB9XG4gICAgICAgICAgdmFyIHZpZXdEQk5hbWVzID0gT2JqZWN0LmtleXMobWV0YURvYy52aWV3c1tmdWxsVmlld05hbWVdKTtcbiAgICAgICAgICAvLyBkZXNpZ24gZG9jIGRlbGV0ZWQsIG9yIHZpZXcgZnVuY3Rpb24gbm9uZXhpc3RlbnRcbiAgICAgICAgICB2YXIgc3RhdHVzSXNHb29kID0gcm93LmRvYyAmJiByb3cuZG9jLnZpZXdzICYmIHJvdy5kb2Mudmlld3Nbdmlld05hbWVdO1xuICAgICAgICAgIHZpZXdEQk5hbWVzLmZvckVhY2goZnVuY3Rpb24gKHZpZXdEQk5hbWUpIHtcbiAgICAgICAgICAgIHZpZXdzVG9TdGF0dXNbdmlld0RCTmFtZV0gPSB2aWV3c1RvU3RhdHVzW3ZpZXdEQk5hbWVdIHx8IHN0YXR1c0lzR29vZDtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICAgIHZhciBkYnNUb0RlbGV0ZSA9IE9iamVjdC5rZXlzKHZpZXdzVG9TdGF0dXMpLmZpbHRlcihmdW5jdGlvbiAodmlld0RCTmFtZSkge1xuICAgICAgICByZXR1cm4gIXZpZXdzVG9TdGF0dXNbdmlld0RCTmFtZV07XG4gICAgICB9KTtcbiAgICAgIHZhciBkZXN0cm95UHJvbWlzZXMgPSBkYnNUb0RlbGV0ZS5tYXAoZnVuY3Rpb24gKHZpZXdEQk5hbWUpIHtcbiAgICAgICAgcmV0dXJuIHV0aWxzLnNlcXVlbnRpYWxpemUoZ2V0UXVldWUodmlld0RCTmFtZSksIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICByZXR1cm4gbmV3IGRiLmNvbnN0cnVjdG9yKHZpZXdEQk5hbWUsIGRiLl9fb3B0cykuZGVzdHJveSgpO1xuICAgICAgICB9KSgpO1xuICAgICAgfSk7XG4gICAgICByZXR1cm4gUHJvbWlzZS5hbGwoZGVzdHJveVByb21pc2VzKS50aGVuKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgcmV0dXJuIHtvazogdHJ1ZX07XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSwgZGVmYXVsdHNUbyh7b2s6IHRydWV9KSk7XG59XG5cbmV4cG9ydHMudmlld0NsZWFudXAgPSB1dGlscy5jYWxsYmFja2lmeShmdW5jdGlvbiAoKSB7XG4gIHZhciBkYiA9IHRoaXM7XG4gIGlmIChkYi50eXBlKCkgPT09ICdodHRwJykge1xuICAgIHJldHVybiBodHRwVmlld0NsZWFudXAoZGIpO1xuICB9XG4gIHJldHVybiBsb2NhbFZpZXdDbGVhbnVwKGRiKTtcbn0pO1xuXG5mdW5jdGlvbiBxdWVyeVByb21pc2VkKGRiLCBmdW4sIG9wdHMpIHtcbiAgaWYgKGRiLnR5cGUoKSA9PT0gJ2h0dHAnKSB7XG4gICAgcmV0dXJuIGh0dHBRdWVyeShkYiwgZnVuLCBvcHRzKTtcbiAgfVxuXG4gIGlmICh0eXBlb2YgZnVuICE9PSAnc3RyaW5nJykge1xuICAgIC8vIHRlbXBfdmlld1xuICAgIGNoZWNrUXVlcnlQYXJzZUVycm9yKG9wdHMsIGZ1bik7XG5cbiAgICB2YXIgY3JlYXRlVmlld09wdHMgPSB7XG4gICAgICBkYiA6IGRiLFxuICAgICAgdmlld05hbWUgOiAndGVtcF92aWV3L3RlbXBfdmlldycsXG4gICAgICBtYXAgOiBmdW4ubWFwLFxuICAgICAgcmVkdWNlIDogZnVuLnJlZHVjZSxcbiAgICAgIHRlbXBvcmFyeSA6IHRydWVcbiAgICB9O1xuICAgIHRlbXBWaWV3UXVldWUuYWRkKGZ1bmN0aW9uICgpIHtcbiAgICAgIHJldHVybiBjcmVhdGVWaWV3KGNyZWF0ZVZpZXdPcHRzKS50aGVuKGZ1bmN0aW9uICh2aWV3KSB7XG4gICAgICAgIGZ1bmN0aW9uIGNsZWFudXAoKSB7XG4gICAgICAgICAgcmV0dXJuIHZpZXcuZGIuZGVzdHJveSgpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB1dGlscy5maW4odXBkYXRlVmlldyh2aWV3KS50aGVuKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICByZXR1cm4gcXVlcnlWaWV3KHZpZXcsIG9wdHMpO1xuICAgICAgICB9KSwgY2xlYW51cCk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgICByZXR1cm4gdGVtcFZpZXdRdWV1ZS5maW5pc2goKTtcbiAgfSBlbHNlIHtcbiAgICAvLyBwZXJzaXN0ZW50IHZpZXdcbiAgICB2YXIgZnVsbFZpZXdOYW1lID0gZnVuO1xuICAgIHZhciBwYXJ0cyA9IHBhcnNlVmlld05hbWUoZnVsbFZpZXdOYW1lKTtcbiAgICB2YXIgZGVzaWduRG9jTmFtZSA9IHBhcnRzWzBdO1xuICAgIHZhciB2aWV3TmFtZSA9IHBhcnRzWzFdO1xuICAgIHJldHVybiBkYi5nZXQoJ19kZXNpZ24vJyArIGRlc2lnbkRvY05hbWUpLnRoZW4oZnVuY3Rpb24gKGRvYykge1xuICAgICAgdmFyIGZ1biA9IGRvYy52aWV3cyAmJiBkb2Mudmlld3Nbdmlld05hbWVdO1xuXG4gICAgICBpZiAoIWZ1biB8fCB0eXBlb2YgZnVuLm1hcCAhPT0gJ3N0cmluZycpIHtcbiAgICAgICAgdGhyb3cgbmV3IE5vdEZvdW5kRXJyb3IoJ2Rkb2MgJyArIGRlc2lnbkRvY05hbWUgKyAnIGhhcyBubyB2aWV3IG5hbWVkICcgK1xuICAgICAgICAgIHZpZXdOYW1lKTtcbiAgICAgIH1cbiAgICAgIGNoZWNrUXVlcnlQYXJzZUVycm9yKG9wdHMsIGZ1bik7XG5cbiAgICAgIHZhciBjcmVhdGVWaWV3T3B0cyA9IHtcbiAgICAgICAgZGIgOiBkYixcbiAgICAgICAgdmlld05hbWUgOiBmdWxsVmlld05hbWUsXG4gICAgICAgIG1hcCA6IGZ1bi5tYXAsXG4gICAgICAgIHJlZHVjZSA6IGZ1bi5yZWR1Y2VcbiAgICAgIH07XG4gICAgICByZXR1cm4gY3JlYXRlVmlldyhjcmVhdGVWaWV3T3B0cykudGhlbihmdW5jdGlvbiAodmlldykge1xuICAgICAgICBpZiAob3B0cy5zdGFsZSA9PT0gJ29rJyB8fCBvcHRzLnN0YWxlID09PSAndXBkYXRlX2FmdGVyJykge1xuICAgICAgICAgIGlmIChvcHRzLnN0YWxlID09PSAndXBkYXRlX2FmdGVyJykge1xuICAgICAgICAgICAgcHJvY2Vzcy5uZXh0VGljayhmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgIHVwZGF0ZVZpZXcodmlldyk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuIHF1ZXJ5Vmlldyh2aWV3LCBvcHRzKTtcbiAgICAgICAgfSBlbHNlIHsgLy8gc3RhbGUgbm90IG9rXG4gICAgICAgICAgcmV0dXJuIHVwZGF0ZVZpZXcodmlldykudGhlbihmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICByZXR1cm4gcXVlcnlWaWV3KHZpZXcsIG9wdHMpO1xuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxufVxuXG5leHBvcnRzLnF1ZXJ5ID0gZnVuY3Rpb24gKGZ1biwgb3B0cywgY2FsbGJhY2spIHtcbiAgaWYgKHR5cGVvZiBvcHRzID09PSAnZnVuY3Rpb24nKSB7XG4gICAgY2FsbGJhY2sgPSBvcHRzO1xuICAgIG9wdHMgPSB7fTtcbiAgfVxuICBvcHRzID0gdXRpbHMuZXh0ZW5kKHRydWUsIHt9LCBvcHRzKTtcblxuICBpZiAodHlwZW9mIGZ1biA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIGZ1biA9IHttYXAgOiBmdW59O1xuICB9XG5cbiAgdmFyIGRiID0gdGhpcztcbiAgdmFyIHByb21pc2UgPSBQcm9taXNlLnJlc29sdmUoKS50aGVuKGZ1bmN0aW9uICgpIHtcbiAgICByZXR1cm4gcXVlcnlQcm9taXNlZChkYiwgZnVuLCBvcHRzKTtcbiAgfSk7XG4gIHV0aWxzLnByb21pc2VkQ2FsbGJhY2socHJvbWlzZSwgY2FsbGJhY2spO1xuICByZXR1cm4gcHJvbWlzZTtcbn07XG5cbmZ1bmN0aW9uIFF1ZXJ5UGFyc2VFcnJvcihtZXNzYWdlKSB7XG4gIHRoaXMuc3RhdHVzID0gNDAwO1xuICB0aGlzLm5hbWUgPSAncXVlcnlfcGFyc2VfZXJyb3InO1xuICB0aGlzLm1lc3NhZ2UgPSBtZXNzYWdlO1xuICB0aGlzLmVycm9yID0gdHJ1ZTtcbiAgdHJ5IHtcbiAgICBFcnJvci5jYXB0dXJlU3RhY2tUcmFjZSh0aGlzLCBRdWVyeVBhcnNlRXJyb3IpO1xuICB9IGNhdGNoIChlKSB7fVxufVxuXG51dGlscy5pbmhlcml0cyhRdWVyeVBhcnNlRXJyb3IsIEVycm9yKTtcblxuZnVuY3Rpb24gTm90Rm91bmRFcnJvcihtZXNzYWdlKSB7XG4gIHRoaXMuc3RhdHVzID0gNDA0O1xuICB0aGlzLm5hbWUgPSAnbm90X2ZvdW5kJztcbiAgdGhpcy5tZXNzYWdlID0gbWVzc2FnZTtcbiAgdGhpcy5lcnJvciA9IHRydWU7XG4gIHRyeSB7XG4gICAgRXJyb3IuY2FwdHVyZVN0YWNrVHJhY2UodGhpcywgTm90Rm91bmRFcnJvcik7XG4gIH0gY2F0Y2ggKGUpIHt9XG59XG5cbnV0aWxzLmluaGVyaXRzKE5vdEZvdW5kRXJyb3IsIEVycm9yKTtcblxuZnVuY3Rpb24gQnVpbHRJbkVycm9yKG1lc3NhZ2UpIHtcbiAgdGhpcy5zdGF0dXMgPSA1MDA7XG4gIHRoaXMubmFtZSA9ICdpbnZhbGlkX3ZhbHVlJztcbiAgdGhpcy5tZXNzYWdlID0gbWVzc2FnZTtcbiAgdGhpcy5lcnJvciA9IHRydWU7XG4gIHRyeSB7XG4gICAgRXJyb3IuY2FwdHVyZVN0YWNrVHJhY2UodGhpcywgQnVpbHRJbkVycm9yKTtcbiAgfSBjYXRjaCAoZSkge31cbn1cblxudXRpbHMuaW5oZXJpdHMoQnVpbHRJbkVycm9yLCBFcnJvcik7IiwiJ3VzZSBzdHJpY3QnO1xuLypcbiAqIFNpbXBsZSB0YXNrIHF1ZXVlIHRvIHNlcXVlbnRpYWxpemUgYWN0aW9ucy4gQXNzdW1lcyBjYWxsYmFja3Mgd2lsbCBldmVudHVhbGx5IGZpcmUgKG9uY2UpLlxuICovXG5cbnZhciBQcm9taXNlID0gcmVxdWlyZSgnLi91dGlscycpLlByb21pc2U7XG5cbmZ1bmN0aW9uIFRhc2tRdWV1ZSgpIHtcbiAgdGhpcy5wcm9taXNlID0gbmV3IFByb21pc2UoZnVuY3Rpb24gKGZ1bGZpbGwpIHtmdWxmaWxsKCk7IH0pO1xufVxuVGFza1F1ZXVlLnByb3RvdHlwZS5hZGQgPSBmdW5jdGlvbiAocHJvbWlzZUZhY3RvcnkpIHtcbiAgdGhpcy5wcm9taXNlID0gdGhpcy5wcm9taXNlW1wiY2F0Y2hcIl0oZnVuY3Rpb24gKCkge1xuICAgIC8vIGp1c3QgcmVjb3ZlclxuICB9KS50aGVuKGZ1bmN0aW9uICgpIHtcbiAgICByZXR1cm4gcHJvbWlzZUZhY3RvcnkoKTtcbiAgfSk7XG4gIHJldHVybiB0aGlzLnByb21pc2U7XG59O1xuVGFza1F1ZXVlLnByb3RvdHlwZS5maW5pc2ggPSBmdW5jdGlvbiAoKSB7XG4gIHJldHVybiB0aGlzLnByb21pc2U7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IFRhc2tRdWV1ZTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIHVwc2VydCA9IHJlcXVpcmUoJ3BvdWNoZGItdXBzZXJ0JykudXBzZXJ0O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChkYiwgZG9jLCBkaWZmRnVuKSB7XG4gIHJldHVybiB1cHNlcnQuYXBwbHkoZGIsIFtkb2MsIGRpZmZGdW5dKTtcbn07IiwiJ3VzZSBzdHJpY3QnO1xuLyogaXN0YW5idWwgaWdub3JlIGlmICovXG5pZiAodHlwZW9mIGdsb2JhbC5Qcm9taXNlID09PSAnZnVuY3Rpb24nKSB7XG4gIGV4cG9ydHMuUHJvbWlzZSA9IGdsb2JhbC5Qcm9taXNlO1xufSBlbHNlIHtcbiAgZXhwb3J0cy5Qcm9taXNlID0gcmVxdWlyZSgnbGllJyk7XG59XG5cbmV4cG9ydHMuaW5oZXJpdHMgPSByZXF1aXJlKCdpbmhlcml0cycpO1xuZXhwb3J0cy5leHRlbmQgPSByZXF1aXJlKCdwb3VjaGRiLWV4dGVuZCcpO1xudmFyIGFyZ3NhcnJheSA9IHJlcXVpcmUoJ2FyZ3NhcnJheScpO1xuXG5leHBvcnRzLnByb21pc2VkQ2FsbGJhY2sgPSBmdW5jdGlvbiAocHJvbWlzZSwgY2FsbGJhY2spIHtcbiAgaWYgKGNhbGxiYWNrKSB7XG4gICAgcHJvbWlzZS50aGVuKGZ1bmN0aW9uIChyZXMpIHtcbiAgICAgIHByb2Nlc3MubmV4dFRpY2soZnVuY3Rpb24gKCkge1xuICAgICAgICBjYWxsYmFjayhudWxsLCByZXMpO1xuICAgICAgfSk7XG4gICAgfSwgZnVuY3Rpb24gKHJlYXNvbikge1xuICAgICAgcHJvY2Vzcy5uZXh0VGljayhmdW5jdGlvbiAoKSB7XG4gICAgICAgIGNhbGxiYWNrKHJlYXNvbik7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuICByZXR1cm4gcHJvbWlzZTtcbn07XG5cbmV4cG9ydHMuY2FsbGJhY2tpZnkgPSBmdW5jdGlvbiAoZnVuKSB7XG4gIHJldHVybiBhcmdzYXJyYXkoZnVuY3Rpb24gKGFyZ3MpIHtcbiAgICB2YXIgY2IgPSBhcmdzLnBvcCgpO1xuICAgIHZhciBwcm9taXNlID0gZnVuLmFwcGx5KHRoaXMsIGFyZ3MpO1xuICAgIGlmICh0eXBlb2YgY2IgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIGV4cG9ydHMucHJvbWlzZWRDYWxsYmFjayhwcm9taXNlLCBjYik7XG4gICAgfVxuICAgIHJldHVybiBwcm9taXNlO1xuICB9KTtcbn07XG5cbi8vIFByb21pc2UgZmluYWxseSB1dGlsIHNpbWlsYXIgdG8gUS5maW5hbGx5XG5leHBvcnRzLmZpbiA9IGZ1bmN0aW9uIChwcm9taXNlLCBjYikge1xuICByZXR1cm4gcHJvbWlzZS50aGVuKGZ1bmN0aW9uIChyZXMpIHtcbiAgICB2YXIgcHJvbWlzZTIgPSBjYigpO1xuICAgIGlmICh0eXBlb2YgcHJvbWlzZTIudGhlbiA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgcmV0dXJuIHByb21pc2UyLnRoZW4oZnVuY3Rpb24gKCkge1xuICAgICAgICByZXR1cm4gcmVzO1xuICAgICAgfSk7XG4gICAgfVxuICAgIHJldHVybiByZXM7XG4gIH0sIGZ1bmN0aW9uIChyZWFzb24pIHtcbiAgICB2YXIgcHJvbWlzZTIgPSBjYigpO1xuICAgIGlmICh0eXBlb2YgcHJvbWlzZTIudGhlbiA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgcmV0dXJuIHByb21pc2UyLnRoZW4oZnVuY3Rpb24gKCkge1xuICAgICAgICB0aHJvdyByZWFzb247XG4gICAgICB9KTtcbiAgICB9XG4gICAgdGhyb3cgcmVhc29uO1xuICB9KTtcbn07XG5cbmV4cG9ydHMuc2VxdWVudGlhbGl6ZSA9IGZ1bmN0aW9uIChxdWV1ZSwgcHJvbWlzZUZhY3RvcnkpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgYXJncyA9IGFyZ3VtZW50cztcbiAgICB2YXIgdGhhdCA9IHRoaXM7XG4gICAgcmV0dXJuIHF1ZXVlLmFkZChmdW5jdGlvbiAoKSB7XG4gICAgICByZXR1cm4gcHJvbWlzZUZhY3RvcnkuYXBwbHkodGhhdCwgYXJncyk7XG4gICAgfSk7XG4gIH07XG59O1xuXG5leHBvcnRzLmZsYXR0ZW4gPSBmdW5jdGlvbiAoYXJycykge1xuICB2YXIgcmVzID0gW107XG4gIGZvciAodmFyIGkgPSAwLCBsZW4gPSBhcnJzLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgcmVzID0gcmVzLmNvbmNhdChhcnJzW2ldKTtcbiAgfVxuICByZXR1cm4gcmVzO1xufTtcblxuLy8gdW5pcSBhbiBhcnJheSBvZiBzdHJpbmdzLCBvcmRlciBub3QgZ3VhcmFudGVlZFxuLy8gc2ltaWxhciB0byB1bmRlcnNjb3JlL2xvZGFzaCBfLnVuaXFcbmV4cG9ydHMudW5pcSA9IGZ1bmN0aW9uIChhcnIpIHtcbiAgdmFyIG1hcCA9IHt9O1xuXG4gIGZvciAodmFyIGkgPSAwLCBsZW4gPSBhcnIubGVuZ3RoOyBpIDwgbGVuOyBpKyspIHtcbiAgICBtYXBbJyQnICsgYXJyW2ldXSA9IHRydWU7XG4gIH1cblxuICB2YXIga2V5cyA9IE9iamVjdC5rZXlzKG1hcCk7XG4gIHZhciBvdXRwdXQgPSBuZXcgQXJyYXkoa2V5cy5sZW5ndGgpO1xuXG4gIGZvciAoaSA9IDAsIGxlbiA9IGtleXMubGVuZ3RoOyBpIDwgbGVuOyBpKyspIHtcbiAgICBvdXRwdXRbaV0gPSBrZXlzW2ldLnN1YnN0cmluZygxKTtcbiAgfVxuICByZXR1cm4gb3V0cHV0O1xufTtcblxudmFyIGNyeXB0byA9IHJlcXVpcmUoJ2NyeXB0bycpO1xudmFyIE1kNSA9IHJlcXVpcmUoJ3NwYXJrLW1kNScpO1xuXG5leHBvcnRzLk1ENSA9IGZ1bmN0aW9uIChzdHJpbmcpIHtcbiAgLyogaXN0YW5idWwgaWdub3JlIGVsc2UgKi9cbiAgaWYgKCFwcm9jZXNzLmJyb3dzZXIpIHtcbiAgICByZXR1cm4gY3J5cHRvLmNyZWF0ZUhhc2goJ21kNScpLnVwZGF0ZShzdHJpbmcpLmRpZ2VzdCgnaGV4Jyk7XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIE1kNS5oYXNoKHN0cmluZyk7XG4gIH1cbn07IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgUG91Y2hQcm9taXNlO1xuLyogaXN0YW5idWwgaWdub3JlIG5leHQgKi9cbmlmICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyAmJiB3aW5kb3cuUG91Y2hEQikge1xuICBQb3VjaFByb21pc2UgPSB3aW5kb3cuUG91Y2hEQi51dGlscy5Qcm9taXNlO1xufSBlbHNlIHtcbiAgUG91Y2hQcm9taXNlID0gdHlwZW9mIGdsb2JhbC5Qcm9taXNlID09PSAnZnVuY3Rpb24nID8gZ2xvYmFsLlByb21pc2UgOiByZXF1aXJlKCdsaWUnKTtcbn1cblxuLy8gdGhpcyBpcyBlc3NlbnRpYWxseSB0aGUgXCJ1cGRhdGUgc3VnYXJcIiBmdW5jdGlvbiBmcm9tIGRhbGVoYXJ2ZXkvcG91Y2hkYiMxMzg4XG4vLyB0aGUgZGlmZkZ1biB0ZWxscyB1cyB3aGF0IGRlbHRhIHRvIGFwcGx5IHRvIHRoZSBkb2MuICBpdCBlaXRoZXIgcmV0dXJuc1xuLy8gdGhlIGRvYywgb3IgZmFsc2UgaWYgaXQgZG9lc24ndCBuZWVkIHRvIGRvIGFuIHVwZGF0ZSBhZnRlciBhbGxcbmZ1bmN0aW9uIHVwc2VydElubmVyKGRiLCBkb2NJZCwgZGlmZkZ1bikge1xuICByZXR1cm4gbmV3IFBvdWNoUHJvbWlzZShmdW5jdGlvbiAoZnVsZmlsbCwgcmVqZWN0KSB7XG4gICAgaWYgKHR5cGVvZiBkb2NJZCAhPT0gJ3N0cmluZycpIHtcbiAgICAgIHJldHVybiByZWplY3QobmV3IEVycm9yKCdkb2MgaWQgaXMgcmVxdWlyZWQnKSk7XG4gICAgfVxuXG4gICAgZGIuZ2V0KGRvY0lkLCBmdW5jdGlvbiAoZXJyLCBkb2MpIHtcbiAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgLyogaXN0YW5idWwgaWdub3JlIG5leHQgKi9cbiAgICAgICAgaWYgKGVyci5zdGF0dXMgIT09IDQwNCkge1xuICAgICAgICAgIHJldHVybiByZWplY3QoZXJyKTtcbiAgICAgICAgfVxuICAgICAgICBkb2MgPSB7fTtcbiAgICAgIH1cblxuICAgICAgLy8gdGhlIHVzZXIgbWlnaHQgY2hhbmdlIHRoZSBfcmV2LCBzbyBzYXZlIGl0IGZvciBwb3N0ZXJpdHlcbiAgICAgIHZhciBkb2NSZXYgPSBkb2MuX3JldjtcbiAgICAgIHZhciBuZXdEb2MgPSBkaWZmRnVuKGRvYyk7XG5cbiAgICAgIGlmICghbmV3RG9jKSB7XG4gICAgICAgIC8vIGlmIHRoZSBkaWZmRnVuIHJldHVybnMgZmFsc3ksIHdlIHNob3J0LWNpcmN1aXQgYXNcbiAgICAgICAgLy8gYW4gb3B0aW1pemF0aW9uXG4gICAgICAgIHJldHVybiBmdWxmaWxsKHt1cGRhdGVkOiBmYWxzZSwgcmV2OiBkb2NSZXZ9KTtcbiAgICAgIH1cblxuICAgICAgLy8gdXNlcnMgYXJlbid0IGFsbG93ZWQgdG8gbW9kaWZ5IHRoZXNlIHZhbHVlcyxcbiAgICAgIC8vIHNvIHJlc2V0IHRoZW0gaGVyZVxuICAgICAgbmV3RG9jLl9pZCA9IGRvY0lkO1xuICAgICAgbmV3RG9jLl9yZXYgPSBkb2NSZXY7XG4gICAgICBmdWxmaWxsKHRyeUFuZFB1dChkYiwgbmV3RG9jLCBkaWZmRnVuKSk7XG4gICAgfSk7XG4gIH0pO1xufVxuXG5mdW5jdGlvbiB0cnlBbmRQdXQoZGIsIGRvYywgZGlmZkZ1bikge1xuICByZXR1cm4gZGIucHV0KGRvYykudGhlbihmdW5jdGlvbiAocmVzKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHVwZGF0ZWQ6IHRydWUsXG4gICAgICByZXY6IHJlcy5yZXZcbiAgICB9O1xuICB9LCBmdW5jdGlvbiAoZXJyKSB7XG4gICAgLyogaXN0YW5idWwgaWdub3JlIG5leHQgKi9cbiAgICBpZiAoZXJyLnN0YXR1cyAhPT0gNDA5KSB7XG4gICAgICB0aHJvdyBlcnI7XG4gICAgfVxuICAgIHJldHVybiB1cHNlcnRJbm5lcihkYiwgZG9jLl9pZCwgZGlmZkZ1bik7XG4gIH0pO1xufVxuXG5leHBvcnRzLnVwc2VydCA9IGZ1bmN0aW9uIHVwc2VydChkb2NJZCwgZGlmZkZ1biwgY2IpIHtcbiAgdmFyIGRiID0gdGhpcztcbiAgdmFyIHByb21pc2UgPSB1cHNlcnRJbm5lcihkYiwgZG9jSWQsIGRpZmZGdW4pO1xuICBpZiAodHlwZW9mIGNiICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgcmV0dXJuIHByb21pc2U7XG4gIH1cbiAgcHJvbWlzZS50aGVuKGZ1bmN0aW9uIChyZXNwKSB7XG4gICAgY2IobnVsbCwgcmVzcCk7XG4gIH0sIGNiKTtcbn07XG5cbmV4cG9ydHMucHV0SWZOb3RFeGlzdHMgPSBmdW5jdGlvbiBwdXRJZk5vdEV4aXN0cyhkb2NJZCwgZG9jLCBjYikge1xuICB2YXIgZGIgPSB0aGlzO1xuXG4gIGlmICh0eXBlb2YgZG9jSWQgIT09ICdzdHJpbmcnKSB7XG4gICAgY2IgPSBkb2M7XG4gICAgZG9jID0gZG9jSWQ7XG4gICAgZG9jSWQgPSBkb2MuX2lkO1xuICB9XG5cbiAgdmFyIGRpZmZGdW4gPSBmdW5jdGlvbiAoZXhpc3RpbmdEb2MpIHtcbiAgICBpZiAoZXhpc3RpbmdEb2MuX3Jldikge1xuICAgICAgcmV0dXJuIGZhbHNlOyAvLyBkbyBub3RoaW5nXG4gICAgfVxuICAgIHJldHVybiBkb2M7XG4gIH07XG5cbiAgdmFyIHByb21pc2UgPSB1cHNlcnRJbm5lcihkYiwgZG9jSWQsIGRpZmZGdW4pO1xuICBpZiAodHlwZW9mIGNiICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgcmV0dXJuIHByb21pc2U7XG4gIH1cbiAgcHJvbWlzZS50aGVuKGZ1bmN0aW9uIChyZXNwKSB7XG4gICAgY2IobnVsbCwgcmVzcCk7XG4gIH0sIGNiKTtcbn07XG5cblxuLyogaXN0YW5idWwgaWdub3JlIG5leHQgKi9cbmlmICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyAmJiB3aW5kb3cuUG91Y2hEQikge1xuICB3aW5kb3cuUG91Y2hEQi5wbHVnaW4oZXhwb3J0cyk7XG59XG4iLCIvKmpzaGludCBiaXR3aXNlOmZhbHNlKi9cbi8qZ2xvYmFsIHVuZXNjYXBlKi9cblxuKGZ1bmN0aW9uIChmYWN0b3J5KSB7XG4gICAgaWYgKHR5cGVvZiBleHBvcnRzID09PSAnb2JqZWN0Jykge1xuICAgICAgICAvLyBOb2RlL0NvbW1vbkpTXG4gICAgICAgIG1vZHVsZS5leHBvcnRzID0gZmFjdG9yeSgpO1xuICAgIH0gZWxzZSBpZiAodHlwZW9mIGRlZmluZSA9PT0gJ2Z1bmN0aW9uJyAmJiBkZWZpbmUuYW1kKSB7XG4gICAgICAgIC8vIEFNRFxuICAgICAgICBkZWZpbmUoZmFjdG9yeSk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgLy8gQnJvd3NlciBnbG9iYWxzICh3aXRoIHN1cHBvcnQgZm9yIHdlYiB3b3JrZXJzKVxuICAgICAgICB2YXIgZ2xvYjtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGdsb2IgPSB3aW5kb3c7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIGdsb2IgPSBzZWxmO1xuICAgICAgICB9XG5cbiAgICAgICAgZ2xvYi5TcGFya01ENSA9IGZhY3RvcnkoKTtcbiAgICB9XG59KGZ1bmN0aW9uICh1bmRlZmluZWQpIHtcblxuICAgICd1c2Ugc3RyaWN0JztcblxuICAgIC8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy9cblxuICAgIC8qXG4gICAgICogRmFzdGVzdCBtZDUgaW1wbGVtZW50YXRpb24gYXJvdW5kIChKS00gbWQ1KVxuICAgICAqIENyZWRpdHM6IEpvc2VwaCBNeWVyc1xuICAgICAqXG4gICAgICogQHNlZSBodHRwOi8vd3d3Lm15ZXJzZGFpbHkub3JnL2pvc2VwaC9qYXZhc2NyaXB0L21kNS10ZXh0Lmh0bWxcbiAgICAgKiBAc2VlIGh0dHA6Ly9qc3BlcmYuY29tL21kNS1zaG9vdG91dC83XG4gICAgICovXG5cbiAgICAvKiB0aGlzIGZ1bmN0aW9uIGlzIG11Y2ggZmFzdGVyLFxuICAgICAgc28gaWYgcG9zc2libGUgd2UgdXNlIGl0LiBTb21lIElFc1xuICAgICAgYXJlIHRoZSBvbmx5IG9uZXMgSSBrbm93IG9mIHRoYXRcbiAgICAgIG5lZWQgdGhlIGlkaW90aWMgc2Vjb25kIGZ1bmN0aW9uLFxuICAgICAgZ2VuZXJhdGVkIGJ5IGFuIGlmIGNsYXVzZS4gICovXG4gICAgdmFyIGFkZDMyID0gZnVuY3Rpb24gKGEsIGIpIHtcbiAgICAgICAgcmV0dXJuIChhICsgYikgJiAweEZGRkZGRkZGO1xuICAgIH0sXG5cbiAgICBjbW4gPSBmdW5jdGlvbiAocSwgYSwgYiwgeCwgcywgdCkge1xuICAgICAgICBhID0gYWRkMzIoYWRkMzIoYSwgcSksIGFkZDMyKHgsIHQpKTtcbiAgICAgICAgcmV0dXJuIGFkZDMyKChhIDw8IHMpIHwgKGEgPj4+ICgzMiAtIHMpKSwgYik7XG4gICAgfSxcblxuICAgIGZmID0gZnVuY3Rpb24gKGEsIGIsIGMsIGQsIHgsIHMsIHQpIHtcbiAgICAgICAgcmV0dXJuIGNtbigoYiAmIGMpIHwgKCh+YikgJiBkKSwgYSwgYiwgeCwgcywgdCk7XG4gICAgfSxcblxuICAgIGdnID0gZnVuY3Rpb24gKGEsIGIsIGMsIGQsIHgsIHMsIHQpIHtcbiAgICAgICAgcmV0dXJuIGNtbigoYiAmIGQpIHwgKGMgJiAofmQpKSwgYSwgYiwgeCwgcywgdCk7XG4gICAgfSxcblxuICAgIGhoID0gZnVuY3Rpb24gKGEsIGIsIGMsIGQsIHgsIHMsIHQpIHtcbiAgICAgICAgcmV0dXJuIGNtbihiIF4gYyBeIGQsIGEsIGIsIHgsIHMsIHQpO1xuICAgIH0sXG5cbiAgICBpaSA9IGZ1bmN0aW9uIChhLCBiLCBjLCBkLCB4LCBzLCB0KSB7XG4gICAgICAgIHJldHVybiBjbW4oYyBeIChiIHwgKH5kKSksIGEsIGIsIHgsIHMsIHQpO1xuICAgIH0sXG5cbiAgICBtZDVjeWNsZSA9IGZ1bmN0aW9uICh4LCBrKSB7XG4gICAgICAgIHZhciBhID0geFswXSxcbiAgICAgICAgICAgIGIgPSB4WzFdLFxuICAgICAgICAgICAgYyA9IHhbMl0sXG4gICAgICAgICAgICBkID0geFszXTtcblxuICAgICAgICBhID0gZmYoYSwgYiwgYywgZCwga1swXSwgNywgLTY4MDg3NjkzNik7XG4gICAgICAgIGQgPSBmZihkLCBhLCBiLCBjLCBrWzFdLCAxMiwgLTM4OTU2NDU4Nik7XG4gICAgICAgIGMgPSBmZihjLCBkLCBhLCBiLCBrWzJdLCAxNywgNjA2MTA1ODE5KTtcbiAgICAgICAgYiA9IGZmKGIsIGMsIGQsIGEsIGtbM10sIDIyLCAtMTA0NDUyNTMzMCk7XG4gICAgICAgIGEgPSBmZihhLCBiLCBjLCBkLCBrWzRdLCA3LCAtMTc2NDE4ODk3KTtcbiAgICAgICAgZCA9IGZmKGQsIGEsIGIsIGMsIGtbNV0sIDEyLCAxMjAwMDgwNDI2KTtcbiAgICAgICAgYyA9IGZmKGMsIGQsIGEsIGIsIGtbNl0sIDE3LCAtMTQ3MzIzMTM0MSk7XG4gICAgICAgIGIgPSBmZihiLCBjLCBkLCBhLCBrWzddLCAyMiwgLTQ1NzA1OTgzKTtcbiAgICAgICAgYSA9IGZmKGEsIGIsIGMsIGQsIGtbOF0sIDcsIDE3NzAwMzU0MTYpO1xuICAgICAgICBkID0gZmYoZCwgYSwgYiwgYywga1s5XSwgMTIsIC0xOTU4NDE0NDE3KTtcbiAgICAgICAgYyA9IGZmKGMsIGQsIGEsIGIsIGtbMTBdLCAxNywgLTQyMDYzKTtcbiAgICAgICAgYiA9IGZmKGIsIGMsIGQsIGEsIGtbMTFdLCAyMiwgLTE5OTA0MDQxNjIpO1xuICAgICAgICBhID0gZmYoYSwgYiwgYywgZCwga1sxMl0sIDcsIDE4MDQ2MDM2ODIpO1xuICAgICAgICBkID0gZmYoZCwgYSwgYiwgYywga1sxM10sIDEyLCAtNDAzNDExMDEpO1xuICAgICAgICBjID0gZmYoYywgZCwgYSwgYiwga1sxNF0sIDE3LCAtMTUwMjAwMjI5MCk7XG4gICAgICAgIGIgPSBmZihiLCBjLCBkLCBhLCBrWzE1XSwgMjIsIDEyMzY1MzUzMjkpO1xuXG4gICAgICAgIGEgPSBnZyhhLCBiLCBjLCBkLCBrWzFdLCA1LCAtMTY1Nzk2NTEwKTtcbiAgICAgICAgZCA9IGdnKGQsIGEsIGIsIGMsIGtbNl0sIDksIC0xMDY5NTAxNjMyKTtcbiAgICAgICAgYyA9IGdnKGMsIGQsIGEsIGIsIGtbMTFdLCAxNCwgNjQzNzE3NzEzKTtcbiAgICAgICAgYiA9IGdnKGIsIGMsIGQsIGEsIGtbMF0sIDIwLCAtMzczODk3MzAyKTtcbiAgICAgICAgYSA9IGdnKGEsIGIsIGMsIGQsIGtbNV0sIDUsIC03MDE1NTg2OTEpO1xuICAgICAgICBkID0gZ2coZCwgYSwgYiwgYywga1sxMF0sIDksIDM4MDE2MDgzKTtcbiAgICAgICAgYyA9IGdnKGMsIGQsIGEsIGIsIGtbMTVdLCAxNCwgLTY2MDQ3ODMzNSk7XG4gICAgICAgIGIgPSBnZyhiLCBjLCBkLCBhLCBrWzRdLCAyMCwgLTQwNTUzNzg0OCk7XG4gICAgICAgIGEgPSBnZyhhLCBiLCBjLCBkLCBrWzldLCA1LCA1Njg0NDY0MzgpO1xuICAgICAgICBkID0gZ2coZCwgYSwgYiwgYywga1sxNF0sIDksIC0xMDE5ODAzNjkwKTtcbiAgICAgICAgYyA9IGdnKGMsIGQsIGEsIGIsIGtbM10sIDE0LCAtMTg3MzYzOTYxKTtcbiAgICAgICAgYiA9IGdnKGIsIGMsIGQsIGEsIGtbOF0sIDIwLCAxMTYzNTMxNTAxKTtcbiAgICAgICAgYSA9IGdnKGEsIGIsIGMsIGQsIGtbMTNdLCA1LCAtMTQ0NDY4MTQ2Nyk7XG4gICAgICAgIGQgPSBnZyhkLCBhLCBiLCBjLCBrWzJdLCA5LCAtNTE0MDM3ODQpO1xuICAgICAgICBjID0gZ2coYywgZCwgYSwgYiwga1s3XSwgMTQsIDE3MzUzMjg0NzMpO1xuICAgICAgICBiID0gZ2coYiwgYywgZCwgYSwga1sxMl0sIDIwLCAtMTkyNjYwNzczNCk7XG5cbiAgICAgICAgYSA9IGhoKGEsIGIsIGMsIGQsIGtbNV0sIDQsIC0zNzg1NTgpO1xuICAgICAgICBkID0gaGgoZCwgYSwgYiwgYywga1s4XSwgMTEsIC0yMDIyNTc0NDYzKTtcbiAgICAgICAgYyA9IGhoKGMsIGQsIGEsIGIsIGtbMTFdLCAxNiwgMTgzOTAzMDU2Mik7XG4gICAgICAgIGIgPSBoaChiLCBjLCBkLCBhLCBrWzE0XSwgMjMsIC0zNTMwOTU1Nik7XG4gICAgICAgIGEgPSBoaChhLCBiLCBjLCBkLCBrWzFdLCA0LCAtMTUzMDk5MjA2MCk7XG4gICAgICAgIGQgPSBoaChkLCBhLCBiLCBjLCBrWzRdLCAxMSwgMTI3Mjg5MzM1Myk7XG4gICAgICAgIGMgPSBoaChjLCBkLCBhLCBiLCBrWzddLCAxNiwgLTE1NTQ5NzYzMik7XG4gICAgICAgIGIgPSBoaChiLCBjLCBkLCBhLCBrWzEwXSwgMjMsIC0xMDk0NzMwNjQwKTtcbiAgICAgICAgYSA9IGhoKGEsIGIsIGMsIGQsIGtbMTNdLCA0LCA2ODEyNzkxNzQpO1xuICAgICAgICBkID0gaGgoZCwgYSwgYiwgYywga1swXSwgMTEsIC0zNTg1MzcyMjIpO1xuICAgICAgICBjID0gaGgoYywgZCwgYSwgYiwga1szXSwgMTYsIC03MjI1MjE5NzkpO1xuICAgICAgICBiID0gaGgoYiwgYywgZCwgYSwga1s2XSwgMjMsIDc2MDI5MTg5KTtcbiAgICAgICAgYSA9IGhoKGEsIGIsIGMsIGQsIGtbOV0sIDQsIC02NDAzNjQ0ODcpO1xuICAgICAgICBkID0gaGgoZCwgYSwgYiwgYywga1sxMl0sIDExLCAtNDIxODE1ODM1KTtcbiAgICAgICAgYyA9IGhoKGMsIGQsIGEsIGIsIGtbMTVdLCAxNiwgNTMwNzQyNTIwKTtcbiAgICAgICAgYiA9IGhoKGIsIGMsIGQsIGEsIGtbMl0sIDIzLCAtOTk1MzM4NjUxKTtcblxuICAgICAgICBhID0gaWkoYSwgYiwgYywgZCwga1swXSwgNiwgLTE5ODYzMDg0NCk7XG4gICAgICAgIGQgPSBpaShkLCBhLCBiLCBjLCBrWzddLCAxMCwgMTEyNjg5MTQxNSk7XG4gICAgICAgIGMgPSBpaShjLCBkLCBhLCBiLCBrWzE0XSwgMTUsIC0xNDE2MzU0OTA1KTtcbiAgICAgICAgYiA9IGlpKGIsIGMsIGQsIGEsIGtbNV0sIDIxLCAtNTc0MzQwNTUpO1xuICAgICAgICBhID0gaWkoYSwgYiwgYywgZCwga1sxMl0sIDYsIDE3MDA0ODU1NzEpO1xuICAgICAgICBkID0gaWkoZCwgYSwgYiwgYywga1szXSwgMTAsIC0xODk0OTg2NjA2KTtcbiAgICAgICAgYyA9IGlpKGMsIGQsIGEsIGIsIGtbMTBdLCAxNSwgLTEwNTE1MjMpO1xuICAgICAgICBiID0gaWkoYiwgYywgZCwgYSwga1sxXSwgMjEsIC0yMDU0OTIyNzk5KTtcbiAgICAgICAgYSA9IGlpKGEsIGIsIGMsIGQsIGtbOF0sIDYsIDE4NzMzMTMzNTkpO1xuICAgICAgICBkID0gaWkoZCwgYSwgYiwgYywga1sxNV0sIDEwLCAtMzA2MTE3NDQpO1xuICAgICAgICBjID0gaWkoYywgZCwgYSwgYiwga1s2XSwgMTUsIC0xNTYwMTk4MzgwKTtcbiAgICAgICAgYiA9IGlpKGIsIGMsIGQsIGEsIGtbMTNdLCAyMSwgMTMwOTE1MTY0OSk7XG4gICAgICAgIGEgPSBpaShhLCBiLCBjLCBkLCBrWzRdLCA2LCAtMTQ1NTIzMDcwKTtcbiAgICAgICAgZCA9IGlpKGQsIGEsIGIsIGMsIGtbMTFdLCAxMCwgLTExMjAyMTAzNzkpO1xuICAgICAgICBjID0gaWkoYywgZCwgYSwgYiwga1syXSwgMTUsIDcxODc4NzI1OSk7XG4gICAgICAgIGIgPSBpaShiLCBjLCBkLCBhLCBrWzldLCAyMSwgLTM0MzQ4NTU1MSk7XG5cbiAgICAgICAgeFswXSA9IGFkZDMyKGEsIHhbMF0pO1xuICAgICAgICB4WzFdID0gYWRkMzIoYiwgeFsxXSk7XG4gICAgICAgIHhbMl0gPSBhZGQzMihjLCB4WzJdKTtcbiAgICAgICAgeFszXSA9IGFkZDMyKGQsIHhbM10pO1xuICAgIH0sXG5cbiAgICAvKiB0aGVyZSBuZWVkcyB0byBiZSBzdXBwb3J0IGZvciBVbmljb2RlIGhlcmUsXG4gICAgICAgKiB1bmxlc3Mgd2UgcHJldGVuZCB0aGF0IHdlIGNhbiByZWRlZmluZSB0aGUgTUQtNVxuICAgICAgICogYWxnb3JpdGhtIGZvciBtdWx0aS1ieXRlIGNoYXJhY3RlcnMgKHBlcmhhcHNcbiAgICAgICAqIGJ5IGFkZGluZyBldmVyeSBmb3VyIDE2LWJpdCBjaGFyYWN0ZXJzIGFuZFxuICAgICAgICogc2hvcnRlbmluZyB0aGUgc3VtIHRvIDMyIGJpdHMpLiBPdGhlcndpc2VcbiAgICAgICAqIEkgc3VnZ2VzdCBwZXJmb3JtaW5nIE1ELTUgYXMgaWYgZXZlcnkgY2hhcmFjdGVyXG4gICAgICAgKiB3YXMgdHdvIGJ5dGVzLS1lLmcuLCAwMDQwIDAwMjUgPSBAJS0tYnV0IHRoZW5cbiAgICAgICAqIGhvdyB3aWxsIGFuIG9yZGluYXJ5IE1ELTUgc3VtIGJlIG1hdGNoZWQ/XG4gICAgICAgKiBUaGVyZSBpcyBubyB3YXkgdG8gc3RhbmRhcmRpemUgdGV4dCB0byBzb21ldGhpbmdcbiAgICAgICAqIGxpa2UgVVRGLTggYmVmb3JlIHRyYW5zZm9ybWF0aW9uOyBzcGVlZCBjb3N0IGlzXG4gICAgICAgKiB1dHRlcmx5IHByb2hpYml0aXZlLiBUaGUgSmF2YVNjcmlwdCBzdGFuZGFyZFxuICAgICAgICogaXRzZWxmIG5lZWRzIHRvIGxvb2sgYXQgdGhpczogaXQgc2hvdWxkIHN0YXJ0XG4gICAgICAgKiBwcm92aWRpbmcgYWNjZXNzIHRvIHN0cmluZ3MgYXMgcHJlZm9ybWVkIFVURi04XG4gICAgICAgKiA4LWJpdCB1bnNpZ25lZCB2YWx1ZSBhcnJheXMuXG4gICAgICAgKi9cbiAgICBtZDVibGsgPSBmdW5jdGlvbiAocykge1xuICAgICAgICB2YXIgbWQ1YmxrcyA9IFtdLFxuICAgICAgICAgICAgaTsgLyogQW5keSBLaW5nIHNhaWQgZG8gaXQgdGhpcyB3YXkuICovXG5cbiAgICAgICAgZm9yIChpID0gMDsgaSA8IDY0OyBpICs9IDQpIHtcbiAgICAgICAgICAgIG1kNWJsa3NbaSA+PiAyXSA9IHMuY2hhckNvZGVBdChpKSArIChzLmNoYXJDb2RlQXQoaSArIDEpIDw8IDgpICsgKHMuY2hhckNvZGVBdChpICsgMikgPDwgMTYpICsgKHMuY2hhckNvZGVBdChpICsgMykgPDwgMjQpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBtZDVibGtzO1xuICAgIH0sXG5cbiAgICBtZDVibGtfYXJyYXkgPSBmdW5jdGlvbiAoYSkge1xuICAgICAgICB2YXIgbWQ1YmxrcyA9IFtdLFxuICAgICAgICAgICAgaTsgLyogQW5keSBLaW5nIHNhaWQgZG8gaXQgdGhpcyB3YXkuICovXG5cbiAgICAgICAgZm9yIChpID0gMDsgaSA8IDY0OyBpICs9IDQpIHtcbiAgICAgICAgICAgIG1kNWJsa3NbaSA+PiAyXSA9IGFbaV0gKyAoYVtpICsgMV0gPDwgOCkgKyAoYVtpICsgMl0gPDwgMTYpICsgKGFbaSArIDNdIDw8IDI0KTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbWQ1YmxrcztcbiAgICB9LFxuXG4gICAgbWQ1MSA9IGZ1bmN0aW9uIChzKSB7XG4gICAgICAgIHZhciBuID0gcy5sZW5ndGgsXG4gICAgICAgICAgICBzdGF0ZSA9IFsxNzMyNTg0MTkzLCAtMjcxNzMzODc5LCAtMTczMjU4NDE5NCwgMjcxNzMzODc4XSxcbiAgICAgICAgICAgIGksXG4gICAgICAgICAgICBsZW5ndGgsXG4gICAgICAgICAgICB0YWlsLFxuICAgICAgICAgICAgdG1wLFxuICAgICAgICAgICAgbG8sXG4gICAgICAgICAgICBoaTtcblxuICAgICAgICBmb3IgKGkgPSA2NDsgaSA8PSBuOyBpICs9IDY0KSB7XG4gICAgICAgICAgICBtZDVjeWNsZShzdGF0ZSwgbWQ1YmxrKHMuc3Vic3RyaW5nKGkgLSA2NCwgaSkpKTtcbiAgICAgICAgfVxuICAgICAgICBzID0gcy5zdWJzdHJpbmcoaSAtIDY0KTtcbiAgICAgICAgbGVuZ3RoID0gcy5sZW5ndGg7XG4gICAgICAgIHRhaWwgPSBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF07XG4gICAgICAgIGZvciAoaSA9IDA7IGkgPCBsZW5ndGg7IGkgKz0gMSkge1xuICAgICAgICAgICAgdGFpbFtpID4+IDJdIHw9IHMuY2hhckNvZGVBdChpKSA8PCAoKGkgJSA0KSA8PCAzKTtcbiAgICAgICAgfVxuICAgICAgICB0YWlsW2kgPj4gMl0gfD0gMHg4MCA8PCAoKGkgJSA0KSA8PCAzKTtcbiAgICAgICAgaWYgKGkgPiA1NSkge1xuICAgICAgICAgICAgbWQ1Y3ljbGUoc3RhdGUsIHRhaWwpO1xuICAgICAgICAgICAgZm9yIChpID0gMDsgaSA8IDE2OyBpICs9IDEpIHtcbiAgICAgICAgICAgICAgICB0YWlsW2ldID0gMDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEJld2FyZSB0aGF0IHRoZSBmaW5hbCBsZW5ndGggbWlnaHQgbm90IGZpdCBpbiAzMiBiaXRzIHNvIHdlIHRha2UgY2FyZSBvZiB0aGF0XG4gICAgICAgIHRtcCA9IG4gKiA4O1xuICAgICAgICB0bXAgPSB0bXAudG9TdHJpbmcoMTYpLm1hdGNoKC8oLio/KSguezAsOH0pJC8pO1xuICAgICAgICBsbyA9IHBhcnNlSW50KHRtcFsyXSwgMTYpO1xuICAgICAgICBoaSA9IHBhcnNlSW50KHRtcFsxXSwgMTYpIHx8IDA7XG5cbiAgICAgICAgdGFpbFsxNF0gPSBsbztcbiAgICAgICAgdGFpbFsxNV0gPSBoaTtcblxuICAgICAgICBtZDVjeWNsZShzdGF0ZSwgdGFpbCk7XG4gICAgICAgIHJldHVybiBzdGF0ZTtcbiAgICB9LFxuXG4gICAgbWQ1MV9hcnJheSA9IGZ1bmN0aW9uIChhKSB7XG4gICAgICAgIHZhciBuID0gYS5sZW5ndGgsXG4gICAgICAgICAgICBzdGF0ZSA9IFsxNzMyNTg0MTkzLCAtMjcxNzMzODc5LCAtMTczMjU4NDE5NCwgMjcxNzMzODc4XSxcbiAgICAgICAgICAgIGksXG4gICAgICAgICAgICBsZW5ndGgsXG4gICAgICAgICAgICB0YWlsLFxuICAgICAgICAgICAgdG1wLFxuICAgICAgICAgICAgbG8sXG4gICAgICAgICAgICBoaTtcblxuICAgICAgICBmb3IgKGkgPSA2NDsgaSA8PSBuOyBpICs9IDY0KSB7XG4gICAgICAgICAgICBtZDVjeWNsZShzdGF0ZSwgbWQ1YmxrX2FycmF5KGEuc3ViYXJyYXkoaSAtIDY0LCBpKSkpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gTm90IHN1cmUgaWYgaXQgaXMgYSBidWcsIGhvd2V2ZXIgSUUxMCB3aWxsIGFsd2F5cyBwcm9kdWNlIGEgc3ViIGFycmF5IG9mIGxlbmd0aCAxXG4gICAgICAgIC8vIGNvbnRhaW5pbmcgdGhlIGxhc3QgZWxlbWVudCBvZiB0aGUgcGFyZW50IGFycmF5IGlmIHRoZSBzdWIgYXJyYXkgc3BlY2lmaWVkIHN0YXJ0c1xuICAgICAgICAvLyBiZXlvbmQgdGhlIGxlbmd0aCBvZiB0aGUgcGFyZW50IGFycmF5IC0gd2VpcmQuXG4gICAgICAgIC8vIGh0dHBzOi8vY29ubmVjdC5taWNyb3NvZnQuY29tL0lFL2ZlZWRiYWNrL2RldGFpbHMvNzcxNDUyL3R5cGVkLWFycmF5LXN1YmFycmF5LWlzc3VlXG4gICAgICAgIGEgPSAoaSAtIDY0KSA8IG4gPyBhLnN1YmFycmF5KGkgLSA2NCkgOiBuZXcgVWludDhBcnJheSgwKTtcblxuICAgICAgICBsZW5ndGggPSBhLmxlbmd0aDtcbiAgICAgICAgdGFpbCA9IFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXTtcbiAgICAgICAgZm9yIChpID0gMDsgaSA8IGxlbmd0aDsgaSArPSAxKSB7XG4gICAgICAgICAgICB0YWlsW2kgPj4gMl0gfD0gYVtpXSA8PCAoKGkgJSA0KSA8PCAzKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRhaWxbaSA+PiAyXSB8PSAweDgwIDw8ICgoaSAlIDQpIDw8IDMpO1xuICAgICAgICBpZiAoaSA+IDU1KSB7XG4gICAgICAgICAgICBtZDVjeWNsZShzdGF0ZSwgdGFpbCk7XG4gICAgICAgICAgICBmb3IgKGkgPSAwOyBpIDwgMTY7IGkgKz0gMSkge1xuICAgICAgICAgICAgICAgIHRhaWxbaV0gPSAwO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gQmV3YXJlIHRoYXQgdGhlIGZpbmFsIGxlbmd0aCBtaWdodCBub3QgZml0IGluIDMyIGJpdHMgc28gd2UgdGFrZSBjYXJlIG9mIHRoYXRcbiAgICAgICAgdG1wID0gbiAqIDg7XG4gICAgICAgIHRtcCA9IHRtcC50b1N0cmluZygxNikubWF0Y2goLyguKj8pKC57MCw4fSkkLyk7XG4gICAgICAgIGxvID0gcGFyc2VJbnQodG1wWzJdLCAxNik7XG4gICAgICAgIGhpID0gcGFyc2VJbnQodG1wWzFdLCAxNikgfHwgMDtcblxuICAgICAgICB0YWlsWzE0XSA9IGxvO1xuICAgICAgICB0YWlsWzE1XSA9IGhpO1xuXG4gICAgICAgIG1kNWN5Y2xlKHN0YXRlLCB0YWlsKTtcblxuICAgICAgICByZXR1cm4gc3RhdGU7XG4gICAgfSxcblxuICAgIGhleF9jaHIgPSBbJzAnLCAnMScsICcyJywgJzMnLCAnNCcsICc1JywgJzYnLCAnNycsICc4JywgJzknLCAnYScsICdiJywgJ2MnLCAnZCcsICdlJywgJ2YnXSxcblxuICAgIHJoZXggPSBmdW5jdGlvbiAobikge1xuICAgICAgICB2YXIgcyA9ICcnLFxuICAgICAgICAgICAgajtcbiAgICAgICAgZm9yIChqID0gMDsgaiA8IDQ7IGogKz0gMSkge1xuICAgICAgICAgICAgcyArPSBoZXhfY2hyWyhuID4+IChqICogOCArIDQpKSAmIDB4MEZdICsgaGV4X2NoclsobiA+PiAoaiAqIDgpKSAmIDB4MEZdO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBzO1xuICAgIH0sXG5cbiAgICBoZXggPSBmdW5jdGlvbiAoeCkge1xuICAgICAgICB2YXIgaTtcbiAgICAgICAgZm9yIChpID0gMDsgaSA8IHgubGVuZ3RoOyBpICs9IDEpIHtcbiAgICAgICAgICAgIHhbaV0gPSByaGV4KHhbaV0pO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB4LmpvaW4oJycpO1xuICAgIH0sXG5cbiAgICBtZDUgPSBmdW5jdGlvbiAocykge1xuICAgICAgICByZXR1cm4gaGV4KG1kNTEocykpO1xuICAgIH0sXG5cblxuXG4gICAgLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vL1xuXG4gICAgLyoqXG4gICAgICogU3BhcmtNRDUgT09QIGltcGxlbWVudGF0aW9uLlxuICAgICAqXG4gICAgICogVXNlIHRoaXMgY2xhc3MgdG8gcGVyZm9ybSBhbiBpbmNyZW1lbnRhbCBtZDUsIG90aGVyd2lzZSB1c2UgdGhlXG4gICAgICogc3RhdGljIG1ldGhvZHMgaW5zdGVhZC5cbiAgICAgKi9cbiAgICBTcGFya01ENSA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgLy8gY2FsbCByZXNldCB0byBpbml0IHRoZSBpbnN0YW5jZVxuICAgICAgICB0aGlzLnJlc2V0KCk7XG4gICAgfTtcblxuXG4gICAgLy8gSW4gc29tZSBjYXNlcyB0aGUgZmFzdCBhZGQzMiBmdW5jdGlvbiBjYW5ub3QgYmUgdXNlZC4uXG4gICAgaWYgKG1kNSgnaGVsbG8nKSAhPT0gJzVkNDE0MDJhYmM0YjJhNzZiOTcxOWQ5MTEwMTdjNTkyJykge1xuICAgICAgICBhZGQzMiA9IGZ1bmN0aW9uICh4LCB5KSB7XG4gICAgICAgICAgICB2YXIgbHN3ID0gKHggJiAweEZGRkYpICsgKHkgJiAweEZGRkYpLFxuICAgICAgICAgICAgICAgIG1zdyA9ICh4ID4+IDE2KSArICh5ID4+IDE2KSArIChsc3cgPj4gMTYpO1xuICAgICAgICAgICAgcmV0dXJuIChtc3cgPDwgMTYpIHwgKGxzdyAmIDB4RkZGRik7XG4gICAgICAgIH07XG4gICAgfVxuXG5cbiAgICAvKipcbiAgICAgKiBBcHBlbmRzIGEgc3RyaW5nLlxuICAgICAqIEEgY29udmVyc2lvbiB3aWxsIGJlIGFwcGxpZWQgaWYgYW4gdXRmOCBzdHJpbmcgaXMgZGV0ZWN0ZWQuXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge1N0cmluZ30gc3RyIFRoZSBzdHJpbmcgdG8gYmUgYXBwZW5kZWRcbiAgICAgKlxuICAgICAqIEByZXR1cm4ge1NwYXJrTUQ1fSBUaGUgaW5zdGFuY2UgaXRzZWxmXG4gICAgICovXG4gICAgU3BhcmtNRDUucHJvdG90eXBlLmFwcGVuZCA9IGZ1bmN0aW9uIChzdHIpIHtcbiAgICAgICAgLy8gY29udmVydHMgdGhlIHN0cmluZyB0byB1dGY4IGJ5dGVzIGlmIG5lY2Vzc2FyeVxuICAgICAgICBpZiAoL1tcXHUwMDgwLVxcdUZGRkZdLy50ZXN0KHN0cikpIHtcbiAgICAgICAgICAgIHN0ciA9IHVuZXNjYXBlKGVuY29kZVVSSUNvbXBvbmVudChzdHIpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIHRoZW4gYXBwZW5kIGFzIGJpbmFyeVxuICAgICAgICB0aGlzLmFwcGVuZEJpbmFyeShzdHIpO1xuXG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH07XG5cbiAgICAvKipcbiAgICAgKiBBcHBlbmRzIGEgYmluYXJ5IHN0cmluZy5cbiAgICAgKlxuICAgICAqIEBwYXJhbSB7U3RyaW5nfSBjb250ZW50cyBUaGUgYmluYXJ5IHN0cmluZyB0byBiZSBhcHBlbmRlZFxuICAgICAqXG4gICAgICogQHJldHVybiB7U3BhcmtNRDV9IFRoZSBpbnN0YW5jZSBpdHNlbGZcbiAgICAgKi9cbiAgICBTcGFya01ENS5wcm90b3R5cGUuYXBwZW5kQmluYXJ5ID0gZnVuY3Rpb24gKGNvbnRlbnRzKSB7XG4gICAgICAgIHRoaXMuX2J1ZmYgKz0gY29udGVudHM7XG4gICAgICAgIHRoaXMuX2xlbmd0aCArPSBjb250ZW50cy5sZW5ndGg7XG5cbiAgICAgICAgdmFyIGxlbmd0aCA9IHRoaXMuX2J1ZmYubGVuZ3RoLFxuICAgICAgICAgICAgaTtcblxuICAgICAgICBmb3IgKGkgPSA2NDsgaSA8PSBsZW5ndGg7IGkgKz0gNjQpIHtcbiAgICAgICAgICAgIG1kNWN5Y2xlKHRoaXMuX3N0YXRlLCBtZDVibGsodGhpcy5fYnVmZi5zdWJzdHJpbmcoaSAtIDY0LCBpKSkpO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5fYnVmZiA9IHRoaXMuX2J1ZmYuc3Vic3RyKGkgLSA2NCk7XG5cbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfTtcblxuICAgIC8qKlxuICAgICAqIEZpbmlzaGVzIHRoZSBpbmNyZW1lbnRhbCBjb21wdXRhdGlvbiwgcmVzZXRpbmcgdGhlIGludGVybmFsIHN0YXRlIGFuZFxuICAgICAqIHJldHVybmluZyB0aGUgcmVzdWx0LlxuICAgICAqIFVzZSB0aGUgcmF3IHBhcmFtZXRlciB0byBvYnRhaW4gdGhlIHJhdyByZXN1bHQgaW5zdGVhZCBvZiB0aGUgaGV4IG9uZS5cbiAgICAgKlxuICAgICAqIEBwYXJhbSB7Qm9vbGVhbn0gcmF3IFRydWUgdG8gZ2V0IHRoZSByYXcgcmVzdWx0LCBmYWxzZSB0byBnZXQgdGhlIGhleCByZXN1bHRcbiAgICAgKlxuICAgICAqIEByZXR1cm4ge1N0cmluZ3xBcnJheX0gVGhlIHJlc3VsdFxuICAgICAqL1xuICAgIFNwYXJrTUQ1LnByb3RvdHlwZS5lbmQgPSBmdW5jdGlvbiAocmF3KSB7XG4gICAgICAgIHZhciBidWZmID0gdGhpcy5fYnVmZixcbiAgICAgICAgICAgIGxlbmd0aCA9IGJ1ZmYubGVuZ3RoLFxuICAgICAgICAgICAgaSxcbiAgICAgICAgICAgIHRhaWwgPSBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF0sXG4gICAgICAgICAgICByZXQ7XG5cbiAgICAgICAgZm9yIChpID0gMDsgaSA8IGxlbmd0aDsgaSArPSAxKSB7XG4gICAgICAgICAgICB0YWlsW2kgPj4gMl0gfD0gYnVmZi5jaGFyQ29kZUF0KGkpIDw8ICgoaSAlIDQpIDw8IDMpO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5fZmluaXNoKHRhaWwsIGxlbmd0aCk7XG4gICAgICAgIHJldCA9ICEhcmF3ID8gdGhpcy5fc3RhdGUgOiBoZXgodGhpcy5fc3RhdGUpO1xuXG4gICAgICAgIHRoaXMucmVzZXQoKTtcblxuICAgICAgICByZXR1cm4gcmV0O1xuICAgIH07XG5cbiAgICAvKipcbiAgICAgKiBGaW5pc2ggdGhlIGZpbmFsIGNhbGN1bGF0aW9uIGJhc2VkIG9uIHRoZSB0YWlsLlxuICAgICAqXG4gICAgICogQHBhcmFtIHtBcnJheX0gIHRhaWwgICBUaGUgdGFpbCAod2lsbCBiZSBtb2RpZmllZClcbiAgICAgKiBAcGFyYW0ge051bWJlcn0gbGVuZ3RoIFRoZSBsZW5ndGggb2YgdGhlIHJlbWFpbmluZyBidWZmZXJcbiAgICAgKi9cbiAgICBTcGFya01ENS5wcm90b3R5cGUuX2ZpbmlzaCA9IGZ1bmN0aW9uICh0YWlsLCBsZW5ndGgpIHtcbiAgICAgICAgdmFyIGkgPSBsZW5ndGgsXG4gICAgICAgICAgICB0bXAsXG4gICAgICAgICAgICBsbyxcbiAgICAgICAgICAgIGhpO1xuXG4gICAgICAgIHRhaWxbaSA+PiAyXSB8PSAweDgwIDw8ICgoaSAlIDQpIDw8IDMpO1xuICAgICAgICBpZiAoaSA+IDU1KSB7XG4gICAgICAgICAgICBtZDVjeWNsZSh0aGlzLl9zdGF0ZSwgdGFpbCk7XG4gICAgICAgICAgICBmb3IgKGkgPSAwOyBpIDwgMTY7IGkgKz0gMSkge1xuICAgICAgICAgICAgICAgIHRhaWxbaV0gPSAwO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gRG8gdGhlIGZpbmFsIGNvbXB1dGF0aW9uIGJhc2VkIG9uIHRoZSB0YWlsIGFuZCBsZW5ndGhcbiAgICAgICAgLy8gQmV3YXJlIHRoYXQgdGhlIGZpbmFsIGxlbmd0aCBtYXkgbm90IGZpdCBpbiAzMiBiaXRzIHNvIHdlIHRha2UgY2FyZSBvZiB0aGF0XG4gICAgICAgIHRtcCA9IHRoaXMuX2xlbmd0aCAqIDg7XG4gICAgICAgIHRtcCA9IHRtcC50b1N0cmluZygxNikubWF0Y2goLyguKj8pKC57MCw4fSkkLyk7XG4gICAgICAgIGxvID0gcGFyc2VJbnQodG1wWzJdLCAxNik7XG4gICAgICAgIGhpID0gcGFyc2VJbnQodG1wWzFdLCAxNikgfHwgMDtcblxuICAgICAgICB0YWlsWzE0XSA9IGxvO1xuICAgICAgICB0YWlsWzE1XSA9IGhpO1xuICAgICAgICBtZDVjeWNsZSh0aGlzLl9zdGF0ZSwgdGFpbCk7XG4gICAgfTtcblxuICAgIC8qKlxuICAgICAqIFJlc2V0cyB0aGUgaW50ZXJuYWwgc3RhdGUgb2YgdGhlIGNvbXB1dGF0aW9uLlxuICAgICAqXG4gICAgICogQHJldHVybiB7U3BhcmtNRDV9IFRoZSBpbnN0YW5jZSBpdHNlbGZcbiAgICAgKi9cbiAgICBTcGFya01ENS5wcm90b3R5cGUucmVzZXQgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRoaXMuX2J1ZmYgPSBcIlwiO1xuICAgICAgICB0aGlzLl9sZW5ndGggPSAwO1xuICAgICAgICB0aGlzLl9zdGF0ZSA9IFsxNzMyNTg0MTkzLCAtMjcxNzMzODc5LCAtMTczMjU4NDE5NCwgMjcxNzMzODc4XTtcblxuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9O1xuXG4gICAgLyoqXG4gICAgICogUmVsZWFzZXMgbWVtb3J5IHVzZWQgYnkgdGhlIGluY3JlbWVudGFsIGJ1ZmZlciBhbmQgb3RoZXIgYWRpdGlvbmFsXG4gICAgICogcmVzb3VyY2VzLiBJZiB5b3UgcGxhbiB0byB1c2UgdGhlIGluc3RhbmNlIGFnYWluLCB1c2UgcmVzZXQgaW5zdGVhZC5cbiAgICAgKi9cbiAgICBTcGFya01ENS5wcm90b3R5cGUuZGVzdHJveSA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgZGVsZXRlIHRoaXMuX3N0YXRlO1xuICAgICAgICBkZWxldGUgdGhpcy5fYnVmZjtcbiAgICAgICAgZGVsZXRlIHRoaXMuX2xlbmd0aDtcbiAgICB9O1xuXG5cbiAgICAvKipcbiAgICAgKiBQZXJmb3JtcyB0aGUgbWQ1IGhhc2ggb24gYSBzdHJpbmcuXG4gICAgICogQSBjb252ZXJzaW9uIHdpbGwgYmUgYXBwbGllZCBpZiB1dGY4IHN0cmluZyBpcyBkZXRlY3RlZC5cbiAgICAgKlxuICAgICAqIEBwYXJhbSB7U3RyaW5nfSAgc3RyIFRoZSBzdHJpbmdcbiAgICAgKiBAcGFyYW0ge0Jvb2xlYW59IHJhdyBUcnVlIHRvIGdldCB0aGUgcmF3IHJlc3VsdCwgZmFsc2UgdG8gZ2V0IHRoZSBoZXggcmVzdWx0XG4gICAgICpcbiAgICAgKiBAcmV0dXJuIHtTdHJpbmd8QXJyYXl9IFRoZSByZXN1bHRcbiAgICAgKi9cbiAgICBTcGFya01ENS5oYXNoID0gZnVuY3Rpb24gKHN0ciwgcmF3KSB7XG4gICAgICAgIC8vIGNvbnZlcnRzIHRoZSBzdHJpbmcgdG8gdXRmOCBieXRlcyBpZiBuZWNlc3NhcnlcbiAgICAgICAgaWYgKC9bXFx1MDA4MC1cXHVGRkZGXS8udGVzdChzdHIpKSB7XG4gICAgICAgICAgICBzdHIgPSB1bmVzY2FwZShlbmNvZGVVUklDb21wb25lbnQoc3RyKSk7XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgaGFzaCA9IG1kNTEoc3RyKTtcblxuICAgICAgICByZXR1cm4gISFyYXcgPyBoYXNoIDogaGV4KGhhc2gpO1xuICAgIH07XG5cbiAgICAvKipcbiAgICAgKiBQZXJmb3JtcyB0aGUgbWQ1IGhhc2ggb24gYSBiaW5hcnkgc3RyaW5nLlxuICAgICAqXG4gICAgICogQHBhcmFtIHtTdHJpbmd9ICBjb250ZW50IFRoZSBiaW5hcnkgc3RyaW5nXG4gICAgICogQHBhcmFtIHtCb29sZWFufSByYXcgICAgIFRydWUgdG8gZ2V0IHRoZSByYXcgcmVzdWx0LCBmYWxzZSB0byBnZXQgdGhlIGhleCByZXN1bHRcbiAgICAgKlxuICAgICAqIEByZXR1cm4ge1N0cmluZ3xBcnJheX0gVGhlIHJlc3VsdFxuICAgICAqL1xuICAgIFNwYXJrTUQ1Lmhhc2hCaW5hcnkgPSBmdW5jdGlvbiAoY29udGVudCwgcmF3KSB7XG4gICAgICAgIHZhciBoYXNoID0gbWQ1MShjb250ZW50KTtcblxuICAgICAgICByZXR1cm4gISFyYXcgPyBoYXNoIDogaGV4KGhhc2gpO1xuICAgIH07XG5cbiAgICAvKipcbiAgICAgKiBTcGFya01ENSBPT1AgaW1wbGVtZW50YXRpb24gZm9yIGFycmF5IGJ1ZmZlcnMuXG4gICAgICpcbiAgICAgKiBVc2UgdGhpcyBjbGFzcyB0byBwZXJmb3JtIGFuIGluY3JlbWVudGFsIG1kNSBPTkxZIGZvciBhcnJheSBidWZmZXJzLlxuICAgICAqL1xuICAgIFNwYXJrTUQ1LkFycmF5QnVmZmVyID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAvLyBjYWxsIHJlc2V0IHRvIGluaXQgdGhlIGluc3RhbmNlXG4gICAgICAgIHRoaXMucmVzZXQoKTtcbiAgICB9O1xuXG4gICAgLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vL1xuXG4gICAgLyoqXG4gICAgICogQXBwZW5kcyBhbiBhcnJheSBidWZmZXIuXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge0FycmF5QnVmZmVyfSBhcnIgVGhlIGFycmF5IHRvIGJlIGFwcGVuZGVkXG4gICAgICpcbiAgICAgKiBAcmV0dXJuIHtTcGFya01ENS5BcnJheUJ1ZmZlcn0gVGhlIGluc3RhbmNlIGl0c2VsZlxuICAgICAqL1xuICAgIFNwYXJrTUQ1LkFycmF5QnVmZmVyLnByb3RvdHlwZS5hcHBlbmQgPSBmdW5jdGlvbiAoYXJyKSB7XG4gICAgICAgIC8vIFRPRE86IHdlIGNvdWxkIGF2b2lkIHRoZSBjb25jYXRlbmF0aW9uIGhlcmUgYnV0IHRoZSBhbGdvcml0aG0gd291bGQgYmUgbW9yZSBjb21wbGV4XG4gICAgICAgIC8vICAgICAgIGlmIHlvdSBmaW5kIHlvdXJzZWxmIG5lZWRpbmcgZXh0cmEgcGVyZm9ybWFuY2UsIHBsZWFzZSBtYWtlIGEgUFIuXG4gICAgICAgIHZhciBidWZmID0gdGhpcy5fY29uY2F0QXJyYXlCdWZmZXIodGhpcy5fYnVmZiwgYXJyKSxcbiAgICAgICAgICAgIGxlbmd0aCA9IGJ1ZmYubGVuZ3RoLFxuICAgICAgICAgICAgaTtcblxuICAgICAgICB0aGlzLl9sZW5ndGggKz0gYXJyLmJ5dGVMZW5ndGg7XG5cbiAgICAgICAgZm9yIChpID0gNjQ7IGkgPD0gbGVuZ3RoOyBpICs9IDY0KSB7XG4gICAgICAgICAgICBtZDVjeWNsZSh0aGlzLl9zdGF0ZSwgbWQ1YmxrX2FycmF5KGJ1ZmYuc3ViYXJyYXkoaSAtIDY0LCBpKSkpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQXZvaWRzIElFMTAgd2VpcmRuZXNzIChkb2N1bWVudGVkIGFib3ZlKVxuICAgICAgICB0aGlzLl9idWZmID0gKGkgLSA2NCkgPCBsZW5ndGggPyBidWZmLnN1YmFycmF5KGkgLSA2NCkgOiBuZXcgVWludDhBcnJheSgwKTtcblxuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9O1xuXG4gICAgLyoqXG4gICAgICogRmluaXNoZXMgdGhlIGluY3JlbWVudGFsIGNvbXB1dGF0aW9uLCByZXNldGluZyB0aGUgaW50ZXJuYWwgc3RhdGUgYW5kXG4gICAgICogcmV0dXJuaW5nIHRoZSByZXN1bHQuXG4gICAgICogVXNlIHRoZSByYXcgcGFyYW1ldGVyIHRvIG9idGFpbiB0aGUgcmF3IHJlc3VsdCBpbnN0ZWFkIG9mIHRoZSBoZXggb25lLlxuICAgICAqXG4gICAgICogQHBhcmFtIHtCb29sZWFufSByYXcgVHJ1ZSB0byBnZXQgdGhlIHJhdyByZXN1bHQsIGZhbHNlIHRvIGdldCB0aGUgaGV4IHJlc3VsdFxuICAgICAqXG4gICAgICogQHJldHVybiB7U3RyaW5nfEFycmF5fSBUaGUgcmVzdWx0XG4gICAgICovXG4gICAgU3BhcmtNRDUuQXJyYXlCdWZmZXIucHJvdG90eXBlLmVuZCA9IGZ1bmN0aW9uIChyYXcpIHtcbiAgICAgICAgdmFyIGJ1ZmYgPSB0aGlzLl9idWZmLFxuICAgICAgICAgICAgbGVuZ3RoID0gYnVmZi5sZW5ndGgsXG4gICAgICAgICAgICB0YWlsID0gWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLFxuICAgICAgICAgICAgaSxcbiAgICAgICAgICAgIHJldDtcblxuICAgICAgICBmb3IgKGkgPSAwOyBpIDwgbGVuZ3RoOyBpICs9IDEpIHtcbiAgICAgICAgICAgIHRhaWxbaSA+PiAyXSB8PSBidWZmW2ldIDw8ICgoaSAlIDQpIDw8IDMpO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5fZmluaXNoKHRhaWwsIGxlbmd0aCk7XG4gICAgICAgIHJldCA9ICEhcmF3ID8gdGhpcy5fc3RhdGUgOiBoZXgodGhpcy5fc3RhdGUpO1xuXG4gICAgICAgIHRoaXMucmVzZXQoKTtcblxuICAgICAgICByZXR1cm4gcmV0O1xuICAgIH07XG5cbiAgICBTcGFya01ENS5BcnJheUJ1ZmZlci5wcm90b3R5cGUuX2ZpbmlzaCA9IFNwYXJrTUQ1LnByb3RvdHlwZS5fZmluaXNoO1xuXG4gICAgLyoqXG4gICAgICogUmVzZXRzIHRoZSBpbnRlcm5hbCBzdGF0ZSBvZiB0aGUgY29tcHV0YXRpb24uXG4gICAgICpcbiAgICAgKiBAcmV0dXJuIHtTcGFya01ENS5BcnJheUJ1ZmZlcn0gVGhlIGluc3RhbmNlIGl0c2VsZlxuICAgICAqL1xuICAgIFNwYXJrTUQ1LkFycmF5QnVmZmVyLnByb3RvdHlwZS5yZXNldCA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdGhpcy5fYnVmZiA9IG5ldyBVaW50OEFycmF5KDApO1xuICAgICAgICB0aGlzLl9sZW5ndGggPSAwO1xuICAgICAgICB0aGlzLl9zdGF0ZSA9IFsxNzMyNTg0MTkzLCAtMjcxNzMzODc5LCAtMTczMjU4NDE5NCwgMjcxNzMzODc4XTtcblxuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9O1xuXG4gICAgLyoqXG4gICAgICogUmVsZWFzZXMgbWVtb3J5IHVzZWQgYnkgdGhlIGluY3JlbWVudGFsIGJ1ZmZlciBhbmQgb3RoZXIgYWRpdGlvbmFsXG4gICAgICogcmVzb3VyY2VzLiBJZiB5b3UgcGxhbiB0byB1c2UgdGhlIGluc3RhbmNlIGFnYWluLCB1c2UgcmVzZXQgaW5zdGVhZC5cbiAgICAgKi9cbiAgICBTcGFya01ENS5BcnJheUJ1ZmZlci5wcm90b3R5cGUuZGVzdHJveSA9IFNwYXJrTUQ1LnByb3RvdHlwZS5kZXN0cm95O1xuXG4gICAgLyoqXG4gICAgICogQ29uY2F0cyB0d28gYXJyYXkgYnVmZmVycywgcmV0dXJuaW5nIGEgbmV3IG9uZS5cbiAgICAgKlxuICAgICAqIEBwYXJhbSAge0FycmF5QnVmZmVyfSBmaXJzdCAgVGhlIGZpcnN0IGFycmF5IGJ1ZmZlclxuICAgICAqIEBwYXJhbSAge0FycmF5QnVmZmVyfSBzZWNvbmQgVGhlIHNlY29uZCBhcnJheSBidWZmZXJcbiAgICAgKlxuICAgICAqIEByZXR1cm4ge0FycmF5QnVmZmVyfSBUaGUgbmV3IGFycmF5IGJ1ZmZlclxuICAgICAqL1xuICAgIFNwYXJrTUQ1LkFycmF5QnVmZmVyLnByb3RvdHlwZS5fY29uY2F0QXJyYXlCdWZmZXIgPSBmdW5jdGlvbiAoZmlyc3QsIHNlY29uZCkge1xuICAgICAgICB2YXIgZmlyc3RMZW5ndGggPSBmaXJzdC5sZW5ndGgsXG4gICAgICAgICAgICByZXN1bHQgPSBuZXcgVWludDhBcnJheShmaXJzdExlbmd0aCArIHNlY29uZC5ieXRlTGVuZ3RoKTtcblxuICAgICAgICByZXN1bHQuc2V0KGZpcnN0KTtcbiAgICAgICAgcmVzdWx0LnNldChuZXcgVWludDhBcnJheShzZWNvbmQpLCBmaXJzdExlbmd0aCk7XG5cbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9O1xuXG4gICAgLyoqXG4gICAgICogUGVyZm9ybXMgdGhlIG1kNSBoYXNoIG9uIGFuIGFycmF5IGJ1ZmZlci5cbiAgICAgKlxuICAgICAqIEBwYXJhbSB7QXJyYXlCdWZmZXJ9IGFyciBUaGUgYXJyYXkgYnVmZmVyXG4gICAgICogQHBhcmFtIHtCb29sZWFufSAgICAgcmF3IFRydWUgdG8gZ2V0IHRoZSByYXcgcmVzdWx0LCBmYWxzZSB0byBnZXQgdGhlIGhleCByZXN1bHRcbiAgICAgKlxuICAgICAqIEByZXR1cm4ge1N0cmluZ3xBcnJheX0gVGhlIHJlc3VsdFxuICAgICAqL1xuICAgIFNwYXJrTUQ1LkFycmF5QnVmZmVyLmhhc2ggPSBmdW5jdGlvbiAoYXJyLCByYXcpIHtcbiAgICAgICAgdmFyIGhhc2ggPSBtZDUxX2FycmF5KG5ldyBVaW50OEFycmF5KGFycikpO1xuXG4gICAgICAgIHJldHVybiAhIXJhdyA/IGhhc2ggOiBoZXgoaGFzaCk7XG4gICAgfTtcblxuICAgIHJldHVybiBTcGFya01ENTtcbn0pKTtcbiIsIid1c2Ugc3RyaWN0JztcblxuLyoqXG4gKiBTdHJpbmdpZnkvcGFyc2UgZnVuY3Rpb25zIHRoYXQgZG9uJ3Qgb3BlcmF0ZVxuICogcmVjdXJzaXZlbHksIHNvIHRoZXkgYXZvaWQgY2FsbCBzdGFjayBleGNlZWRlZFxuICogZXJyb3JzLlxuICovXG5leHBvcnRzLnN0cmluZ2lmeSA9IGZ1bmN0aW9uIHN0cmluZ2lmeShpbnB1dCkge1xuICB2YXIgcXVldWUgPSBbXTtcbiAgcXVldWUucHVzaCh7b2JqOiBpbnB1dH0pO1xuXG4gIHZhciByZXMgPSAnJztcbiAgdmFyIG5leHQsIG9iaiwgcHJlZml4LCB2YWwsIGksIGFycmF5UHJlZml4LCBrZXlzLCBrLCBrZXksIHZhbHVlLCBvYmpQcmVmaXg7XG4gIHdoaWxlICgobmV4dCA9IHF1ZXVlLnBvcCgpKSkge1xuICAgIG9iaiA9IG5leHQub2JqO1xuICAgIHByZWZpeCA9IG5leHQucHJlZml4IHx8ICcnO1xuICAgIHZhbCA9IG5leHQudmFsIHx8ICcnO1xuICAgIHJlcyArPSBwcmVmaXg7XG4gICAgaWYgKHZhbCkge1xuICAgICAgcmVzICs9IHZhbDtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBvYmogIT09ICdvYmplY3QnKSB7XG4gICAgICByZXMgKz0gdHlwZW9mIG9iaiA9PT0gJ3VuZGVmaW5lZCcgPyBudWxsIDogSlNPTi5zdHJpbmdpZnkob2JqKTtcbiAgICB9IGVsc2UgaWYgKG9iaiA9PT0gbnVsbCkge1xuICAgICAgcmVzICs9ICdudWxsJztcbiAgICB9IGVsc2UgaWYgKEFycmF5LmlzQXJyYXkob2JqKSkge1xuICAgICAgcXVldWUucHVzaCh7dmFsOiAnXSd9KTtcbiAgICAgIGZvciAoaSA9IG9iai5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgICAgICBhcnJheVByZWZpeCA9IGkgPT09IDAgPyAnJyA6ICcsJztcbiAgICAgICAgcXVldWUucHVzaCh7b2JqOiBvYmpbaV0sIHByZWZpeDogYXJyYXlQcmVmaXh9KTtcbiAgICAgIH1cbiAgICAgIHF1ZXVlLnB1c2goe3ZhbDogJ1snfSk7XG4gICAgfSBlbHNlIHsgLy8gb2JqZWN0XG4gICAgICBrZXlzID0gW107XG4gICAgICBmb3IgKGsgaW4gb2JqKSB7XG4gICAgICAgIGlmIChvYmouaGFzT3duUHJvcGVydHkoaykpIHtcbiAgICAgICAgICBrZXlzLnB1c2goayk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHF1ZXVlLnB1c2goe3ZhbDogJ30nfSk7XG4gICAgICBmb3IgKGkgPSBrZXlzLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7XG4gICAgICAgIGtleSA9IGtleXNbaV07XG4gICAgICAgIHZhbHVlID0gb2JqW2tleV07XG4gICAgICAgIG9ialByZWZpeCA9IChpID4gMCA/ICcsJyA6ICcnKTtcbiAgICAgICAgb2JqUHJlZml4ICs9IEpTT04uc3RyaW5naWZ5KGtleSkgKyAnOic7XG4gICAgICAgIHF1ZXVlLnB1c2goe29iajogdmFsdWUsIHByZWZpeDogb2JqUHJlZml4fSk7XG4gICAgICB9XG4gICAgICBxdWV1ZS5wdXNoKHt2YWw6ICd7J30pO1xuICAgIH1cbiAgfVxuICByZXR1cm4gcmVzO1xufTtcblxuLy8gQ29udmVuaWVuY2UgZnVuY3Rpb24gZm9yIHRoZSBwYXJzZSBmdW5jdGlvbi5cbi8vIFRoaXMgcG9wIGZ1bmN0aW9uIGlzIGJhc2ljYWxseSBjb3BpZWQgZnJvbVxuLy8gcG91Y2hDb2xsYXRlLnBhcnNlSW5kZXhhYmxlU3RyaW5nXG5mdW5jdGlvbiBwb3Aob2JqLCBzdGFjaywgbWV0YVN0YWNrKSB7XG4gIHZhciBsYXN0TWV0YUVsZW1lbnQgPSBtZXRhU3RhY2tbbWV0YVN0YWNrLmxlbmd0aCAtIDFdO1xuICBpZiAob2JqID09PSBsYXN0TWV0YUVsZW1lbnQuZWxlbWVudCkge1xuICAgIC8vIHBvcHBpbmcgYSBtZXRhLWVsZW1lbnQsIGUuZy4gYW4gb2JqZWN0IHdob3NlIHZhbHVlIGlzIGFub3RoZXIgb2JqZWN0XG4gICAgbWV0YVN0YWNrLnBvcCgpO1xuICAgIGxhc3RNZXRhRWxlbWVudCA9IG1ldGFTdGFja1ttZXRhU3RhY2subGVuZ3RoIC0gMV07XG4gIH1cbiAgdmFyIGVsZW1lbnQgPSBsYXN0TWV0YUVsZW1lbnQuZWxlbWVudDtcbiAgdmFyIGxhc3RFbGVtZW50SW5kZXggPSBsYXN0TWV0YUVsZW1lbnQuaW5kZXg7XG4gIGlmIChBcnJheS5pc0FycmF5KGVsZW1lbnQpKSB7XG4gICAgZWxlbWVudC5wdXNoKG9iaik7XG4gIH0gZWxzZSBpZiAobGFzdEVsZW1lbnRJbmRleCA9PT0gc3RhY2subGVuZ3RoIC0gMikgeyAvLyBvYmogd2l0aCBrZXkrdmFsdWVcbiAgICB2YXIga2V5ID0gc3RhY2sucG9wKCk7XG4gICAgZWxlbWVudFtrZXldID0gb2JqO1xuICB9IGVsc2Uge1xuICAgIHN0YWNrLnB1c2gob2JqKTsgLy8gb2JqIHdpdGgga2V5IG9ubHlcbiAgfVxufVxuXG5leHBvcnRzLnBhcnNlID0gZnVuY3Rpb24gKHN0cikge1xuICB2YXIgc3RhY2sgPSBbXTtcbiAgdmFyIG1ldGFTdGFjayA9IFtdOyAvLyBzdGFjayBmb3IgYXJyYXlzIGFuZCBvYmplY3RzXG4gIHZhciBpID0gMDtcbiAgdmFyIGNvbGxhdGlvbkluZGV4LHBhcnNlZE51bSxudW1DaGFyO1xuICB2YXIgcGFyc2VkU3RyaW5nLGxhc3RDaCxudW1Db25zZWN1dGl2ZVNsYXNoZXMsY2g7XG4gIHZhciBhcnJheUVsZW1lbnQsIG9iakVsZW1lbnQ7XG4gIHdoaWxlICh0cnVlKSB7XG4gICAgY29sbGF0aW9uSW5kZXggPSBzdHJbaSsrXTtcbiAgICBpZiAoY29sbGF0aW9uSW5kZXggPT09ICd9JyB8fFxuICAgICAgICBjb2xsYXRpb25JbmRleCA9PT0gJ10nIHx8XG4gICAgICAgIHR5cGVvZiBjb2xsYXRpb25JbmRleCA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgIGlmIChzdGFjay5sZW5ndGggPT09IDEpIHtcbiAgICAgICAgcmV0dXJuIHN0YWNrLnBvcCgpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcG9wKHN0YWNrLnBvcCgpLCBzdGFjaywgbWV0YVN0YWNrKTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgfVxuICAgIHN3aXRjaCAoY29sbGF0aW9uSW5kZXgpIHtcbiAgICAgIGNhc2UgJyAnOlxuICAgICAgY2FzZSAnXFx0JzpcbiAgICAgIGNhc2UgJ1xcbic6XG4gICAgICBjYXNlICc6JzpcbiAgICAgIGNhc2UgJywnOlxuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ24nOlxuICAgICAgICBpICs9IDM7IC8vICd1bGwnXG4gICAgICAgIHBvcChudWxsLCBzdGFjaywgbWV0YVN0YWNrKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICd0JzpcbiAgICAgICAgaSArPSAzOyAvLyAncnVlJ1xuICAgICAgICBwb3AodHJ1ZSwgc3RhY2ssIG1ldGFTdGFjayk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnZic6XG4gICAgICAgIGkgKz0gNDsgLy8gJ2Fsc2UnXG4gICAgICAgIHBvcChmYWxzZSwgc3RhY2ssIG1ldGFTdGFjayk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnMCc6XG4gICAgICBjYXNlICcxJzpcbiAgICAgIGNhc2UgJzInOlxuICAgICAgY2FzZSAnMyc6XG4gICAgICBjYXNlICc0JzpcbiAgICAgIGNhc2UgJzUnOlxuICAgICAgY2FzZSAnNic6XG4gICAgICBjYXNlICc3JzpcbiAgICAgIGNhc2UgJzgnOlxuICAgICAgY2FzZSAnOSc6XG4gICAgICBjYXNlICctJzpcbiAgICAgICAgcGFyc2VkTnVtID0gJyc7XG4gICAgICAgIGktLTtcbiAgICAgICAgd2hpbGUgKHRydWUpIHtcbiAgICAgICAgICBudW1DaGFyID0gc3RyW2krK107XG4gICAgICAgICAgaWYgKC9bXFxkXFwuXFwtZVxcK10vLnRlc3QobnVtQ2hhcikpIHtcbiAgICAgICAgICAgIHBhcnNlZE51bSArPSBudW1DaGFyO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBpLS07XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcG9wKHBhcnNlRmxvYXQocGFyc2VkTnVtKSwgc3RhY2ssIG1ldGFTdGFjayk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnXCInOlxuICAgICAgICBwYXJzZWRTdHJpbmcgPSAnJztcbiAgICAgICAgbGFzdENoID0gdm9pZCAwO1xuICAgICAgICBudW1Db25zZWN1dGl2ZVNsYXNoZXMgPSAwO1xuICAgICAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgICAgIGNoID0gc3RyW2krK107XG4gICAgICAgICAgaWYgKGNoICE9PSAnXCInIHx8IChsYXN0Q2ggPT09ICdcXFxcJyAmJlxuICAgICAgICAgICAgICBudW1Db25zZWN1dGl2ZVNsYXNoZXMgJSAyID09PSAxKSkge1xuICAgICAgICAgICAgcGFyc2VkU3RyaW5nICs9IGNoO1xuICAgICAgICAgICAgbGFzdENoID0gY2g7XG4gICAgICAgICAgICBpZiAobGFzdENoID09PSAnXFxcXCcpIHtcbiAgICAgICAgICAgICAgbnVtQ29uc2VjdXRpdmVTbGFzaGVzKys7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBudW1Db25zZWN1dGl2ZVNsYXNoZXMgPSAwO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcG9wKEpTT04ucGFyc2UoJ1wiJyArIHBhcnNlZFN0cmluZyArICdcIicpLCBzdGFjaywgbWV0YVN0YWNrKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdbJzpcbiAgICAgICAgYXJyYXlFbGVtZW50ID0geyBlbGVtZW50OiBbXSwgaW5kZXg6IHN0YWNrLmxlbmd0aCB9O1xuICAgICAgICBzdGFjay5wdXNoKGFycmF5RWxlbWVudC5lbGVtZW50KTtcbiAgICAgICAgbWV0YVN0YWNrLnB1c2goYXJyYXlFbGVtZW50KTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICd7JzpcbiAgICAgICAgb2JqRWxlbWVudCA9IHsgZWxlbWVudDoge30sIGluZGV4OiBzdGFjay5sZW5ndGggfTtcbiAgICAgICAgc3RhY2sucHVzaChvYmpFbGVtZW50LmVsZW1lbnQpO1xuICAgICAgICBtZXRhU3RhY2sucHVzaChvYmpFbGVtZW50KTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgJ3VuZXhwZWN0ZWRseSByZWFjaGVkIGVuZCBvZiBpbnB1dDogJyArIGNvbGxhdGlvbkluZGV4KTtcbiAgICB9XG4gIH1cbn07XG4iLG51bGwsIi8vIENvcHlyaWdodCBKb3llbnQsIEluYy4gYW5kIG90aGVyIE5vZGUgY29udHJpYnV0b3JzLlxuLy9cbi8vIFBlcm1pc3Npb24gaXMgaGVyZWJ5IGdyYW50ZWQsIGZyZWUgb2YgY2hhcmdlLCB0byBhbnkgcGVyc29uIG9idGFpbmluZyBhXG4vLyBjb3B5IG9mIHRoaXMgc29mdHdhcmUgYW5kIGFzc29jaWF0ZWQgZG9jdW1lbnRhdGlvbiBmaWxlcyAodGhlXG4vLyBcIlNvZnR3YXJlXCIpLCB0byBkZWFsIGluIHRoZSBTb2Z0d2FyZSB3aXRob3V0IHJlc3RyaWN0aW9uLCBpbmNsdWRpbmdcbi8vIHdpdGhvdXQgbGltaXRhdGlvbiB0aGUgcmlnaHRzIHRvIHVzZSwgY29weSwgbW9kaWZ5LCBtZXJnZSwgcHVibGlzaCxcbi8vIGRpc3RyaWJ1dGUsIHN1YmxpY2Vuc2UsIGFuZC9vciBzZWxsIGNvcGllcyBvZiB0aGUgU29mdHdhcmUsIGFuZCB0byBwZXJtaXRcbi8vIHBlcnNvbnMgdG8gd2hvbSB0aGUgU29mdHdhcmUgaXMgZnVybmlzaGVkIHRvIGRvIHNvLCBzdWJqZWN0IHRvIHRoZVxuLy8gZm9sbG93aW5nIGNvbmRpdGlvbnM6XG4vL1xuLy8gVGhlIGFib3ZlIGNvcHlyaWdodCBub3RpY2UgYW5kIHRoaXMgcGVybWlzc2lvbiBub3RpY2Ugc2hhbGwgYmUgaW5jbHVkZWRcbi8vIGluIGFsbCBjb3BpZXMgb3Igc3Vic3RhbnRpYWwgcG9ydGlvbnMgb2YgdGhlIFNvZnR3YXJlLlxuLy9cbi8vIFRIRSBTT0ZUV0FSRSBJUyBQUk9WSURFRCBcIkFTIElTXCIsIFdJVEhPVVQgV0FSUkFOVFkgT0YgQU5ZIEtJTkQsIEVYUFJFU1Ncbi8vIE9SIElNUExJRUQsIElOQ0xVRElORyBCVVQgTk9UIExJTUlURUQgVE8gVEhFIFdBUlJBTlRJRVMgT0Zcbi8vIE1FUkNIQU5UQUJJTElUWSwgRklUTkVTUyBGT1IgQSBQQVJUSUNVTEFSIFBVUlBPU0UgQU5EIE5PTklORlJJTkdFTUVOVC4gSU5cbi8vIE5PIEVWRU5UIFNIQUxMIFRIRSBBVVRIT1JTIE9SIENPUFlSSUdIVCBIT0xERVJTIEJFIExJQUJMRSBGT1IgQU5ZIENMQUlNLFxuLy8gREFNQUdFUyBPUiBPVEhFUiBMSUFCSUxJVFksIFdIRVRIRVIgSU4gQU4gQUNUSU9OIE9GIENPTlRSQUNULCBUT1JUIE9SXG4vLyBPVEhFUldJU0UsIEFSSVNJTkcgRlJPTSwgT1VUIE9GIE9SIElOIENPTk5FQ1RJT04gV0lUSCBUSEUgU09GVFdBUkUgT1IgVEhFXG4vLyBVU0UgT1IgT1RIRVIgREVBTElOR1MgSU4gVEhFIFNPRlRXQVJFLlxuXG5mdW5jdGlvbiBFdmVudEVtaXR0ZXIoKSB7XG4gIHRoaXMuX2V2ZW50cyA9IHRoaXMuX2V2ZW50cyB8fCB7fTtcbiAgdGhpcy5fbWF4TGlzdGVuZXJzID0gdGhpcy5fbWF4TGlzdGVuZXJzIHx8IHVuZGVmaW5lZDtcbn1cbm1vZHVsZS5leHBvcnRzID0gRXZlbnRFbWl0dGVyO1xuXG4vLyBCYWNrd2FyZHMtY29tcGF0IHdpdGggbm9kZSAwLjEwLnhcbkV2ZW50RW1pdHRlci5FdmVudEVtaXR0ZXIgPSBFdmVudEVtaXR0ZXI7XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUuX2V2ZW50cyA9IHVuZGVmaW5lZDtcbkV2ZW50RW1pdHRlci5wcm90b3R5cGUuX21heExpc3RlbmVycyA9IHVuZGVmaW5lZDtcblxuLy8gQnkgZGVmYXVsdCBFdmVudEVtaXR0ZXJzIHdpbGwgcHJpbnQgYSB3YXJuaW5nIGlmIG1vcmUgdGhhbiAxMCBsaXN0ZW5lcnMgYXJlXG4vLyBhZGRlZCB0byBpdC4gVGhpcyBpcyBhIHVzZWZ1bCBkZWZhdWx0IHdoaWNoIGhlbHBzIGZpbmRpbmcgbWVtb3J5IGxlYWtzLlxuRXZlbnRFbWl0dGVyLmRlZmF1bHRNYXhMaXN0ZW5lcnMgPSAxMDtcblxuLy8gT2J2aW91c2x5IG5vdCBhbGwgRW1pdHRlcnMgc2hvdWxkIGJlIGxpbWl0ZWQgdG8gMTAuIFRoaXMgZnVuY3Rpb24gYWxsb3dzXG4vLyB0aGF0IHRvIGJlIGluY3JlYXNlZC4gU2V0IHRvIHplcm8gZm9yIHVubGltaXRlZC5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUuc2V0TWF4TGlzdGVuZXJzID0gZnVuY3Rpb24obikge1xuICBpZiAoIWlzTnVtYmVyKG4pIHx8IG4gPCAwIHx8IGlzTmFOKG4pKVxuICAgIHRocm93IFR5cGVFcnJvcignbiBtdXN0IGJlIGEgcG9zaXRpdmUgbnVtYmVyJyk7XG4gIHRoaXMuX21heExpc3RlbmVycyA9IG47XG4gIHJldHVybiB0aGlzO1xufTtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5lbWl0ID0gZnVuY3Rpb24odHlwZSkge1xuICB2YXIgZXIsIGhhbmRsZXIsIGxlbiwgYXJncywgaSwgbGlzdGVuZXJzO1xuXG4gIGlmICghdGhpcy5fZXZlbnRzKVxuICAgIHRoaXMuX2V2ZW50cyA9IHt9O1xuXG4gIC8vIElmIHRoZXJlIGlzIG5vICdlcnJvcicgZXZlbnQgbGlzdGVuZXIgdGhlbiB0aHJvdy5cbiAgaWYgKHR5cGUgPT09ICdlcnJvcicpIHtcbiAgICBpZiAoIXRoaXMuX2V2ZW50cy5lcnJvciB8fFxuICAgICAgICAoaXNPYmplY3QodGhpcy5fZXZlbnRzLmVycm9yKSAmJiAhdGhpcy5fZXZlbnRzLmVycm9yLmxlbmd0aCkpIHtcbiAgICAgIGVyID0gYXJndW1lbnRzWzFdO1xuICAgICAgaWYgKGVyIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgICAgdGhyb3cgZXI7IC8vIFVuaGFuZGxlZCAnZXJyb3InIGV2ZW50XG4gICAgICB9XG4gICAgICB0aHJvdyBUeXBlRXJyb3IoJ1VuY2F1Z2h0LCB1bnNwZWNpZmllZCBcImVycm9yXCIgZXZlbnQuJyk7XG4gICAgfVxuICB9XG5cbiAgaGFuZGxlciA9IHRoaXMuX2V2ZW50c1t0eXBlXTtcblxuICBpZiAoaXNVbmRlZmluZWQoaGFuZGxlcikpXG4gICAgcmV0dXJuIGZhbHNlO1xuXG4gIGlmIChpc0Z1bmN0aW9uKGhhbmRsZXIpKSB7XG4gICAgc3dpdGNoIChhcmd1bWVudHMubGVuZ3RoKSB7XG4gICAgICAvLyBmYXN0IGNhc2VzXG4gICAgICBjYXNlIDE6XG4gICAgICAgIGhhbmRsZXIuY2FsbCh0aGlzKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlIDI6XG4gICAgICAgIGhhbmRsZXIuY2FsbCh0aGlzLCBhcmd1bWVudHNbMV0pO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgMzpcbiAgICAgICAgaGFuZGxlci5jYWxsKHRoaXMsIGFyZ3VtZW50c1sxXSwgYXJndW1lbnRzWzJdKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICAvLyBzbG93ZXJcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIGxlbiA9IGFyZ3VtZW50cy5sZW5ndGg7XG4gICAgICAgIGFyZ3MgPSBuZXcgQXJyYXkobGVuIC0gMSk7XG4gICAgICAgIGZvciAoaSA9IDE7IGkgPCBsZW47IGkrKylcbiAgICAgICAgICBhcmdzW2kgLSAxXSA9IGFyZ3VtZW50c1tpXTtcbiAgICAgICAgaGFuZGxlci5hcHBseSh0aGlzLCBhcmdzKTtcbiAgICB9XG4gIH0gZWxzZSBpZiAoaXNPYmplY3QoaGFuZGxlcikpIHtcbiAgICBsZW4gPSBhcmd1bWVudHMubGVuZ3RoO1xuICAgIGFyZ3MgPSBuZXcgQXJyYXkobGVuIC0gMSk7XG4gICAgZm9yIChpID0gMTsgaSA8IGxlbjsgaSsrKVxuICAgICAgYXJnc1tpIC0gMV0gPSBhcmd1bWVudHNbaV07XG5cbiAgICBsaXN0ZW5lcnMgPSBoYW5kbGVyLnNsaWNlKCk7XG4gICAgbGVuID0gbGlzdGVuZXJzLmxlbmd0aDtcbiAgICBmb3IgKGkgPSAwOyBpIDwgbGVuOyBpKyspXG4gICAgICBsaXN0ZW5lcnNbaV0uYXBwbHkodGhpcywgYXJncyk7XG4gIH1cblxuICByZXR1cm4gdHJ1ZTtcbn07XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUuYWRkTGlzdGVuZXIgPSBmdW5jdGlvbih0eXBlLCBsaXN0ZW5lcikge1xuICB2YXIgbTtcblxuICBpZiAoIWlzRnVuY3Rpb24obGlzdGVuZXIpKVxuICAgIHRocm93IFR5cGVFcnJvcignbGlzdGVuZXIgbXVzdCBiZSBhIGZ1bmN0aW9uJyk7XG5cbiAgaWYgKCF0aGlzLl9ldmVudHMpXG4gICAgdGhpcy5fZXZlbnRzID0ge307XG5cbiAgLy8gVG8gYXZvaWQgcmVjdXJzaW9uIGluIHRoZSBjYXNlIHRoYXQgdHlwZSA9PT0gXCJuZXdMaXN0ZW5lclwiISBCZWZvcmVcbiAgLy8gYWRkaW5nIGl0IHRvIHRoZSBsaXN0ZW5lcnMsIGZpcnN0IGVtaXQgXCJuZXdMaXN0ZW5lclwiLlxuICBpZiAodGhpcy5fZXZlbnRzLm5ld0xpc3RlbmVyKVxuICAgIHRoaXMuZW1pdCgnbmV3TGlzdGVuZXInLCB0eXBlLFxuICAgICAgICAgICAgICBpc0Z1bmN0aW9uKGxpc3RlbmVyLmxpc3RlbmVyKSA/XG4gICAgICAgICAgICAgIGxpc3RlbmVyLmxpc3RlbmVyIDogbGlzdGVuZXIpO1xuXG4gIGlmICghdGhpcy5fZXZlbnRzW3R5cGVdKVxuICAgIC8vIE9wdGltaXplIHRoZSBjYXNlIG9mIG9uZSBsaXN0ZW5lci4gRG9uJ3QgbmVlZCB0aGUgZXh0cmEgYXJyYXkgb2JqZWN0LlxuICAgIHRoaXMuX2V2ZW50c1t0eXBlXSA9IGxpc3RlbmVyO1xuICBlbHNlIGlmIChpc09iamVjdCh0aGlzLl9ldmVudHNbdHlwZV0pKVxuICAgIC8vIElmIHdlJ3ZlIGFscmVhZHkgZ290IGFuIGFycmF5LCBqdXN0IGFwcGVuZC5cbiAgICB0aGlzLl9ldmVudHNbdHlwZV0ucHVzaChsaXN0ZW5lcik7XG4gIGVsc2VcbiAgICAvLyBBZGRpbmcgdGhlIHNlY29uZCBlbGVtZW50LCBuZWVkIHRvIGNoYW5nZSB0byBhcnJheS5cbiAgICB0aGlzLl9ldmVudHNbdHlwZV0gPSBbdGhpcy5fZXZlbnRzW3R5cGVdLCBsaXN0ZW5lcl07XG5cbiAgLy8gQ2hlY2sgZm9yIGxpc3RlbmVyIGxlYWtcbiAgaWYgKGlzT2JqZWN0KHRoaXMuX2V2ZW50c1t0eXBlXSkgJiYgIXRoaXMuX2V2ZW50c1t0eXBlXS53YXJuZWQpIHtcbiAgICB2YXIgbTtcbiAgICBpZiAoIWlzVW5kZWZpbmVkKHRoaXMuX21heExpc3RlbmVycykpIHtcbiAgICAgIG0gPSB0aGlzLl9tYXhMaXN0ZW5lcnM7XG4gICAgfSBlbHNlIHtcbiAgICAgIG0gPSBFdmVudEVtaXR0ZXIuZGVmYXVsdE1heExpc3RlbmVycztcbiAgICB9XG5cbiAgICBpZiAobSAmJiBtID4gMCAmJiB0aGlzLl9ldmVudHNbdHlwZV0ubGVuZ3RoID4gbSkge1xuICAgICAgdGhpcy5fZXZlbnRzW3R5cGVdLndhcm5lZCA9IHRydWU7XG4gICAgICBjb25zb2xlLmVycm9yKCcobm9kZSkgd2FybmluZzogcG9zc2libGUgRXZlbnRFbWl0dGVyIG1lbW9yeSAnICtcbiAgICAgICAgICAgICAgICAgICAgJ2xlYWsgZGV0ZWN0ZWQuICVkIGxpc3RlbmVycyBhZGRlZC4gJyArXG4gICAgICAgICAgICAgICAgICAgICdVc2UgZW1pdHRlci5zZXRNYXhMaXN0ZW5lcnMoKSB0byBpbmNyZWFzZSBsaW1pdC4nLFxuICAgICAgICAgICAgICAgICAgICB0aGlzLl9ldmVudHNbdHlwZV0ubGVuZ3RoKTtcbiAgICAgIGlmICh0eXBlb2YgY29uc29sZS50cmFjZSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAvLyBub3Qgc3VwcG9ydGVkIGluIElFIDEwXG4gICAgICAgIGNvbnNvbGUudHJhY2UoKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gdGhpcztcbn07XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUub24gPSBFdmVudEVtaXR0ZXIucHJvdG90eXBlLmFkZExpc3RlbmVyO1xuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLm9uY2UgPSBmdW5jdGlvbih0eXBlLCBsaXN0ZW5lcikge1xuICBpZiAoIWlzRnVuY3Rpb24obGlzdGVuZXIpKVxuICAgIHRocm93IFR5cGVFcnJvcignbGlzdGVuZXIgbXVzdCBiZSBhIGZ1bmN0aW9uJyk7XG5cbiAgdmFyIGZpcmVkID0gZmFsc2U7XG5cbiAgZnVuY3Rpb24gZygpIHtcbiAgICB0aGlzLnJlbW92ZUxpc3RlbmVyKHR5cGUsIGcpO1xuXG4gICAgaWYgKCFmaXJlZCkge1xuICAgICAgZmlyZWQgPSB0cnVlO1xuICAgICAgbGlzdGVuZXIuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICB9XG4gIH1cblxuICBnLmxpc3RlbmVyID0gbGlzdGVuZXI7XG4gIHRoaXMub24odHlwZSwgZyk7XG5cbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vLyBlbWl0cyBhICdyZW1vdmVMaXN0ZW5lcicgZXZlbnQgaWZmIHRoZSBsaXN0ZW5lciB3YXMgcmVtb3ZlZFxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5yZW1vdmVMaXN0ZW5lciA9IGZ1bmN0aW9uKHR5cGUsIGxpc3RlbmVyKSB7XG4gIHZhciBsaXN0LCBwb3NpdGlvbiwgbGVuZ3RoLCBpO1xuXG4gIGlmICghaXNGdW5jdGlvbihsaXN0ZW5lcikpXG4gICAgdGhyb3cgVHlwZUVycm9yKCdsaXN0ZW5lciBtdXN0IGJlIGEgZnVuY3Rpb24nKTtcblxuICBpZiAoIXRoaXMuX2V2ZW50cyB8fCAhdGhpcy5fZXZlbnRzW3R5cGVdKVxuICAgIHJldHVybiB0aGlzO1xuXG4gIGxpc3QgPSB0aGlzLl9ldmVudHNbdHlwZV07XG4gIGxlbmd0aCA9IGxpc3QubGVuZ3RoO1xuICBwb3NpdGlvbiA9IC0xO1xuXG4gIGlmIChsaXN0ID09PSBsaXN0ZW5lciB8fFxuICAgICAgKGlzRnVuY3Rpb24obGlzdC5saXN0ZW5lcikgJiYgbGlzdC5saXN0ZW5lciA9PT0gbGlzdGVuZXIpKSB7XG4gICAgZGVsZXRlIHRoaXMuX2V2ZW50c1t0eXBlXTtcbiAgICBpZiAodGhpcy5fZXZlbnRzLnJlbW92ZUxpc3RlbmVyKVxuICAgICAgdGhpcy5lbWl0KCdyZW1vdmVMaXN0ZW5lcicsIHR5cGUsIGxpc3RlbmVyKTtcblxuICB9IGVsc2UgaWYgKGlzT2JqZWN0KGxpc3QpKSB7XG4gICAgZm9yIChpID0gbGVuZ3RoOyBpLS0gPiAwOykge1xuICAgICAgaWYgKGxpc3RbaV0gPT09IGxpc3RlbmVyIHx8XG4gICAgICAgICAgKGxpc3RbaV0ubGlzdGVuZXIgJiYgbGlzdFtpXS5saXN0ZW5lciA9PT0gbGlzdGVuZXIpKSB7XG4gICAgICAgIHBvc2l0aW9uID0gaTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHBvc2l0aW9uIDwgMClcbiAgICAgIHJldHVybiB0aGlzO1xuXG4gICAgaWYgKGxpc3QubGVuZ3RoID09PSAxKSB7XG4gICAgICBsaXN0Lmxlbmd0aCA9IDA7XG4gICAgICBkZWxldGUgdGhpcy5fZXZlbnRzW3R5cGVdO1xuICAgIH0gZWxzZSB7XG4gICAgICBsaXN0LnNwbGljZShwb3NpdGlvbiwgMSk7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX2V2ZW50cy5yZW1vdmVMaXN0ZW5lcilcbiAgICAgIHRoaXMuZW1pdCgncmVtb3ZlTGlzdGVuZXInLCB0eXBlLCBsaXN0ZW5lcik7XG4gIH1cblxuICByZXR1cm4gdGhpcztcbn07XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUucmVtb3ZlQWxsTGlzdGVuZXJzID0gZnVuY3Rpb24odHlwZSkge1xuICB2YXIga2V5LCBsaXN0ZW5lcnM7XG5cbiAgaWYgKCF0aGlzLl9ldmVudHMpXG4gICAgcmV0dXJuIHRoaXM7XG5cbiAgLy8gbm90IGxpc3RlbmluZyBmb3IgcmVtb3ZlTGlzdGVuZXIsIG5vIG5lZWQgdG8gZW1pdFxuICBpZiAoIXRoaXMuX2V2ZW50cy5yZW1vdmVMaXN0ZW5lcikge1xuICAgIGlmIChhcmd1bWVudHMubGVuZ3RoID09PSAwKVxuICAgICAgdGhpcy5fZXZlbnRzID0ge307XG4gICAgZWxzZSBpZiAodGhpcy5fZXZlbnRzW3R5cGVdKVxuICAgICAgZGVsZXRlIHRoaXMuX2V2ZW50c1t0eXBlXTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8vIGVtaXQgcmVtb3ZlTGlzdGVuZXIgZm9yIGFsbCBsaXN0ZW5lcnMgb24gYWxsIGV2ZW50c1xuICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMCkge1xuICAgIGZvciAoa2V5IGluIHRoaXMuX2V2ZW50cykge1xuICAgICAgaWYgKGtleSA9PT0gJ3JlbW92ZUxpc3RlbmVyJykgY29udGludWU7XG4gICAgICB0aGlzLnJlbW92ZUFsbExpc3RlbmVycyhrZXkpO1xuICAgIH1cbiAgICB0aGlzLnJlbW92ZUFsbExpc3RlbmVycygncmVtb3ZlTGlzdGVuZXInKTtcbiAgICB0aGlzLl9ldmVudHMgPSB7fTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIGxpc3RlbmVycyA9IHRoaXMuX2V2ZW50c1t0eXBlXTtcblxuICBpZiAoaXNGdW5jdGlvbihsaXN0ZW5lcnMpKSB7XG4gICAgdGhpcy5yZW1vdmVMaXN0ZW5lcih0eXBlLCBsaXN0ZW5lcnMpO1xuICB9IGVsc2Uge1xuICAgIC8vIExJRk8gb3JkZXJcbiAgICB3aGlsZSAobGlzdGVuZXJzLmxlbmd0aClcbiAgICAgIHRoaXMucmVtb3ZlTGlzdGVuZXIodHlwZSwgbGlzdGVuZXJzW2xpc3RlbmVycy5sZW5ndGggLSAxXSk7XG4gIH1cbiAgZGVsZXRlIHRoaXMuX2V2ZW50c1t0eXBlXTtcblxuICByZXR1cm4gdGhpcztcbn07XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUubGlzdGVuZXJzID0gZnVuY3Rpb24odHlwZSkge1xuICB2YXIgcmV0O1xuICBpZiAoIXRoaXMuX2V2ZW50cyB8fCAhdGhpcy5fZXZlbnRzW3R5cGVdKVxuICAgIHJldCA9IFtdO1xuICBlbHNlIGlmIChpc0Z1bmN0aW9uKHRoaXMuX2V2ZW50c1t0eXBlXSkpXG4gICAgcmV0ID0gW3RoaXMuX2V2ZW50c1t0eXBlXV07XG4gIGVsc2VcbiAgICByZXQgPSB0aGlzLl9ldmVudHNbdHlwZV0uc2xpY2UoKTtcbiAgcmV0dXJuIHJldDtcbn07XG5cbkV2ZW50RW1pdHRlci5saXN0ZW5lckNvdW50ID0gZnVuY3Rpb24oZW1pdHRlciwgdHlwZSkge1xuICB2YXIgcmV0O1xuICBpZiAoIWVtaXR0ZXIuX2V2ZW50cyB8fCAhZW1pdHRlci5fZXZlbnRzW3R5cGVdKVxuICAgIHJldCA9IDA7XG4gIGVsc2UgaWYgKGlzRnVuY3Rpb24oZW1pdHRlci5fZXZlbnRzW3R5cGVdKSlcbiAgICByZXQgPSAxO1xuICBlbHNlXG4gICAgcmV0ID0gZW1pdHRlci5fZXZlbnRzW3R5cGVdLmxlbmd0aDtcbiAgcmV0dXJuIHJldDtcbn07XG5cbmZ1bmN0aW9uIGlzRnVuY3Rpb24oYXJnKSB7XG4gIHJldHVybiB0eXBlb2YgYXJnID09PSAnZnVuY3Rpb24nO1xufVxuXG5mdW5jdGlvbiBpc051bWJlcihhcmcpIHtcbiAgcmV0dXJuIHR5cGVvZiBhcmcgPT09ICdudW1iZXInO1xufVxuXG5mdW5jdGlvbiBpc09iamVjdChhcmcpIHtcbiAgcmV0dXJuIHR5cGVvZiBhcmcgPT09ICdvYmplY3QnICYmIGFyZyAhPT0gbnVsbDtcbn1cblxuZnVuY3Rpb24gaXNVbmRlZmluZWQoYXJnKSB7XG4gIHJldHVybiBhcmcgPT09IHZvaWQgMDtcbn1cbiIsIi8vIHNoaW0gZm9yIHVzaW5nIHByb2Nlc3MgaW4gYnJvd3NlclxuXG52YXIgcHJvY2VzcyA9IG1vZHVsZS5leHBvcnRzID0ge307XG52YXIgcXVldWUgPSBbXTtcbnZhciBkcmFpbmluZyA9IGZhbHNlO1xuXG5mdW5jdGlvbiBkcmFpblF1ZXVlKCkge1xuICAgIGlmIChkcmFpbmluZykge1xuICAgICAgICByZXR1cm47XG4gICAgfVxuICAgIGRyYWluaW5nID0gdHJ1ZTtcbiAgICB2YXIgY3VycmVudFF1ZXVlO1xuICAgIHZhciBsZW4gPSBxdWV1ZS5sZW5ndGg7XG4gICAgd2hpbGUobGVuKSB7XG4gICAgICAgIGN1cnJlbnRRdWV1ZSA9IHF1ZXVlO1xuICAgICAgICBxdWV1ZSA9IFtdO1xuICAgICAgICB2YXIgaSA9IC0xO1xuICAgICAgICB3aGlsZSAoKytpIDwgbGVuKSB7XG4gICAgICAgICAgICBjdXJyZW50UXVldWVbaV0oKTtcbiAgICAgICAgfVxuICAgICAgICBsZW4gPSBxdWV1ZS5sZW5ndGg7XG4gICAgfVxuICAgIGRyYWluaW5nID0gZmFsc2U7XG59XG5wcm9jZXNzLm5leHRUaWNrID0gZnVuY3Rpb24gKGZ1bikge1xuICAgIHF1ZXVlLnB1c2goZnVuKTtcbiAgICBpZiAoIWRyYWluaW5nKSB7XG4gICAgICAgIHNldFRpbWVvdXQoZHJhaW5RdWV1ZSwgMCk7XG4gICAgfVxufTtcblxucHJvY2Vzcy50aXRsZSA9ICdicm93c2VyJztcbnByb2Nlc3MuYnJvd3NlciA9IHRydWU7XG5wcm9jZXNzLmVudiA9IHt9O1xucHJvY2Vzcy5hcmd2ID0gW107XG5wcm9jZXNzLnZlcnNpb24gPSAnJzsgLy8gZW1wdHkgc3RyaW5nIHRvIGF2b2lkIHJlZ2V4cCBpc3N1ZXNcbnByb2Nlc3MudmVyc2lvbnMgPSB7fTtcblxuZnVuY3Rpb24gbm9vcCgpIHt9XG5cbnByb2Nlc3Mub24gPSBub29wO1xucHJvY2Vzcy5hZGRMaXN0ZW5lciA9IG5vb3A7XG5wcm9jZXNzLm9uY2UgPSBub29wO1xucHJvY2Vzcy5vZmYgPSBub29wO1xucHJvY2Vzcy5yZW1vdmVMaXN0ZW5lciA9IG5vb3A7XG5wcm9jZXNzLnJlbW92ZUFsbExpc3RlbmVycyA9IG5vb3A7XG5wcm9jZXNzLmVtaXQgPSBub29wO1xuXG5wcm9jZXNzLmJpbmRpbmcgPSBmdW5jdGlvbiAobmFtZSkge1xuICAgIHRocm93IG5ldyBFcnJvcigncHJvY2Vzcy5iaW5kaW5nIGlzIG5vdCBzdXBwb3J0ZWQnKTtcbn07XG5cbi8vIFRPRE8oc2h0eWxtYW4pXG5wcm9jZXNzLmN3ZCA9IGZ1bmN0aW9uICgpIHsgcmV0dXJuICcvJyB9O1xucHJvY2Vzcy5jaGRpciA9IGZ1bmN0aW9uIChkaXIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3Byb2Nlc3MuY2hkaXIgaXMgbm90IHN1cHBvcnRlZCcpO1xufTtcbnByb2Nlc3MudW1hc2sgPSBmdW5jdGlvbigpIHsgcmV0dXJuIDA7IH07XG4iXX0=
