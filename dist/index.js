(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
var CORS_PROXY =  'http://crossorigin.me/';

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

      dbUrl = CORS_PROXY + dbUrl;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3Vzci9saWIvbm9kZV9tb2R1bGVzL3dhdGNoaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJpbmRleC5qcyIsImxpYi9nZXRUcmVlLmpzIiwibGliL21pblVuaXEuanMiLCJsaWIvdmlzdWFsaXplUmV2VHJlZS5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL2xpYi9hZGFwdGVyLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbGliL2FkYXB0ZXJzL2h0dHAvaHR0cC5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL2xpYi9hZGFwdGVycy9pZGIvaWRiLWFsbC1kb2NzLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbGliL2FkYXB0ZXJzL2lkYi9pZGItYmxvYi1zdXBwb3J0LmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbGliL2FkYXB0ZXJzL2lkYi9pZGItYnVsay1kb2NzLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbGliL2FkYXB0ZXJzL2lkYi9pZGItY29uc3RhbnRzLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbGliL2FkYXB0ZXJzL2lkYi9pZGItdXRpbHMuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9saWIvYWRhcHRlcnMvaWRiL2lkYi5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL2xpYi9hZGFwdGVycy9wcmVmZXJyZWRBZGFwdGVycy1icm93c2VyLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbGliL2FkYXB0ZXJzL3dlYnNxbC93ZWJzcWwtYnVsay1kb2NzLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbGliL2FkYXB0ZXJzL3dlYnNxbC93ZWJzcWwtY29uc3RhbnRzLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbGliL2FkYXB0ZXJzL3dlYnNxbC93ZWJzcWwtdXRpbHMuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9saWIvYWRhcHRlcnMvd2Vic3FsL3dlYnNxbC5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL2xpYi9jaGFuZ2VzLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbGliL2NoZWNrcG9pbnRlci5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL2xpYi9jb25zdHJ1Y3Rvci5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL2xpYi9kZXBzL2FqYXguanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9saWIvZGVwcy9ibG9iLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbGliL2RlcHMvYnVmZmVyLWJyb3dzZXIuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9saWIvZGVwcy9lcnJvcnMuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9saWIvZGVwcy9tZDUuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9saWIvZGVwcy9wYXJzZS1kb2MuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9saWIvZGVwcy9wYXJzZS1oZXguanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9saWIvZGVwcy9wYXJzZS11cmkuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9saWIvZGVwcy9yZXF1ZXN0LWJyb3dzZXIuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9saWIvZGVwcy91cHNlcnQuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9saWIvZGVwcy91dWlkLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbGliL2V2YWxGaWx0ZXIuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9saWIvZXZhbFZpZXcuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9saWIvaW5kZXguanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9saWIvbWVyZ2UuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9saWIvcmVwbGljYXRlLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbGliL3NldHVwLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbGliL3N5bmMuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9saWIvdGFza3F1ZXVlLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbGliL3V0aWxzLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbGliL3ZlcnNpb24tYnJvd3Nlci5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL25vZGVfbW9kdWxlcy9hcmdzYXJyYXkvaW5kZXguanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9ub2RlX21vZHVsZXMvZGVidWcvYnJvd3Nlci5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL25vZGVfbW9kdWxlcy9kZWJ1Zy9kZWJ1Zy5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL25vZGVfbW9kdWxlcy9kZWJ1Zy9ub2RlX21vZHVsZXMvbXMvaW5kZXguanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9ub2RlX21vZHVsZXMvaW5oZXJpdHMvaW5oZXJpdHNfYnJvd3Nlci5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL25vZGVfbW9kdWxlcy9saWUvbGliL0lOVEVSTkFMLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbm9kZV9tb2R1bGVzL2xpZS9saWIvYWxsLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbm9kZV9tb2R1bGVzL2xpZS9saWIvaGFuZGxlcnMuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9ub2RlX21vZHVsZXMvbGllL2xpYi9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL25vZGVfbW9kdWxlcy9saWUvbGliL3Byb21pc2UuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9ub2RlX21vZHVsZXMvbGllL2xpYi9xdWV1ZUl0ZW0uanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9ub2RlX21vZHVsZXMvbGllL2xpYi9yYWNlLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbm9kZV9tb2R1bGVzL2xpZS9saWIvcmVqZWN0LmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbm9kZV9tb2R1bGVzL2xpZS9saWIvcmVzb2x2ZS5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL25vZGVfbW9kdWxlcy9saWUvbGliL3Jlc29sdmVUaGVuYWJsZS5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL25vZGVfbW9kdWxlcy9saWUvbGliL3N0YXRlcy5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL25vZGVfbW9kdWxlcy9saWUvbGliL3RyeUNhdGNoLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbm9kZV9tb2R1bGVzL2xpZS9saWIvdW53cmFwLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbm9kZV9tb2R1bGVzL2xpZS9ub2RlX21vZHVsZXMvaW1tZWRpYXRlL2xpYi9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL25vZGVfbW9kdWxlcy9saWUvbm9kZV9tb2R1bGVzL2ltbWVkaWF0ZS9saWIvbWVzc2FnZUNoYW5uZWwuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9ub2RlX21vZHVsZXMvbGllL25vZGVfbW9kdWxlcy9pbW1lZGlhdGUvbGliL211dGF0aW9uLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbm9kZV9tb2R1bGVzL2xpZS9ub2RlX21vZHVsZXMvaW1tZWRpYXRlL2xpYi9zdGF0ZUNoYW5nZS5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL25vZGVfbW9kdWxlcy9saWUvbm9kZV9tb2R1bGVzL2ltbWVkaWF0ZS9saWIvdGltZW91dC5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL25vZGVfbW9kdWxlcy9wb3VjaGRiLWNvbGxhdGUvbGliL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbm9kZV9tb2R1bGVzL3BvdWNoZGItY29sbGF0ZS9saWIvdXRpbHMuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9ub2RlX21vZHVsZXMvcG91Y2hkYi1jb2xsZWN0aW9ucy9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL25vZGVfbW9kdWxlcy9wb3VjaGRiLWV4dGVuZC9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL25vZGVfbW9kdWxlcy9wb3VjaGRiLW1hcHJlZHVjZS9jcmVhdGUtdmlldy5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL25vZGVfbW9kdWxlcy9wb3VjaGRiLW1hcHJlZHVjZS9ldmFsZnVuYy5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL25vZGVfbW9kdWxlcy9wb3VjaGRiLW1hcHJlZHVjZS9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL25vZGVfbW9kdWxlcy9wb3VjaGRiLW1hcHJlZHVjZS90YXNrcXVldWUuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9ub2RlX21vZHVsZXMvcG91Y2hkYi1tYXByZWR1Y2UvdXBzZXJ0LmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbm9kZV9tb2R1bGVzL3BvdWNoZGItbWFwcmVkdWNlL3V0aWxzLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbm9kZV9tb2R1bGVzL3BvdWNoZGItdXBzZXJ0L2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbm9kZV9tb2R1bGVzL3NwYXJrLW1kNS9zcGFyay1tZDUuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9ub2RlX21vZHVsZXMvdnV2dXplbGEvaW5kZXguanMiLCIuLi8uLi8uLi8uLi91c3IvbGliL25vZGVfbW9kdWxlcy93YXRjaGlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnJvd3Nlci1yZXNvbHZlL2VtcHR5LmpzIiwiLi4vLi4vLi4vLi4vdXNyL2xpYi9ub2RlX21vZHVsZXMvd2F0Y2hpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2V2ZW50cy9ldmVudHMuanMiLCIuLi8uLi8uLi8uLi91c3IvbGliL25vZGVfbW9kdWxlcy93YXRjaGlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvcHJvY2Vzcy9icm93c2VyLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1SEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbkJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2UUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUMxeEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQzNpQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdkxBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM5REE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN6V0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDekJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7Ozs7QUNsUEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUNuOEJBOztBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNuVUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ25PQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeC9CQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDOVBBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQ3BHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7OztBQ3pLQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7O0FDeklBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUM1QkE7QUFDQTs7QUNEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQ3BRQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7O0FDL0VBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdEtBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2xFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzR0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNQQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbkZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDVkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUNwQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQ3pCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1U0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdG5CQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDck1BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeExBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDcEVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUN2ekJBO0FBQ0E7O0FDREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL0tBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNyTUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM0hBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNKQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDTEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdkNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDVkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDakNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDSkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUN4REE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7OztBQ2pCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7Ozs7QUNyQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7O0FDdkJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqV0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDckVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdEVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNuTEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzdFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDTkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUN0MkJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQ05BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7OztBQ3pHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7O0FDdkdBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2bEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM3S0E7O0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM3U0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCJ2YXIgQ09SU19QUk9YWSA9ICAnaHR0cDovL2Nyb3Nzb3JpZ2luLm1lLyc7XG5cbnZhciBQb3VjaERCID0gcmVxdWlyZSgncG91Y2hkYicpO1xudmFyIHZpc3VhbGl6ZVJldlRyZWUgPSByZXF1aXJlKCcuL2xpYi92aXN1YWxpemVSZXZUcmVlJyk7XG5cbnZhciBleHBvcnRXcmFwcGVyID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydCcpO1xudmFyIHBsYWNlaG9sZGVyID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3N2Z1BsYWNlaG9sZGVyJyk7XG52YXIgaW5mbyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdpbmZvJyk7XG52YXIgc3VibWl0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3N1Ym1pdCcpO1xuXG52YXIgZXJyb3IgPSBmdW5jdGlvbihlcnIpIHtcbiAgY29uc29sZS5sb2coZXJyKTtcbiAgdmFyIHN0ciA9ICcnO1xuICBpZiAoZXJyLmVycm9yKSB7XG4gICAgc3RyID0gJ2Vycm9yOiAnICsgZXJyLmVycm9yICsgJywgcmVhc29uOiAnICsgZXJyLnRvU3RyaW5nKCk7XG4gIH0gZWxzZSB7XG4gICAgc3RyID0gZXJyLnRvU3RyaW5nKCk7XG4gIH1cbiAgaW5mby5pbm5lckhUTUwgPSBcIldlIGVuY291bnRlcmVkIGFuIGVycm9yOiBcIiArIHN0cjtcbiAgc3VibWl0LnJlbW92ZUF0dHJpYnV0ZSgnZGlzYWJsZWQnKTtcbiAgZXhwb3J0V3JhcHBlci5zdHlsZS5kaXNwbGF5ID0gJ25vbmUnO1xufTtcblxuZnVuY3Rpb24gcGFyc2VVcmwoc3RyKSB7XG4gIHZhciB1cmwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdhJyk7XG4gIHVybC5ocmVmID0gc3RyO1xuICB2YXIgcGF0aCA9IHVybC5wYXRobmFtZS5zcGxpdCgnLycpO1xuXG4gIC8vIFJlbW92ZSAnJyBjYXVzZSBieSBwcmVjZWVkaW5nIC9cbiAgcGF0aC5zaGlmdCgpO1xuXG4gIHVybC5kYiA9IHBhdGguc2hpZnQoKTtcbiAgdXJsLmRvYyA9IHBhdGguam9pbignLycpO1xuXG4gIHVybC5kYlVybCA9IHVybC5wcm90b2NvbCArICcvLycgKyB1cmwuaG9zdCArICcvJyArIHVybC5kYjtcblxuICByZXR1cm4gdXJsO1xufVxuXG5mdW5jdGlvbiBpc0xvY2FsaG9zdChzdHIpIHtcbiAgdmFyIHVybCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2EnKTtcbiAgdXJsLmhyZWYgPSBzdHI7XG4gIHJldHVybiB1cmwuaG9zdCA9PT0gJ2xvY2FsaG9zdCcgfHwgdXJsLmhvc3QgPT09ICcxMjcuMC4wLjEnO1xufVxuXG5mdW5jdGlvbiBpbml0REIoZGJVcmwpIHtcbiAgcmV0dXJuIG5ldyBQb3VjaERCKGRiVXJsKS5jYXRjaChmdW5jdGlvbiAoZXJyKSB7XG4gICAgY29uc29sZS5sb2coJ2ZpcnN0IHRyeSBlcnJvcicsIGVycik7XG5cbiAgICBpZiAoaXNMb2NhbGhvc3QoZGJVcmwpICYmICFpc0xvY2FsaG9zdChsb2NhdGlvbi5ocmVmKSkge1xuICAgICAgYWxlcnQoJ0Nhbm5vdCByZWFjaCB5b3VyIGxvY2FsaG9zdCBmcm9tIHRoZSB3ZWIuIFRyeSBzb21ldGhpbmcgb25saW5lLicpO1xuICAgICAgdGhyb3cgJ0xvY2FsaG9zdCBub3QgcG9zc2libGUnO1xuICAgIH1cblxuICAgIC8vIExpa2VseSBhIENPUlMgcHJvYmxlbVxuICAgIGlmIChlcnIgJiYgZXJyLnN0YXR1cyA9PT0gNTAwKSB7XG4gICAgICBlcnJvcignUmUtdHJ5aW5nIHdpdGggY29ycyBwcm94eS4nKVxuXG4gICAgICBkYlVybCA9IENPUlNfUFJPWFkgKyBkYlVybDtcbiAgICAgIHJldHVybiBuZXcgUG91Y2hEQihkYlVybCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IGVycjtcbiAgICB9XG4gIH0pO1xufVxuXG5mdW5jdGlvbiBkb1Zpc3VhbGlzYXRpb24odXJsU3RyKSB7XG5cbiAgcGxhY2Vob2xkZXIuaW5uZXJIVE1MID0gJyc7XG4gIGluZm8uaW5uZXJIVE1MID0gJ0xvYWRpbmcgLi4uJztcbiAgZXhwb3J0V3JhcHBlci5zdHlsZS5kaXNwbGF5ID0gJ25vbmUnO1xuICBzdWJtaXQuc2V0QXR0cmlidXRlKCdkaXNhYmxlZCcsICdkaXNhYmxlZCcpO1xuXG4gIHZhciB1cmwgPSBwYXJzZVVybCh1cmxTdHIpO1xuXG4gIGluaXREQih1cmwuZGJVcmwpLnRoZW4oZnVuY3Rpb24oZGIpIHtcbiAgICByZXR1cm4gdmlzdWFsaXplUmV2VHJlZShkYiwgdXJsLmRvYykudGhlbihmdW5jdGlvbihib3gpIHtcbiAgICAgIHZhciBzdmcgPSBib3guZ2V0RWxlbWVudHNCeVRhZ05hbWUoJ3N2ZycpWzBdO1xuICAgICAgc3ZnLnN0eWxlLndpZHRoID0gc3ZnLmdldEF0dHJpYnV0ZSgndmlld0JveCcpLnNwbGl0KCcgJylbMl0gKiA3ICsgJ3B4JztcbiAgICAgIHN2Zy5zdHlsZS5oZWlnaHQgPSBzdmcuZ2V0QXR0cmlidXRlKCd2aWV3Qm94Jykuc3BsaXQoJyAnKVszXSAqIDcgKyAncHgnO1xuXG4gICAgICBwbGFjZWhvbGRlci5hcHBlbmRDaGlsZChib3gpO1xuICAgICAgaW5mby5pbm5lckhUTUwgPSAnJztcbiAgICAgIGV4cG9ydFdyYXBwZXIuc3R5bGUuZGlzcGxheSA9ICdibG9jayc7XG4gICAgICBzdWJtaXQucmVtb3ZlQXR0cmlidXRlKCdkaXNhYmxlZCcpO1xuICAgIH0pO1xuICB9LCBlcnJvcik7XG59XG5cbmZ1bmN0aW9uIGV4cG9ydERvYygpIHtcbiAgdmFyIHVybCA9IHBhcnNlVXJsKGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd1cmwnKS52YWx1ZSk7XG4gIGluaXREQih1cmwuZGJVcmwpLnRoZW4oZnVuY3Rpb24gKGRiKSB7XG4gICAgcmV0dXJuIGRiLmdldCh1cmwuZG9jLCB7cmV2czogdHJ1ZSwgb3Blbl9yZXZzOiBcImFsbFwifSkudGhlbihmdW5jdGlvbihyZXN1bHRzKSB7XG4gICAgICB2YXIgZG9jcyA9IHJlc3VsdHMubWFwKGZ1bmN0aW9uKHJvdyl7XG4gICAgICAgIHJldHVybiByb3cub2s7XG4gICAgICB9KTtcbiAgICAgIGNvbnNvbGUubG9nKFwiRXhwb3J0ZWQgZG9jczogXCIsIEpTT04uc3RyaW5naWZ5KGRvY3MpKTtcbiAgICAgIGNvbnNvbGUubG9nKFwiUG91Y2hkYiBmb3JtYXQ6IFwiLCBcImRiLmJ1bGtEb2NzKHtkb2NzOlwiICtcbiAgICAgICAgICAgICAgICAgIEpTT04uc3RyaW5naWZ5KGRvY3MpICtcbiAgICAgICAgICAgICAgICAgIFwifSwge25ld19lZGl0czpmYWxzZX0sIGZ1bmN0aW9uKGVyciwgcmVzKXt9KVwiKTtcbiAgICB9KTtcbiAgfSwgZXJyb3IpO1xufVxuXG5mdW5jdGlvbiBwYXJzZUFyZ3MoKSB7XG4gIHZhciBxdWVyeSA9IGxvY2F0aW9uLnNlYXJjaC5zdWJzdHIoMSk7XG4gIHZhciBkYXRhID0gcXVlcnkuc3BsaXQoXCImXCIpO1xuICB2YXIgcmVzdWx0ID0ge307XG4gIGZvcih2YXIgaSA9IDA7IGkgPCBkYXRhLmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIGl0ZW0gPSBkYXRhW2ldLnNwbGl0KFwiPVwiKTtcbiAgICByZXN1bHRbaXRlbVswXV0gPSBkZWNvZGVVUklDb21wb25lbnQoaXRlbVsxXSk7XG4gIH1cbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydEJ1dHRvbicpLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgZXhwb3J0RG9jKTtcblxudmFyIGFyZ3MgPSBwYXJzZUFyZ3MoKTtcbmlmIChhcmdzLnVybCkge1xuICAvLyBCcm93c2VycyBhcmUgc3R1cGlkIGFuZCBzb21ldGltZXMgYWRkIGEgLyB0byB0aGUgZW5kIG9mIHRoZSBxdWVyeSBwYXJhbVxuICB2YXIgdXJsID0gYXJncy51cmwucmVwbGFjZSgvXFwvKyQvLCBcIlwiKTtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3VybCcpLnZhbHVlID0gdXJsO1xuICBkb1Zpc3VhbGlzYXRpb24odXJsKTtcbn1cbiIsIm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKGRiLCBkb2NJZCkge1xuICByZXR1cm4gZGIuZ2V0KGRvY0lkKS5jYXRjaChmdW5jdGlvbiAoZXJyKSB7XG4gICAgaWYgKGVyci5yZWFzb24gIT09IFwiZGVsZXRlZFwiKSB7XG4gICAgICB0aHJvdyBlcnI7XG4gICAgfVxuICB9KS50aGVuKGZ1bmN0aW9uKGRvYyl7IC8vIGdldCB3aW5uaW5nIHJldmlzaW9uIGhlcmVcbiAgICB2YXIgd2lubmVyID0gZG9jLl9yZXY7XG4gICAgcmV0dXJuIGRiLmdldChkb2NJZCwge3JldnM6IHRydWUsIG9wZW5fcmV2czogXCJhbGxcIn0pLnRoZW4oZnVuY3Rpb24ocmVzdWx0cyl7XG4gICAgICB2YXIgZGVsZXRlZCA9IHt9O1xuICAgICAgdmFyIHBhdGhzID0gcmVzdWx0cy5tYXAoZnVuY3Rpb24ocmVzKSB7XG4gICAgICAgIHJlcyA9IHJlcy5vazsgLy8gVE9ETzogd2hhdCBhYm91dCBtaXNzaW5nXG4gICAgICAgIGlmIChyZXMuX2RlbGV0ZWQpIHtcbiAgICAgICAgICBkZWxldGVkW3Jlcy5fcmV2XSA9IHRydWU7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHJldnMgPSByZXMuX3JldmlzaW9ucztcbiAgICAgICAgcmV0dXJuIHJldnMuaWRzLm1hcChmdW5jdGlvbihpZCwgaSkge1xuICAgICAgICAgIHJldHVybiAocmV2cy5zdGFydC1pKSArICctJyArIGlkO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgcGF0aHM6IHBhdGhzLFxuICAgICAgICBkZWxldGVkOiBkZWxldGVkLFxuICAgICAgICB3aW5uZXI6IHdpbm5lclxuICAgICAgfTtcbiAgICB9KTtcbiAgfSk7XG59O1xuIiwiLy8gcmV0dXJucyBtaW5pbWFsIG51bWJlciBpIHN1Y2ggdGhhdCBwcmVmaXhlcyBvZiBsZW5naHQgaSBhcmUgdW5pcXVlXG4vLyBleDogW1wieHlhYWFcIiwgXCJ4eWJiYlwiLCBcInh5YmNjY1wiXSAtPiA0XG5mdW5jdGlvbiBzdHJDb21tb24oYSwgYil7XG4gIGlmIChhID09PSBiKSByZXR1cm4gYS5sZW5ndGg7XG4gIHZhciBpID0gMDtcbiAgd2hpbGUoKytpKXtcbiAgICBpZihhW2kgLSAxXSAhPT0gYltpIC0gMV0pIHJldHVybiBpO1xuICB9XG59XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oYXJyKXtcbiAgdmFyIGFycmF5ID0gYXJyLnNsaWNlKDApO1xuICB2YXIgY29tID0gMTtcbiAgYXJyYXkuc29ydCgpO1xuICBmb3IgKHZhciBpID0gMTsgaSA8IGFycmF5Lmxlbmd0aDsgaSsrKXtcbiAgICBjb20gPSBNYXRoLm1heChjb20sIHN0ckNvbW1vbihhcnJheVtpXSwgYXJyYXlbaSAtIDFdKSk7XG4gIH1cbiAgcmV0dXJuIGNvbTtcbn07XG4iLCJcInVzZSBzdHJpY3RcIjtcblxudmFyIGdldFRyZWUgPSByZXF1aXJlKCcuL2dldFRyZWUnKTtcbnZhciBtaW5VbmlxID0gcmVxdWlyZSgnLi9taW5VbmlxJyk7XG5cbnZhciBncmlkID0gMTA7XG52YXIgc2NhbGUgPSA3O1xudmFyIHIgPSAxO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKGRiLCBkb2NJZCwgY2FsbGJhY2spIHtcbiAgZnVuY3Rpb24gZHJhdyhwYXRocywgZGVsZXRlZCwgd2lubmVyLCBtaW5VbmlxKXtcbiAgICB2YXIgbWF4WCA9IGdyaWQ7XG4gICAgdmFyIG1heFkgPSBncmlkO1xuICAgIHZhciBsZXZlbENvdW50ID0gW107IC8vIG51bWVyIG9mIG5vZGVzIG9uIHNvbWUgbGV2ZWwgKHBvcylcblxuICAgIHZhciBtYXAgPSB7fTsgLy8gbWFwIGZyb20gcmV2IHRvIHBvc2l0aW9uXG4gICAgdmFyIGxldmVsQ291bnQgPSBbXTtcblxuICAgIGZ1bmN0aW9uIGRyYXdQYXRoKHBhdGgpIHtcbiAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcGF0aC5sZW5ndGg7IGkrKykge1xuICAgICAgICB2YXIgcmV2ID0gcGF0aFtpXTtcbiAgICAgICAgdmFyIGlzTGVhZiA9IGkgPT09IDA7XG4gICAgICAgIHZhciBwb3MgPSArcmV2LnNwbGl0KCctJylbMF07XG5cbiAgICAgICAgaWYgKCFsZXZlbENvdW50W3Bvc10pIHtcbiAgICAgICAgICBsZXZlbENvdW50W3Bvc10gPSAxO1xuICAgICAgICB9XG4gICAgICAgIHZhciB4ID0gbGV2ZWxDb3VudFtwb3NdICogZ3JpZDtcbiAgICAgICAgdmFyIHkgPSBwb3MgKiBncmlkO1xuXG4gICAgICAgIGlmICghaXNMZWFmKSB7XG4gICAgICAgICAgdmFyIG5leHRSZXYgPSBwYXRoW2ktMV07XG4gICAgICAgICAgdmFyIG5leHRYID0gbWFwW25leHRSZXZdWzBdO1xuICAgICAgICAgIHZhciBuZXh0WSA9IG1hcFtuZXh0UmV2XVsxXTtcblxuICAgICAgICAgIGlmIChtYXBbcmV2XSkge1xuICAgICAgICAgICAgeCA9IG1hcFtyZXZdWzBdO1xuICAgICAgICAgICAgeSA9IG1hcFtyZXZdWzFdO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGxpbmUoeCwgeSwgbmV4dFgsIG5leHRZKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAobWFwW3Jldl0pIHtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBtYXhYID0gTWF0aC5tYXgoeCwgbWF4WCk7XG4gICAgICAgIG1heFkgPSBNYXRoLm1heCh5LCBtYXhZKTtcbiAgICAgICAgbGV2ZWxDb3VudFtwb3NdKys7XG4gICAgICAgIG5vZGUoeCwgeSwgcmV2LCBpc0xlYWYsIHJldiBpbiBkZWxldGVkLCByZXYgPT09IHdpbm5lciwgbWluVW5pcSk7XG4gICAgICAgIG1hcFtyZXZdID0gW3gsIHldO1xuICAgICAgfVxuICAgIH1cbiAgICBwYXRocy5mb3JFYWNoKGRyYXdQYXRoKTtcblxuICAgIHN2Zy5zZXRBdHRyaWJ1dGUoJ3ZpZXdCb3gnLCAnMCAwICcgKyAobWF4WCArIGdyaWQpICsgJyAnICsgKG1heFkgKyBncmlkKSk7XG4gICAgc3ZnLnN0eWxlLndpZHRoID0gc2NhbGUgKiAobWF4WCArIGdyaWQpICsgJ3B4JztcbiAgICBzdmcuc3R5bGUuaGVpZ2h0ID0gc2NhbGUgKiAobWF4WSArIGdyaWQpICsgJ3B4JztcbiAgICByZXR1cm4gYm94O1xuICB9O1xuXG4gIGZ1bmN0aW9uIGVycm9yKGVycikge1xuICAgIGNvbnNvbGUuZXJyb3IoZXJyKTtcbiAgICBhbGVydChcImVycm9yIG9jY3VyZWQsIHNlZSBjb25zb2xlXCIpO1xuICB9XG5cbiAgdmFyIHB1dEFmdGVyID0gZnVuY3Rpb24oZG9jLCBwcmV2UmV2KXtcbiAgICB2YXIgbmV3RG9jID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShkb2MpKTtcbiAgICBuZXdEb2MuX3JldmlzaW9ucyA9IHtcbiAgICAgIHN0YXJ0OiArbmV3RG9jLl9yZXYuc3BsaXQoJy0nKVswXSxcbiAgICAgIGlkczogW1xuICAgICAgICBuZXdEb2MuX3Jldi5zcGxpdCgnLScpWzFdLFxuICAgICAgICBwcmV2UmV2LnNwbGl0KCctJylbMV1cbiAgICAgIF1cbiAgICB9O1xuICAgIHJldHVybiBkYi5wdXQobmV3RG9jLCB7bmV3X2VkaXRzOiBmYWxzZX0pO1xuICB9O1xuXG4gIHZhciBzdmdOUyA9IFwiaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmdcIjtcbiAgdmFyIGJveCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICBib3guY2xhc3NOYW1lID0gXCJ2aXN1YWxpemVSZXZUcmVlXCI7XG4gIHZhciBzdmcgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50TlMoc3ZnTlMsIFwic3ZnXCIpO1xuICBib3guYXBwZW5kQ2hpbGQoc3ZnKTtcbiAgdmFyIGxpbmVzQm94ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudE5TKHN2Z05TLCBcImdcIik7XG4gIHN2Zy5hcHBlbmRDaGlsZChsaW5lc0JveCk7XG4gIHZhciBjaXJjbGVzQm94ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudE5TKHN2Z05TLCBcImdcIik7XG4gIHN2Zy5hcHBlbmRDaGlsZChjaXJjbGVzQm94KTtcbiAgdmFyIHRleHRzQm94ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudE5TKHN2Z05TLCBcImdcIik7XG4gIHN2Zy5hcHBlbmRDaGlsZCh0ZXh0c0JveCk7XG5cbiAgdmFyIGNpcmMgPSBmdW5jdGlvbih4LCB5LCByLCBpc0xlYWYsIGlzRGVsZXRlZCwgaXNXaW5uZXIpIHtcbiAgICB2YXIgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50TlMoc3ZnTlMsIFwiY2lyY2xlXCIpO1xuICAgIGVsLnNldEF0dHJpYnV0ZU5TKG51bGwsIFwiY3hcIiwgeCk7XG4gICAgZWwuc2V0QXR0cmlidXRlTlMobnVsbCwgXCJjeVwiLCB5KTtcbiAgICBlbC5zZXRBdHRyaWJ1dGVOUyhudWxsLCBcInJcIiwgcik7XG4gICAgaWYgKGlzTGVhZikge1xuICAgICAgZWwuY2xhc3NMaXN0LmFkZChcImxlYWZcIik7XG4gICAgfVxuICAgIGlmIChpc1dpbm5lcikge1xuICAgICAgZWwuY2xhc3NMaXN0LmFkZChcIndpbm5lclwiKTtcbiAgICB9XG4gICAgaWYgKGlzRGVsZXRlZCkge1xuICAgICAgZWwuY2xhc3NMaXN0LmFkZChcImRlbGV0ZWRcIik7XG4gICAgfVxuICAgIGNpcmNsZXNCb3guYXBwZW5kQ2hpbGQoZWwpO1xuICAgIHJldHVybiBlbDtcbiAgfTtcblxuICB2YXIgbGluZSA9IGZ1bmN0aW9uKHgxLCB5MSwgeDIsIHkyKSB7XG4gICAgdmFyIGVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudE5TKHN2Z05TLCBcImxpbmVcIik7XG4gICAgZWwuc2V0QXR0cmlidXRlTlMobnVsbCwgXCJ4MVwiLCB4MSk7XG4gICAgZWwuc2V0QXR0cmlidXRlTlMobnVsbCwgXCJ5MVwiLCB5MSk7XG4gICAgZWwuc2V0QXR0cmlidXRlTlMobnVsbCwgXCJ4MlwiLCB4Mik7XG4gICAgZWwuc2V0QXR0cmlidXRlTlMobnVsbCwgXCJ5MlwiLCB5Mik7XG4gICAgbGluZXNCb3guYXBwZW5kQ2hpbGQoZWwpO1xuICAgIHJldHVybiBlbDtcbiAgfTtcblxuICB2YXIgZm9jdXNlZElucHV0O1xuICBmdW5jdGlvbiBpbnB1dCh0ZXh0KXtcbiAgICB2YXIgZGl2ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gICAgZGl2LmNsYXNzTGlzdC5hZGQoJ2lucHV0Jyk7XG4gICAgdmFyIHNwYW4gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdzcGFuJyk7XG4gICAgZGl2LmFwcGVuZENoaWxkKHNwYW4pO1xuICAgIHNwYW4uYXBwZW5kQ2hpbGQoZG9jdW1lbnQuY3JlYXRlVGV4dE5vZGUodGV4dCkpO1xuICAgIHZhciBjbGlja2VkID0gZmFsc2U7XG4gICAgdmFyIGlucHV0O1xuXG4gICAgZGl2Lm9uZGJsY2xpY2sgPSBmdW5jdGlvbigpIHtcbiAgICAgIGlmKGNsaWNrZWQpe1xuICAgICAgICBpbnB1dC5mb2N1cygpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBjbGlja2VkID0gdHJ1ZTtcbiAgICAgIGRpdi5yZW1vdmVDaGlsZChzcGFuKTtcbiAgICAgIGlucHV0ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnaW5wdXQnKTtcbiAgICAgIGRpdi5hcHBlbmRDaGlsZChpbnB1dCk7XG4gICAgICBpbnB1dC52YWx1ZSA9IHRleHQ7XG4gICAgICBpbnB1dC5mb2N1cygpO1xuXG4gICAgICBpbnB1dC5vbmtleWRvd24gPSBmdW5jdGlvbihlKXtcbiAgICAgICAgaWYoZS5rZXlDb2RlID09PSA5ICYmICFlLnNoaWZ0S2V5KXtcbiAgICAgICAgICB2YXIgbmV4dDtcbiAgICAgICAgICBpZihuZXh0ID0gdGhpcy5wYXJlbnROb2RlLnBhcmVudE5vZGUubmV4dFNpYmxpbmcpe1xuICAgICAgICAgICAgbmV4dC5maXJzdENoaWxkLm9uZGJsY2xpY2soKTtcbiAgICAgICAgICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH07XG4gICAgfTtcbiAgICBkaXYuZ2V0VmFsdWUgPSBmdW5jdGlvbigpIHtcbiAgICAgIHJldHVybiBjbGlja2VkID8gaW5wdXQudmFsdWUgOiB0ZXh0O1xuICAgIH07XG4gICAgcmV0dXJuIGRpdjtcbiAgfVxuXG4gIGZ1bmN0aW9uIG5vZGUoeCwgeSwgcmV2LCBpc0xlYWYsIGlzRGVsZXRlZCwgaXNXaW5uZXIsIHNob3J0RGVzY0xlbil7XG4gICAgdmFyIG5vZGVFbCA9IGNpcmMoeCwgeSwgciwgaXNMZWFmLCBpc0RlbGV0ZWQsIGlzV2lubmVyKTtcbiAgICB2YXIgcG9zID0gcmV2LnNwbGl0KCctJylbMF07XG4gICAgdmFyIGlkID0gcmV2LnNwbGl0KCctJylbMV07XG4gICAgdmFyIG9wZW5lZCA9IGZhbHNlO1xuXG4gICAgdmFyIGNsaWNrID0gZnVuY3Rpb24oKSB7XG4gICAgICBpZiAob3BlbmVkKSByZXR1cm47XG4gICAgICBvcGVuZWQgPSB0cnVlO1xuXG4gICAgICB2YXIgZGl2ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gICAgICBkaXYuY2xhc3NMaXN0LmFkZChcImVkaXRvclwiKTtcbiAgICAgIGRpdi5jbGFzc0xpc3QuYWRkKFwiYm94XCIpO1xuICAgICAgZGl2LnN0eWxlLmxlZnQgPSBzY2FsZSAqICh4ICsgMyAqIHIpICsgXCJweFwiO1xuICAgICAgZGl2LnN0eWxlLnRvcCA9IHNjYWxlICogKHkgLSAyKSArIFwicHhcIjtcbiAgICAgIGRpdi5zdHlsZS56SW5kZXggPSAxMDAwO1xuICAgICAgYm94LmFwcGVuZENoaWxkKGRpdik7XG5cbiAgICAgIHZhciBjbG9zZSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICBkaXYucGFyZW50Tm9kZS5yZW1vdmVDaGlsZChkaXYpO1xuICAgICAgICBvcGVuZWQgPSBmYWxzZTtcbiAgICAgIH07XG5cbiAgICAgIGRiLmdldChkb2NJZCwge3JldjogcmV2fSkudGhlbihmdW5jdGlvbihkb2Mpe1xuICAgICAgICB2YXIgZGwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkbCcpO1xuICAgICAgICB2YXIga2V5cyA9IFtdO1xuICAgICAgICB2YXIgYWRkUm93ID0gZnVuY3Rpb24oa2V5LCB2YWx1ZSl7XG4gICAgICAgICAgdmFyIGtleSA9IGlucHV0KGtleSk7XG4gICAgICAgICAga2V5cy5wdXNoKGtleSk7XG4gICAgICAgICAgdmFyIGR0ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZHQnKTtcbiAgICAgICAgICBkdC5hcHBlbmRDaGlsZChrZXkpO1xuICAgICAgICAgIGRsLmFwcGVuZENoaWxkKGR0KTtcbiAgICAgICAgICB2YXIgdmFsdWUgPSBpbnB1dCh2YWx1ZSk7XG4gICAgICAgICAga2V5LnZhbHVlSW5wdXQgPSB2YWx1ZTtcbiAgICAgICAgICB2YXIgZGQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkZCcpO1xuICAgICAgICAgIGRkLmFwcGVuZENoaWxkKHZhbHVlKTtcbiAgICAgICAgICBkbC5hcHBlbmRDaGlsZChkZCk7XG4gICAgICAgIH07XG4gICAgICAgIGZvciAodmFyIGkgaW4gZG9jKSB7XG4gICAgICAgICAgaWYgKGRvYy5oYXNPd25Qcm9wZXJ0eShpKSkge1xuICAgICAgICAgICAgYWRkUm93KGksIEpTT04uc3RyaW5naWZ5KGRvY1tpXSkpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBkaXYuYXBwZW5kQ2hpbGQoZGwpO1xuICAgICAgICB2YXIgYWRkQnV0dG9uID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYnV0dG9uJyk7XG4gICAgICAgIGFkZEJ1dHRvbi5hcHBlbmRDaGlsZChkb2N1bWVudC5jcmVhdGVUZXh0Tm9kZSgnYWRkIGZpZWxkJykpO1xuICAgICAgICBkaXYuYXBwZW5kQ2hpbGQoYWRkQnV0dG9uKTtcbiAgICAgICAgYWRkQnV0dG9uLm9uY2xpY2sgPSBmdW5jdGlvbigpe1xuICAgICAgICAgIGFkZFJvdygna2V5JywgJ3ZhbHVlJyk7XG4gICAgICAgIH07XG4gICAgICAgIHZhciBjYW5jZWxCdXR0b24gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdidXR0b24nKTtcbiAgICAgICAgY2FuY2VsQnV0dG9uLmFwcGVuZENoaWxkKGRvY3VtZW50LmNyZWF0ZVRleHROb2RlKCdjYW5jZWwnKSk7XG4gICAgICAgIGRpdi5hcHBlbmRDaGlsZChjYW5jZWxCdXR0b24pO1xuICAgICAgICBjYW5jZWxCdXR0b24ub25jbGljayA9IGNsb3NlO1xuICAgICAgICB2YXIgb2tCdXR0b24gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdidXR0b24nKTtcbiAgICAgICAgb2tCdXR0b24uYXBwZW5kQ2hpbGQoZG9jdW1lbnQuY3JlYXRlVGV4dE5vZGUoJ3NhdmUnKSk7XG4gICAgICAgIGRpdi5hcHBlbmRDaGlsZChva0J1dHRvbik7XG4gICAgICAgIG9rQnV0dG9uLm9uY2xpY2sgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICB2YXIgbmV3RG9jID0ge307XG4gICAgICAgICAga2V5cy5mb3JFYWNoKGZ1bmN0aW9uKGtleSl7XG4gICAgICAgICAgICB2YXIgdmFsdWUgPSBrZXkudmFsdWVJbnB1dC5nZXRWYWx1ZSgpO1xuICAgICAgICAgICAgaWYgKHZhbHVlLnJlcGxhY2UoL15cXHMqfFxccyokL2csICcnKSl7XG4gICAgICAgICAgICAgIG5ld0RvY1trZXkuZ2V0VmFsdWUoKV0gPSBKU09OLnBhcnNlKGtleS52YWx1ZUlucHV0LmdldFZhbHVlKCkpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pO1xuICAgICAgICAgIHB1dEFmdGVyKG5ld0RvYywgZG9jLl9yZXYpLnRoZW4oY2xvc2UsIGVycm9yKTtcbiAgICAgICAgfTtcbiAgICAgIH0sIGVycm9yKTtcbiAgICB9O1xuICAgIG5vZGVFbC5vbmNsaWNrID0gY2xpY2s7XG4gICAgbm9kZUVsLm9ubW91c2VvdmVyID0gZnVuY3Rpb24oKSB7XG4gICAgICB0aGlzLmNsYXNzTGlzdC5hZGQoXCJzZWxlY3RlZFwiKTtcbiAgICAgIC8vdGV4dC5zdHlsZS5kaXNwbGF5ID0gXCJibG9ja1wiO1xuICAgIH07XG4gICAgbm9kZUVsLm9ubW91c2VvdXQgPSBmdW5jdGlvbigpIHtcbiAgICAgIHRoaXMuY2xhc3NMaXN0LnJlbW92ZShcInNlbGVjdGVkXCIpO1xuICAgICAgLy90ZXh0LnN0eWxlLmRpc3BsYXkgPSBcIm5vbmVcIjtcbiAgICB9O1xuXG4gICAgdmFyIHRleHQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgICAvL3RleHQuc3R5bGUuZGlzcGxheSA9IFwibm9uZVwiO1xuICAgIHRleHQuY2xhc3NMaXN0LmFkZChcImJveFwiKTtcbiAgICB0ZXh0LnN0eWxlLmxlZnQgPSBzY2FsZSAqICh4ICsgMSAqIHIpICsgXCJweFwiO1xuICAgIHRleHQuc3R5bGUudG9wID0gc2NhbGUgKiAoeSAtIDUpICsgXCJweFwiO1xuICAgIHRleHQuc2hvcnQgPSBwb3MgKyAnLScgKyBpZC5zdWJzdHIoMCwgc2hvcnREZXNjTGVuKTtcbiAgICB0ZXh0LmxvbmcgPSBwb3MgKyAnLScgKyBpZDtcbiAgICB0ZXh0LmFwcGVuZENoaWxkKGRvY3VtZW50LmNyZWF0ZVRleHROb2RlKHRleHQuc2hvcnQpKTtcbiAgICB0ZXh0Lm9ubW91c2VvdmVyID0gZnVuY3Rpb24oKSB7XG4gICAgICB0aGlzLnN0eWxlLnpJbmRleCA9IDEwMDA7XG4gICAgfTtcbiAgICB0ZXh0Lm9ubW91c2VvdXQgPSBmdW5jdGlvbigpIHtcbiAgICAgIHRoaXMuc3R5bGUuekluZGV4ID0gMTtcbiAgICB9O1xuICAgIHRleHQub25jbGljayA9IGNsaWNrO1xuICAgIGJveC5hcHBlbmRDaGlsZCh0ZXh0KTtcbiAgfVxuXG4gIHZhciBmbGF0dGVuID0gZnVuY3Rpb24gKGFycmF5T2ZBcnJheXMpIHtcbiAgICByZXR1cm4gQXJyYXkucHJvdG90eXBlLmNvbmNhdC5hcHBseShbXSwgYXJyYXlPZkFycmF5cyk7XG4gIH07XG5cbiAgcmV0dXJuIGdldFRyZWUoZGIsIGRvY0lkKS50aGVuKGZ1bmN0aW9uICh0cmVlKSB7XG4gICAgdmFyIG1pblVuaXFMZW5ndGggPSBtaW5VbmlxKGZsYXR0ZW4odHJlZS5wYXRocykubWFwKGZ1bmN0aW9uKHJldikge1xuICAgICAgcmV0dXJuIHJldi5zcGxpdCgnLScpWzFdO1xuICAgIH0pKTtcbiAgICByZXR1cm4gZHJhdyh0cmVlLnBhdGhzLCB0cmVlLmRlbGV0ZWQsIHRyZWUud2lubmVyLCBtaW5VbmlxTGVuZ3RoKTtcbiAgfSk7XG59O1xuIiwiXCJ1c2Ugc3RyaWN0XCI7XG5cbnZhciB1dGlscyA9IHJlcXVpcmUoJy4vdXRpbHMnKTtcbnZhciBtZXJnZSA9IHJlcXVpcmUoJy4vbWVyZ2UnKTtcbnZhciBlcnJvcnMgPSByZXF1aXJlKCcuL2RlcHMvZXJyb3JzJyk7XG52YXIgRXZlbnRFbWl0dGVyID0gcmVxdWlyZSgnZXZlbnRzJykuRXZlbnRFbWl0dGVyO1xudmFyIHVwc2VydCA9IHJlcXVpcmUoJy4vZGVwcy91cHNlcnQnKTtcbnZhciBDaGFuZ2VzID0gcmVxdWlyZSgnLi9jaGFuZ2VzJyk7XG52YXIgUHJvbWlzZSA9IHV0aWxzLlByb21pc2U7XG5cbi8qXG4gKiBBIGdlbmVyaWMgcG91Y2ggYWRhcHRlclxuICovXG5cbi8vIHJldHVybnMgZmlyc3QgZWxlbWVudCBvZiBhcnIgc2F0aXNmeWluZyBjYWxsYmFjayBwcmVkaWNhdGVcbmZ1bmN0aW9uIGFycmF5Rmlyc3QoYXJyLCBjYWxsYmFjaykge1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGFyci5sZW5ndGg7IGkrKykge1xuICAgIGlmIChjYWxsYmFjayhhcnJbaV0sIGkpID09PSB0cnVlKSB7XG4gICAgICByZXR1cm4gYXJyW2ldO1xuICAgIH1cbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbi8vIFdyYXBwZXIgZm9yIGZ1bmN0aW9ucyB0aGF0IGNhbGwgdGhlIGJ1bGtkb2NzIGFwaSB3aXRoIGEgc2luZ2xlIGRvYyxcbi8vIGlmIHRoZSBmaXJzdCByZXN1bHQgaXMgYW4gZXJyb3IsIHJldHVybiBhbiBlcnJvclxuZnVuY3Rpb24geWFua0Vycm9yKGNhbGxiYWNrKSB7XG4gIHJldHVybiBmdW5jdGlvbiAoZXJyLCByZXN1bHRzKSB7XG4gICAgaWYgKGVyciB8fCAocmVzdWx0c1swXSAmJiByZXN1bHRzWzBdLmVycm9yKSkge1xuICAgICAgY2FsbGJhY2soZXJyIHx8IHJlc3VsdHNbMF0pO1xuICAgIH0gZWxzZSB7XG4gICAgICBjYWxsYmFjayhudWxsLCByZXN1bHRzLmxlbmd0aCA/IHJlc3VsdHNbMF0gIDogcmVzdWx0cyk7XG4gICAgfVxuICB9O1xufVxuXG4vLyBmb3IgZXZlcnkgbm9kZSBpbiBhIHJldmlzaW9uIHRyZWUgY29tcHV0ZXMgaXRzIGRpc3RhbmNlIGZyb20gdGhlIGNsb3Nlc3Rcbi8vIGxlYWZcbmZ1bmN0aW9uIGNvbXB1dGVIZWlnaHQocmV2cykge1xuICB2YXIgaGVpZ2h0ID0ge307XG4gIHZhciBlZGdlcyA9IFtdO1xuICBtZXJnZS50cmF2ZXJzZVJldlRyZWUocmV2cywgZnVuY3Rpb24gKGlzTGVhZiwgcG9zLCBpZCwgcHJudCkge1xuICAgIHZhciByZXYgPSBwb3MgKyBcIi1cIiArIGlkO1xuICAgIGlmIChpc0xlYWYpIHtcbiAgICAgIGhlaWdodFtyZXZdID0gMDtcbiAgICB9XG4gICAgaWYgKHBybnQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgZWRnZXMucHVzaCh7ZnJvbTogcHJudCwgdG86IHJldn0pO1xuICAgIH1cbiAgICByZXR1cm4gcmV2O1xuICB9KTtcblxuICBlZGdlcy5yZXZlcnNlKCk7XG4gIGVkZ2VzLmZvckVhY2goZnVuY3Rpb24gKGVkZ2UpIHtcbiAgICBpZiAoaGVpZ2h0W2VkZ2UuZnJvbV0gPT09IHVuZGVmaW5lZCkge1xuICAgICAgaGVpZ2h0W2VkZ2UuZnJvbV0gPSAxICsgaGVpZ2h0W2VkZ2UudG9dO1xuICAgIH0gZWxzZSB7XG4gICAgICBoZWlnaHRbZWRnZS5mcm9tXSA9IE1hdGgubWluKGhlaWdodFtlZGdlLmZyb21dLCAxICsgaGVpZ2h0W2VkZ2UudG9dKTtcbiAgICB9XG4gIH0pO1xuICByZXR1cm4gaGVpZ2h0O1xufVxuXG5mdW5jdGlvbiBhbGxEb2NzS2V5c1F1ZXJ5KGFwaSwgb3B0cywgY2FsbGJhY2spIHtcbiAgdmFyIGtleXMgPSAgKCdsaW1pdCcgaW4gb3B0cykgP1xuICAgICAgb3B0cy5rZXlzLnNsaWNlKG9wdHMuc2tpcCwgb3B0cy5saW1pdCArIG9wdHMuc2tpcCkgOlxuICAgICAgKG9wdHMuc2tpcCA+IDApID8gb3B0cy5rZXlzLnNsaWNlKG9wdHMuc2tpcCkgOiBvcHRzLmtleXM7XG4gIGlmIChvcHRzLmRlc2NlbmRpbmcpIHtcbiAgICBrZXlzLnJldmVyc2UoKTtcbiAgfVxuICBpZiAoIWtleXMubGVuZ3RoKSB7XG4gICAgcmV0dXJuIGFwaS5fYWxsRG9jcyh7bGltaXQ6IDB9LCBjYWxsYmFjayk7XG4gIH1cbiAgdmFyIGZpbmFsUmVzdWx0cyA9IHtcbiAgICBvZmZzZXQ6IG9wdHMuc2tpcFxuICB9O1xuICByZXR1cm4gUHJvbWlzZS5hbGwoa2V5cy5tYXAoZnVuY3Rpb24gKGtleSkge1xuICAgIHZhciBzdWJPcHRzID0gdXRpbHMuZXh0ZW5kKHRydWUsIHtrZXk6IGtleSwgZGVsZXRlZDogJ29rJ30sIG9wdHMpO1xuICAgIFsnbGltaXQnLCAnc2tpcCcsICdrZXlzJ10uZm9yRWFjaChmdW5jdGlvbiAob3B0S2V5KSB7XG4gICAgICBkZWxldGUgc3ViT3B0c1tvcHRLZXldO1xuICAgIH0pO1xuICAgIHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbiAocmVzb2x2ZSwgcmVqZWN0KSB7XG4gICAgICBhcGkuX2FsbERvY3Moc3ViT3B0cywgZnVuY3Rpb24gKGVyciwgcmVzKSB7XG4gICAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgICByZXR1cm4gcmVqZWN0KGVycik7XG4gICAgICAgIH1cbiAgICAgICAgZmluYWxSZXN1bHRzLnRvdGFsX3Jvd3MgPSByZXMudG90YWxfcm93cztcbiAgICAgICAgcmVzb2x2ZShyZXMucm93c1swXSB8fCB7a2V5OiBrZXksIGVycm9yOiAnbm90X2ZvdW5kJ30pO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH0pKS50aGVuKGZ1bmN0aW9uIChyZXN1bHRzKSB7XG4gICAgZmluYWxSZXN1bHRzLnJvd3MgPSByZXN1bHRzO1xuICAgIHJldHVybiBmaW5hbFJlc3VsdHM7XG4gIH0pO1xufVxuXG51dGlscy5pbmhlcml0cyhBYnN0cmFjdFBvdWNoREIsIEV2ZW50RW1pdHRlcik7XG5tb2R1bGUuZXhwb3J0cyA9IEFic3RyYWN0UG91Y2hEQjtcblxuZnVuY3Rpb24gQWJzdHJhY3RQb3VjaERCKCkge1xuICB2YXIgc2VsZiA9IHRoaXM7XG4gIEV2ZW50RW1pdHRlci5jYWxsKHRoaXMpO1xuXG4gIHZhciBsaXN0ZW5lcnMgPSAwLCBjaGFuZ2VzO1xuICB2YXIgZXZlbnROYW1lcyA9IFsnY2hhbmdlJywgJ2RlbGV0ZScsICdjcmVhdGUnLCAndXBkYXRlJ107XG4gIHRoaXMub24oJ25ld0xpc3RlbmVyJywgZnVuY3Rpb24gKGV2ZW50TmFtZSkge1xuICAgIGlmICh+ZXZlbnROYW1lcy5pbmRleE9mKGV2ZW50TmFtZSkpIHtcbiAgICAgIGlmIChsaXN0ZW5lcnMpIHtcbiAgICAgICAgbGlzdGVuZXJzKys7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGxpc3RlbmVycysrO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHZhciBsYXN0Q2hhbmdlID0gMDtcbiAgICBjaGFuZ2VzID0gdGhpcy5jaGFuZ2VzKHtcbiAgICAgIGNvbmZsaWN0czogdHJ1ZSxcbiAgICAgIGluY2x1ZGVfZG9jczogdHJ1ZSxcbiAgICAgIGNvbnRpbnVvdXM6IHRydWUsXG4gICAgICBzaW5jZTogJ25vdycsXG4gICAgICBvbkNoYW5nZTogZnVuY3Rpb24gKGNoYW5nZSkge1xuICAgICAgICBpZiAoY2hhbmdlLnNlcSA8PSBsYXN0Q2hhbmdlKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGxhc3RDaGFuZ2UgPSBjaGFuZ2Uuc2VxO1xuICAgICAgICBzZWxmLmVtaXQoJ2NoYW5nZScsIGNoYW5nZSk7XG4gICAgICAgIGlmIChjaGFuZ2UuZG9jLl9kZWxldGVkKSB7XG4gICAgICAgICAgc2VsZi5lbWl0KCdkZWxldGUnLCBjaGFuZ2UpO1xuICAgICAgICB9IGVsc2UgaWYgKGNoYW5nZS5kb2MuX3Jldi5zcGxpdCgnLScpWzBdID09PSAnMScpIHtcbiAgICAgICAgICBzZWxmLmVtaXQoJ2NyZWF0ZScsIGNoYW5nZSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgc2VsZi5lbWl0KCd1cGRhdGUnLCBjaGFuZ2UpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSk7XG4gIH0pO1xuICB0aGlzLm9uKCdyZW1vdmVMaXN0ZW5lcicsIGZ1bmN0aW9uIChldmVudE5hbWUpIHtcbiAgICBpZiAofmV2ZW50TmFtZXMuaW5kZXhPZihldmVudE5hbWUpKSB7XG4gICAgICBsaXN0ZW5lcnMtLTtcbiAgICAgIGlmIChsaXN0ZW5lcnMpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNoYW5nZXMuY2FuY2VsKCk7XG4gIH0pO1xufVxuXG5BYnN0cmFjdFBvdWNoREIucHJvdG90eXBlLnBvc3QgPVxuICB1dGlscy5hZGFwdGVyRnVuKCdwb3N0JywgZnVuY3Rpb24gKGRvYywgb3B0cywgY2FsbGJhY2spIHtcbiAgaWYgKHR5cGVvZiBvcHRzID09PSAnZnVuY3Rpb24nKSB7XG4gICAgY2FsbGJhY2sgPSBvcHRzO1xuICAgIG9wdHMgPSB7fTtcbiAgfVxuICBpZiAodHlwZW9mIGRvYyAhPT0gJ29iamVjdCcgfHwgQXJyYXkuaXNBcnJheShkb2MpKSB7XG4gICAgcmV0dXJuIGNhbGxiYWNrKGVycm9ycy5lcnJvcihlcnJvcnMuTk9UX0FOX09CSkVDVCkpO1xuICB9XG4gIHRoaXMuYnVsa0RvY3Moe2RvY3M6IFtkb2NdfSwgb3B0cywgeWFua0Vycm9yKGNhbGxiYWNrKSk7XG59KTtcblxuQWJzdHJhY3RQb3VjaERCLnByb3RvdHlwZS5wdXQgPVxuICB1dGlscy5hZGFwdGVyRnVuKCdwdXQnLCB1dGlscy5nZXRBcmd1bWVudHMoZnVuY3Rpb24gKGFyZ3MpIHtcbiAgdmFyIHRlbXAsIHRlbXB0eXBlLCBvcHRzLCBjYWxsYmFjaztcbiAgdmFyIGRvYyA9IGFyZ3Muc2hpZnQoKTtcbiAgdmFyIGlkID0gJ19pZCcgaW4gZG9jO1xuICBpZiAodHlwZW9mIGRvYyAhPT0gJ29iamVjdCcgfHwgQXJyYXkuaXNBcnJheShkb2MpKSB7XG4gICAgY2FsbGJhY2sgPSBhcmdzLnBvcCgpO1xuICAgIHJldHVybiBjYWxsYmFjayhlcnJvcnMuZXJyb3IoZXJyb3JzLk5PVF9BTl9PQkpFQ1QpKTtcbiAgfVxuICBkb2MgPSB1dGlscy5jbG9uZShkb2MpO1xuICB3aGlsZSAodHJ1ZSkge1xuICAgIHRlbXAgPSBhcmdzLnNoaWZ0KCk7XG4gICAgdGVtcHR5cGUgPSB0eXBlb2YgdGVtcDtcbiAgICBpZiAodGVtcHR5cGUgPT09IFwic3RyaW5nXCIgJiYgIWlkKSB7XG4gICAgICBkb2MuX2lkID0gdGVtcDtcbiAgICAgIGlkID0gdHJ1ZTtcbiAgICB9IGVsc2UgaWYgKHRlbXB0eXBlID09PSBcInN0cmluZ1wiICYmIGlkICYmICEoJ19yZXYnIGluIGRvYykpIHtcbiAgICAgIGRvYy5fcmV2ID0gdGVtcDtcbiAgICB9IGVsc2UgaWYgKHRlbXB0eXBlID09PSBcIm9iamVjdFwiKSB7XG4gICAgICBvcHRzID0gdGVtcDtcbiAgICB9IGVsc2UgaWYgKHRlbXB0eXBlID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIGNhbGxiYWNrID0gdGVtcDtcbiAgICB9XG4gICAgaWYgKCFhcmdzLmxlbmd0aCkge1xuICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG4gIG9wdHMgPSBvcHRzIHx8IHt9O1xuICB2YXIgZXJyb3IgPSB1dGlscy5pbnZhbGlkSWRFcnJvcihkb2MuX2lkKTtcbiAgaWYgKGVycm9yKSB7XG4gICAgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgfVxuICBpZiAodXRpbHMuaXNMb2NhbElkKGRvYy5faWQpICYmIHR5cGVvZiB0aGlzLl9wdXRMb2NhbCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIGlmIChkb2MuX2RlbGV0ZWQpIHtcbiAgICAgIHJldHVybiB0aGlzLl9yZW1vdmVMb2NhbChkb2MsIGNhbGxiYWNrKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIHRoaXMuX3B1dExvY2FsKGRvYywgY2FsbGJhY2spO1xuICAgIH1cbiAgfVxuICB0aGlzLmJ1bGtEb2NzKHtkb2NzOiBbZG9jXX0sIG9wdHMsIHlhbmtFcnJvcihjYWxsYmFjaykpO1xufSkpO1xuXG5BYnN0cmFjdFBvdWNoREIucHJvdG90eXBlLnB1dEF0dGFjaG1lbnQgPVxuICB1dGlscy5hZGFwdGVyRnVuKCdwdXRBdHRhY2htZW50JywgZnVuY3Rpb24gKGRvY0lkLCBhdHRhY2htZW50SWQsIHJldixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBibG9iLCB0eXBlLCBjYWxsYmFjaykge1xuICB2YXIgYXBpID0gdGhpcztcbiAgaWYgKHR5cGVvZiB0eXBlID09PSAnZnVuY3Rpb24nKSB7XG4gICAgY2FsbGJhY2sgPSB0eXBlO1xuICAgIHR5cGUgPSBibG9iO1xuICAgIGJsb2IgPSByZXY7XG4gICAgcmV2ID0gbnVsbDtcbiAgfVxuICBpZiAodHlwZW9mIHR5cGUgPT09ICd1bmRlZmluZWQnKSB7XG4gICAgdHlwZSA9IGJsb2I7XG4gICAgYmxvYiA9IHJldjtcbiAgICByZXYgPSBudWxsO1xuICB9XG5cbiAgZnVuY3Rpb24gY3JlYXRlQXR0YWNobWVudChkb2MpIHtcbiAgICBkb2MuX2F0dGFjaG1lbnRzID0gZG9jLl9hdHRhY2htZW50cyB8fCB7fTtcbiAgICBkb2MuX2F0dGFjaG1lbnRzW2F0dGFjaG1lbnRJZF0gPSB7XG4gICAgICBjb250ZW50X3R5cGU6IHR5cGUsXG4gICAgICBkYXRhOiBibG9iXG4gICAgfTtcbiAgICByZXR1cm4gYXBpLnB1dChkb2MpO1xuICB9XG5cbiAgcmV0dXJuIGFwaS5nZXQoZG9jSWQpLnRoZW4oZnVuY3Rpb24gKGRvYykge1xuICAgIGlmIChkb2MuX3JldiAhPT0gcmV2KSB7XG4gICAgICB0aHJvdyBlcnJvcnMuZXJyb3IoZXJyb3JzLlJFVl9DT05GTElDVCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGNyZWF0ZUF0dGFjaG1lbnQoZG9jKTtcbiAgfSwgZnVuY3Rpb24gKGVycikge1xuICAgICAvLyBjcmVhdGUgbmV3IGRvY1xuICAgIGlmIChlcnIucmVhc29uID09PSBlcnJvcnMuTUlTU0lOR19ET0MubWVzc2FnZSkge1xuICAgICAgcmV0dXJuIGNyZWF0ZUF0dGFjaG1lbnQoe19pZDogZG9jSWR9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgZXJyO1xuICAgIH1cbiAgfSk7XG59KTtcblxuQWJzdHJhY3RQb3VjaERCLnByb3RvdHlwZS5yZW1vdmVBdHRhY2htZW50ID1cbiAgdXRpbHMuYWRhcHRlckZ1bigncmVtb3ZlQXR0YWNobWVudCcsIGZ1bmN0aW9uIChkb2NJZCwgYXR0YWNobWVudElkLCByZXYsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2FsbGJhY2spIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICBzZWxmLmdldChkb2NJZCwgZnVuY3Rpb24gKGVyciwgb2JqKSB7XG4gICAgaWYgKGVycikge1xuICAgICAgY2FsbGJhY2soZXJyKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKG9iai5fcmV2ICE9PSByZXYpIHtcbiAgICAgIGNhbGxiYWNrKGVycm9ycy5lcnJvcihlcnJvcnMuUkVWX0NPTkZMSUNUKSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmICghb2JqLl9hdHRhY2htZW50cykge1xuICAgICAgcmV0dXJuIGNhbGxiYWNrKCk7XG4gICAgfVxuICAgIGRlbGV0ZSBvYmouX2F0dGFjaG1lbnRzW2F0dGFjaG1lbnRJZF07XG4gICAgaWYgKE9iamVjdC5rZXlzKG9iai5fYXR0YWNobWVudHMpLmxlbmd0aCA9PT0gMCkge1xuICAgICAgZGVsZXRlIG9iai5fYXR0YWNobWVudHM7XG4gICAgfVxuICAgIHNlbGYucHV0KG9iaiwgY2FsbGJhY2spO1xuICB9KTtcbn0pO1xuXG5BYnN0cmFjdFBvdWNoREIucHJvdG90eXBlLnJlbW92ZSA9XG4gIHV0aWxzLmFkYXB0ZXJGdW4oJ3JlbW92ZScsIGZ1bmN0aW9uIChkb2NPcklkLCBvcHRzT3JSZXYsIG9wdHMsIGNhbGxiYWNrKSB7XG4gIHZhciBkb2M7XG4gIGlmICh0eXBlb2Ygb3B0c09yUmV2ID09PSAnc3RyaW5nJykge1xuICAgIC8vIGlkLCByZXYsIG9wdHMsIGNhbGxiYWNrIHN0eWxlXG4gICAgZG9jID0ge1xuICAgICAgX2lkOiBkb2NPcklkLFxuICAgICAgX3Jldjogb3B0c09yUmV2XG4gICAgfTtcbiAgICBpZiAodHlwZW9mIG9wdHMgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIGNhbGxiYWNrID0gb3B0cztcbiAgICAgIG9wdHMgPSB7fTtcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgLy8gZG9jLCBvcHRzLCBjYWxsYmFjayBzdHlsZVxuICAgIGRvYyA9IGRvY09ySWQ7XG4gICAgaWYgKHR5cGVvZiBvcHRzT3JSZXYgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIGNhbGxiYWNrID0gb3B0c09yUmV2O1xuICAgICAgb3B0cyA9IHt9O1xuICAgIH0gZWxzZSB7XG4gICAgICBjYWxsYmFjayA9IG9wdHM7XG4gICAgICBvcHRzID0gb3B0c09yUmV2O1xuICAgIH1cbiAgfVxuICBvcHRzID0gdXRpbHMuY2xvbmUob3B0cyB8fCB7fSk7XG4gIG9wdHMud2FzX2RlbGV0ZSA9IHRydWU7XG4gIHZhciBuZXdEb2MgPSB7X2lkOiBkb2MuX2lkLCBfcmV2OiAoZG9jLl9yZXYgfHwgb3B0cy5yZXYpfTtcbiAgbmV3RG9jLl9kZWxldGVkID0gdHJ1ZTtcbiAgaWYgKHV0aWxzLmlzTG9jYWxJZChuZXdEb2MuX2lkKSAmJiB0eXBlb2YgdGhpcy5fcmVtb3ZlTG9jYWwgPT09ICdmdW5jdGlvbicpIHtcbiAgICByZXR1cm4gdGhpcy5fcmVtb3ZlTG9jYWwoZG9jLCBjYWxsYmFjayk7XG4gIH1cbiAgdGhpcy5idWxrRG9jcyh7ZG9jczogW25ld0RvY119LCBvcHRzLCB5YW5rRXJyb3IoY2FsbGJhY2spKTtcbn0pO1xuXG5BYnN0cmFjdFBvdWNoREIucHJvdG90eXBlLnJldnNEaWZmID1cbiAgdXRpbHMuYWRhcHRlckZ1bigncmV2c0RpZmYnLCBmdW5jdGlvbiAocmVxLCBvcHRzLCBjYWxsYmFjaykge1xuICBpZiAodHlwZW9mIG9wdHMgPT09ICdmdW5jdGlvbicpIHtcbiAgICBjYWxsYmFjayA9IG9wdHM7XG4gICAgb3B0cyA9IHt9O1xuICB9XG4gIG9wdHMgPSB1dGlscy5jbG9uZShvcHRzKTtcbiAgdmFyIGlkcyA9IE9iamVjdC5rZXlzKHJlcSk7XG5cbiAgaWYgKCFpZHMubGVuZ3RoKSB7XG4gICAgcmV0dXJuIGNhbGxiYWNrKG51bGwsIHt9KTtcbiAgfVxuXG4gIHZhciBjb3VudCA9IDA7XG4gIHZhciBtaXNzaW5nID0gbmV3IHV0aWxzLk1hcCgpO1xuXG4gIGZ1bmN0aW9uIGFkZFRvTWlzc2luZyhpZCwgcmV2SWQpIHtcbiAgICBpZiAoIW1pc3NpbmcuaGFzKGlkKSkge1xuICAgICAgbWlzc2luZy5zZXQoaWQsIHttaXNzaW5nOiBbXX0pO1xuICAgIH1cbiAgICBtaXNzaW5nLmdldChpZCkubWlzc2luZy5wdXNoKHJldklkKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHByb2Nlc3NEb2MoaWQsIHJldl90cmVlKSB7XG4gICAgLy8gSXMgdGhpcyBmYXN0IGVub3VnaD8gTWF5YmUgd2Ugc2hvdWxkIHN3aXRjaCB0byBhIHNldCBzaW11bGF0ZWQgYnkgYSBtYXBcbiAgICB2YXIgbWlzc2luZ0ZvcklkID0gcmVxW2lkXS5zbGljZSgwKTtcbiAgICBtZXJnZS50cmF2ZXJzZVJldlRyZWUocmV2X3RyZWUsIGZ1bmN0aW9uIChpc0xlYWYsIHBvcywgcmV2SGFzaCwgY3R4LFxuICAgICAgb3B0cykge1xuICAgICAgICB2YXIgcmV2ID0gcG9zICsgJy0nICsgcmV2SGFzaDtcbiAgICAgICAgdmFyIGlkeCA9IG1pc3NpbmdGb3JJZC5pbmRleE9mKHJldik7XG4gICAgICAgIGlmIChpZHggPT09IC0xKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgbWlzc2luZ0ZvcklkLnNwbGljZShpZHgsIDEpO1xuICAgICAgICBpZiAob3B0cy5zdGF0dXMgIT09ICdhdmFpbGFibGUnKSB7XG4gICAgICAgICAgYWRkVG9NaXNzaW5nKGlkLCByZXYpO1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgIC8vIFRyYXZlcnNpbmcgdGhlIHRyZWUgaXMgc3luY2hyb25vdXMsIHNvIG5vdyBgbWlzc2luZ0ZvcklkYCBjb250YWluc1xuICAgIC8vIHJldmlzaW9ucyB0aGF0IHdlcmUgbm90IGZvdW5kIGluIHRoZSB0cmVlXG4gICAgbWlzc2luZ0ZvcklkLmZvckVhY2goZnVuY3Rpb24gKHJldikge1xuICAgICAgYWRkVG9NaXNzaW5nKGlkLCByZXYpO1xuICAgIH0pO1xuICB9XG5cbiAgaWRzLm1hcChmdW5jdGlvbiAoaWQpIHtcbiAgICB0aGlzLl9nZXRSZXZpc2lvblRyZWUoaWQsIGZ1bmN0aW9uIChlcnIsIHJldl90cmVlKSB7XG4gICAgICBpZiAoZXJyICYmIGVyci5zdGF0dXMgPT09IDQwNCAmJiBlcnIubWVzc2FnZSA9PT0gJ21pc3NpbmcnKSB7XG4gICAgICAgIG1pc3Npbmcuc2V0KGlkLCB7bWlzc2luZzogcmVxW2lkXX0pO1xuICAgICAgfSBlbHNlIGlmIChlcnIpIHtcbiAgICAgICAgcmV0dXJuIGNhbGxiYWNrKGVycik7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBwcm9jZXNzRG9jKGlkLCByZXZfdHJlZSk7XG4gICAgICB9XG5cbiAgICAgIGlmICgrK2NvdW50ID09PSBpZHMubGVuZ3RoKSB7XG4gICAgICAgIC8vIGNvbnZlcnQgTGF6eU1hcCB0byBvYmplY3RcbiAgICAgICAgdmFyIG1pc3NpbmdPYmogPSB7fTtcbiAgICAgICAgbWlzc2luZy5mb3JFYWNoKGZ1bmN0aW9uICh2YWx1ZSwga2V5KSB7XG4gICAgICAgICAgbWlzc2luZ09ialtrZXldID0gdmFsdWU7XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gY2FsbGJhY2sobnVsbCwgbWlzc2luZ09iaik7XG4gICAgICB9XG4gICAgfSk7XG4gIH0sIHRoaXMpO1xufSk7XG5cbi8vIGNvbXBhY3Qgb25lIGRvY3VtZW50IGFuZCBmaXJlIGNhbGxiYWNrXG4vLyBieSBjb21wYWN0aW5nIHdlIG1lYW4gcmVtb3ZpbmcgYWxsIHJldmlzaW9ucyB3aGljaFxuLy8gYXJlIGZ1cnRoZXIgZnJvbSB0aGUgbGVhZiBpbiByZXZpc2lvbiB0cmVlIHRoYW4gbWF4X2hlaWdodFxuQWJzdHJhY3RQb3VjaERCLnByb3RvdHlwZS5jb21wYWN0RG9jdW1lbnQgPVxuICB1dGlscy5hZGFwdGVyRnVuKCdjb21wYWN0RG9jdW1lbnQnLCBmdW5jdGlvbiAoZG9jSWQsIG1heEhlaWdodCwgY2FsbGJhY2spIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICB0aGlzLl9nZXRSZXZpc2lvblRyZWUoZG9jSWQsIGZ1bmN0aW9uIChlcnIsIHJldlRyZWUpIHtcbiAgICBpZiAoZXJyKSB7XG4gICAgICByZXR1cm4gY2FsbGJhY2soZXJyKTtcbiAgICB9XG4gICAgdmFyIGhlaWdodCA9IGNvbXB1dGVIZWlnaHQocmV2VHJlZSk7XG4gICAgdmFyIGNhbmRpZGF0ZXMgPSBbXTtcbiAgICB2YXIgcmV2cyA9IFtdO1xuICAgIE9iamVjdC5rZXlzKGhlaWdodCkuZm9yRWFjaChmdW5jdGlvbiAocmV2KSB7XG4gICAgICBpZiAoaGVpZ2h0W3Jldl0gPiBtYXhIZWlnaHQpIHtcbiAgICAgICAgY2FuZGlkYXRlcy5wdXNoKHJldik7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBtZXJnZS50cmF2ZXJzZVJldlRyZWUocmV2VHJlZSwgZnVuY3Rpb24gKGlzTGVhZiwgcG9zLCByZXZIYXNoLCBjdHgsIG9wdHMpIHtcbiAgICAgIHZhciByZXYgPSBwb3MgKyAnLScgKyByZXZIYXNoO1xuICAgICAgaWYgKG9wdHMuc3RhdHVzID09PSAnYXZhaWxhYmxlJyAmJiBjYW5kaWRhdGVzLmluZGV4T2YocmV2KSAhPT0gLTEpIHtcbiAgICAgICAgcmV2cy5wdXNoKHJldik7XG4gICAgICB9XG4gICAgfSk7XG4gICAgc2VsZi5fZG9Db21wYWN0aW9uKGRvY0lkLCByZXZzLCBjYWxsYmFjayk7XG4gIH0pO1xufSk7XG5cbi8vIGNvbXBhY3QgdGhlIHdob2xlIGRhdGFiYXNlIHVzaW5nIHNpbmdsZSBkb2N1bWVudFxuLy8gY29tcGFjdGlvblxuQWJzdHJhY3RQb3VjaERCLnByb3RvdHlwZS5jb21wYWN0ID1cbiAgdXRpbHMuYWRhcHRlckZ1bignY29tcGFjdCcsIGZ1bmN0aW9uIChvcHRzLCBjYWxsYmFjaykge1xuICBpZiAodHlwZW9mIG9wdHMgPT09ICdmdW5jdGlvbicpIHtcbiAgICBjYWxsYmFjayA9IG9wdHM7XG4gICAgb3B0cyA9IHt9O1xuICB9XG4gIHZhciBzZWxmID0gdGhpcztcblxuICBvcHRzID0gdXRpbHMuY2xvbmUob3B0cyB8fCB7fSk7XG5cbiAgc2VsZi5nZXQoJ19sb2NhbC9jb21wYWN0aW9uJylbXCJjYXRjaFwiXShmdW5jdGlvbiAoKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9KS50aGVuKGZ1bmN0aW9uIChkb2MpIHtcbiAgICBpZiAodHlwZW9mIHNlbGYuX2NvbXBhY3QgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIGlmIChkb2MgJiYgZG9jLmxhc3Rfc2VxKSB7XG4gICAgICAgIG9wdHMubGFzdF9zZXEgPSBkb2MubGFzdF9zZXE7XG4gICAgICB9XG4gICAgICByZXR1cm4gc2VsZi5fY29tcGFjdChvcHRzLCBjYWxsYmFjayk7XG4gICAgfVxuXG4gIH0pO1xufSk7XG5BYnN0cmFjdFBvdWNoREIucHJvdG90eXBlLl9jb21wYWN0ID0gZnVuY3Rpb24gKG9wdHMsIGNhbGxiYWNrKSB7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgdmFyIGNoYW5nZXNPcHRzID0ge1xuICAgIHJldHVybkRvY3M6IGZhbHNlLFxuICAgIGxhc3Rfc2VxOiBvcHRzLmxhc3Rfc2VxIHx8IDBcbiAgfTtcbiAgdmFyIHByb21pc2VzID0gW107XG5cbiAgZnVuY3Rpb24gb25DaGFuZ2Uocm93KSB7XG4gICAgcHJvbWlzZXMucHVzaChzZWxmLmNvbXBhY3REb2N1bWVudChyb3cuaWQsIDApKTtcbiAgfVxuICBmdW5jdGlvbiBvbkNvbXBsZXRlKHJlc3ApIHtcbiAgICB2YXIgbGFzdFNlcSA9IHJlc3AubGFzdF9zZXE7XG4gICAgUHJvbWlzZS5hbGwocHJvbWlzZXMpLnRoZW4oZnVuY3Rpb24gKCkge1xuICAgICAgcmV0dXJuIHVwc2VydChzZWxmLCAnX2xvY2FsL2NvbXBhY3Rpb24nLCBmdW5jdGlvbiBkZWx0YUZ1bmMoZG9jKSB7XG4gICAgICAgIGlmICghZG9jLmxhc3Rfc2VxIHx8IGRvYy5sYXN0X3NlcSA8IGxhc3RTZXEpIHtcbiAgICAgICAgICBkb2MubGFzdF9zZXEgPSBsYXN0U2VxO1xuICAgICAgICAgIHJldHVybiBkb2M7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGZhbHNlOyAvLyBzb21lYm9keSBlbHNlIGdvdCBoZXJlIGZpcnN0LCBkb24ndCB1cGRhdGVcbiAgICAgIH0pO1xuICAgIH0pLnRoZW4oZnVuY3Rpb24gKCkge1xuICAgICAgY2FsbGJhY2sobnVsbCwge29rOiB0cnVlfSk7XG4gICAgfSlbXCJjYXRjaFwiXShjYWxsYmFjayk7XG4gIH1cbiAgc2VsZi5jaGFuZ2VzKGNoYW5nZXNPcHRzKVxuICAgIC5vbignY2hhbmdlJywgb25DaGFuZ2UpXG4gICAgLm9uKCdjb21wbGV0ZScsIG9uQ29tcGxldGUpXG4gICAgLm9uKCdlcnJvcicsIGNhbGxiYWNrKTtcbn07XG4vKiBCZWdpbiBhcGkgd3JhcHBlcnMuIFNwZWNpZmljIGZ1bmN0aW9uYWxpdHkgdG8gc3RvcmFnZSBiZWxvbmdzIGluIHRoZSBcbiAgIF9bbWV0aG9kXSAqL1xuQWJzdHJhY3RQb3VjaERCLnByb3RvdHlwZS5nZXQgPVxuICB1dGlscy5hZGFwdGVyRnVuKCdnZXQnLCBmdW5jdGlvbiAoaWQsIG9wdHMsIGNhbGxiYWNrKSB7XG4gIGlmICh0eXBlb2Ygb3B0cyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIGNhbGxiYWNrID0gb3B0cztcbiAgICBvcHRzID0ge307XG4gIH1cbiAgaWYgKHR5cGVvZiBpZCAhPT0gJ3N0cmluZycpIHtcbiAgICByZXR1cm4gY2FsbGJhY2soZXJyb3JzLmVycm9yKGVycm9ycy5JTlZBTElEX0lEKSk7XG4gIH1cbiAgaWYgKHV0aWxzLmlzTG9jYWxJZChpZCkgJiYgdHlwZW9mIHRoaXMuX2dldExvY2FsID09PSAnZnVuY3Rpb24nKSB7XG4gICAgcmV0dXJuIHRoaXMuX2dldExvY2FsKGlkLCBjYWxsYmFjayk7XG4gIH1cbiAgdmFyIGxlYXZlcyA9IFtdLCBzZWxmID0gdGhpcztcblxuICBmdW5jdGlvbiBmaW5pc2hPcGVuUmV2cygpIHtcbiAgICB2YXIgcmVzdWx0ID0gW107XG4gICAgdmFyIGNvdW50ID0gbGVhdmVzLmxlbmd0aDtcbiAgICBpZiAoIWNvdW50KSB7XG4gICAgICByZXR1cm4gY2FsbGJhY2sobnVsbCwgcmVzdWx0KTtcbiAgICB9XG4gICAgLy8gb3JkZXIgd2l0aCBvcGVuX3JldnMgaXMgdW5zcGVjaWZpZWRcbiAgICBsZWF2ZXMuZm9yRWFjaChmdW5jdGlvbiAobGVhZikge1xuICAgICAgc2VsZi5nZXQoaWQsIHtcbiAgICAgICAgcmV2OiBsZWFmLFxuICAgICAgICByZXZzOiBvcHRzLnJldnMsXG4gICAgICAgIGF0dGFjaG1lbnRzOiBvcHRzLmF0dGFjaG1lbnRzXG4gICAgICB9LCBmdW5jdGlvbiAoZXJyLCBkb2MpIHtcbiAgICAgICAgaWYgKCFlcnIpIHtcbiAgICAgICAgICByZXN1bHQucHVzaCh7b2s6IGRvY30pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJlc3VsdC5wdXNoKHttaXNzaW5nOiBsZWFmfSk7XG4gICAgICAgIH1cbiAgICAgICAgY291bnQtLTtcbiAgICAgICAgaWYgKCFjb3VudCkge1xuICAgICAgICAgIGNhbGxiYWNrKG51bGwsIHJlc3VsdCk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgaWYgKG9wdHMub3Blbl9yZXZzKSB7XG4gICAgaWYgKG9wdHMub3Blbl9yZXZzID09PSBcImFsbFwiKSB7XG4gICAgICB0aGlzLl9nZXRSZXZpc2lvblRyZWUoaWQsIGZ1bmN0aW9uIChlcnIsIHJldl90cmVlKSB7XG4gICAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgICByZXR1cm4gY2FsbGJhY2soZXJyKTtcbiAgICAgICAgfVxuICAgICAgICBsZWF2ZXMgPSBtZXJnZS5jb2xsZWN0TGVhdmVzKHJldl90cmVlKS5tYXAoZnVuY3Rpb24gKGxlYWYpIHtcbiAgICAgICAgICByZXR1cm4gbGVhZi5yZXY7XG4gICAgICAgIH0pO1xuICAgICAgICBmaW5pc2hPcGVuUmV2cygpO1xuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmIChBcnJheS5pc0FycmF5KG9wdHMub3Blbl9yZXZzKSkge1xuICAgICAgICBsZWF2ZXMgPSBvcHRzLm9wZW5fcmV2cztcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZWF2ZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICB2YXIgbCA9IGxlYXZlc1tpXTtcbiAgICAgICAgICAvLyBsb29rcyBsaWtlIGl0J3MgdGhlIG9ubHkgdGhpbmcgY291Y2hkYiBjaGVja3NcbiAgICAgICAgICBpZiAoISh0eXBlb2YobCkgPT09IFwic3RyaW5nXCIgJiYgL15cXGQrLS8udGVzdChsKSkpIHtcbiAgICAgICAgICAgIHJldHVybiBjYWxsYmFjayhlcnJvcnMuZXJyb3IoZXJyb3JzLklOVkFMSURfUkVWKSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGZpbmlzaE9wZW5SZXZzKCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gY2FsbGJhY2soZXJyb3JzLmVycm9yKGVycm9ycy5VTktOT1dOX0VSUk9SLFxuICAgICAgICAgICdmdW5jdGlvbl9jbGF1c2UnKSk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybjsgLy8gb3Blbl9yZXZzIGRvZXMgbm90IGxpa2Ugb3RoZXIgb3B0aW9uc1xuICB9XG5cbiAgcmV0dXJuIHRoaXMuX2dldChpZCwgb3B0cywgZnVuY3Rpb24gKGVyciwgcmVzdWx0KSB7XG4gICAgb3B0cyA9IHV0aWxzLmNsb25lKG9wdHMpO1xuICAgIGlmIChlcnIpIHtcbiAgICAgIHJldHVybiBjYWxsYmFjayhlcnIpO1xuICAgIH1cblxuICAgIHZhciBkb2MgPSByZXN1bHQuZG9jO1xuICAgIHZhciBtZXRhZGF0YSA9IHJlc3VsdC5tZXRhZGF0YTtcbiAgICB2YXIgY3R4ID0gcmVzdWx0LmN0eDtcblxuICAgIGlmIChvcHRzLmNvbmZsaWN0cykge1xuICAgICAgdmFyIGNvbmZsaWN0cyA9IG1lcmdlLmNvbGxlY3RDb25mbGljdHMobWV0YWRhdGEpO1xuICAgICAgaWYgKGNvbmZsaWN0cy5sZW5ndGgpIHtcbiAgICAgICAgZG9jLl9jb25mbGljdHMgPSBjb25mbGljdHM7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHV0aWxzLmlzRGVsZXRlZChtZXRhZGF0YSwgZG9jLl9yZXYpKSB7XG4gICAgICBkb2MuX2RlbGV0ZWQgPSB0cnVlO1xuICAgIH1cblxuICAgIGlmIChvcHRzLnJldnMgfHwgb3B0cy5yZXZzX2luZm8pIHtcbiAgICAgIHZhciBwYXRocyA9IG1lcmdlLnJvb3RUb0xlYWYobWV0YWRhdGEucmV2X3RyZWUpO1xuICAgICAgdmFyIHBhdGggPSBhcnJheUZpcnN0KHBhdGhzLCBmdW5jdGlvbiAoYXJyKSB7XG4gICAgICAgIHJldHVybiBhcnIuaWRzLm1hcChmdW5jdGlvbiAoeCkgeyByZXR1cm4geC5pZDsgfSlcbiAgICAgICAgICAuaW5kZXhPZihkb2MuX3Jldi5zcGxpdCgnLScpWzFdKSAhPT0gLTE7XG4gICAgICB9KTtcblxuICAgICAgdmFyIGluZGV4T2ZSZXYgPSBwYXRoLmlkcy5tYXAoZnVuY3Rpb24gKHgpIHtyZXR1cm4geC5pZDsgfSlcbiAgICAgICAgLmluZGV4T2YoZG9jLl9yZXYuc3BsaXQoJy0nKVsxXSkgKyAxO1xuICAgICAgdmFyIGhvd01hbnkgPSBwYXRoLmlkcy5sZW5ndGggLSBpbmRleE9mUmV2O1xuICAgICAgcGF0aC5pZHMuc3BsaWNlKGluZGV4T2ZSZXYsIGhvd01hbnkpO1xuICAgICAgcGF0aC5pZHMucmV2ZXJzZSgpO1xuXG4gICAgICBpZiAob3B0cy5yZXZzKSB7XG4gICAgICAgIGRvYy5fcmV2aXNpb25zID0ge1xuICAgICAgICAgIHN0YXJ0OiAocGF0aC5wb3MgKyBwYXRoLmlkcy5sZW5ndGgpIC0gMSxcbiAgICAgICAgICBpZHM6IHBhdGguaWRzLm1hcChmdW5jdGlvbiAocmV2KSB7XG4gICAgICAgICAgICByZXR1cm4gcmV2LmlkO1xuICAgICAgICAgIH0pXG4gICAgICAgIH07XG4gICAgICB9XG4gICAgICBpZiAob3B0cy5yZXZzX2luZm8pIHtcbiAgICAgICAgdmFyIHBvcyA9ICBwYXRoLnBvcyArIHBhdGguaWRzLmxlbmd0aDtcbiAgICAgICAgZG9jLl9yZXZzX2luZm8gPSBwYXRoLmlkcy5tYXAoZnVuY3Rpb24gKHJldikge1xuICAgICAgICAgIHBvcy0tO1xuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICByZXY6IHBvcyArICctJyArIHJldi5pZCxcbiAgICAgICAgICAgIHN0YXR1czogcmV2Lm9wdHMuc3RhdHVzXG4gICAgICAgICAgfTtcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKG9wdHMubG9jYWxfc2VxKSB7XG4gICAgICB1dGlscy5pbmZvKCdUaGUgXCJsb2NhbF9zZXFcIiBvcHRpb24gaXMgZGVwcmVjYXRlZCBhbmQgd2lsbCBiZSByZW1vdmVkJyk7XG4gICAgICBkb2MuX2xvY2FsX3NlcSA9IHJlc3VsdC5tZXRhZGF0YS5zZXE7XG4gICAgfVxuXG4gICAgaWYgKG9wdHMuYXR0YWNobWVudHMgJiYgZG9jLl9hdHRhY2htZW50cykge1xuICAgICAgdmFyIGF0dGFjaG1lbnRzID0gZG9jLl9hdHRhY2htZW50cztcbiAgICAgIHZhciBjb3VudCA9IE9iamVjdC5rZXlzKGF0dGFjaG1lbnRzKS5sZW5ndGg7XG4gICAgICBpZiAoY291bnQgPT09IDApIHtcbiAgICAgICAgcmV0dXJuIGNhbGxiYWNrKG51bGwsIGRvYyk7XG4gICAgICB9XG4gICAgICBPYmplY3Qua2V5cyhhdHRhY2htZW50cykuZm9yRWFjaChmdW5jdGlvbiAoa2V5KSB7XG4gICAgICAgIHRoaXMuX2dldEF0dGFjaG1lbnQoYXR0YWNobWVudHNba2V5XSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB7ZW5jb2RlOiB0cnVlLCBjdHg6IGN0eH0sIGZ1bmN0aW9uIChlcnIsIGRhdGEpIHtcbiAgICAgICAgICB2YXIgYXR0ID0gZG9jLl9hdHRhY2htZW50c1trZXldO1xuICAgICAgICAgIGF0dC5kYXRhID0gZGF0YTtcbiAgICAgICAgICBkZWxldGUgYXR0LnN0dWI7XG4gICAgICAgICAgZGVsZXRlIGF0dC5sZW5ndGg7XG4gICAgICAgICAgaWYgKCEtLWNvdW50KSB7XG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkb2MpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9LCBzZWxmKTtcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKGRvYy5fYXR0YWNobWVudHMpIHtcbiAgICAgICAgZm9yICh2YXIga2V5IGluIGRvYy5fYXR0YWNobWVudHMpIHtcbiAgICAgICAgICBpZiAoZG9jLl9hdHRhY2htZW50cy5oYXNPd25Qcm9wZXJ0eShrZXkpKSB7XG4gICAgICAgICAgICBkb2MuX2F0dGFjaG1lbnRzW2tleV0uc3R1YiA9IHRydWU7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICBjYWxsYmFjayhudWxsLCBkb2MpO1xuICAgIH1cbiAgfSk7XG59KTtcblxuQWJzdHJhY3RQb3VjaERCLnByb3RvdHlwZS5nZXRBdHRhY2htZW50ID1cbiAgdXRpbHMuYWRhcHRlckZ1bignZ2V0QXR0YWNobWVudCcsIGZ1bmN0aW9uIChkb2NJZCwgYXR0YWNobWVudElkLCBvcHRzLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNhbGxiYWNrKSB7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgaWYgKG9wdHMgaW5zdGFuY2VvZiBGdW5jdGlvbikge1xuICAgIGNhbGxiYWNrID0gb3B0cztcbiAgICBvcHRzID0ge307XG4gIH1cbiAgb3B0cyA9IHV0aWxzLmNsb25lKG9wdHMpO1xuICB0aGlzLl9nZXQoZG9jSWQsIG9wdHMsIGZ1bmN0aW9uIChlcnIsIHJlcykge1xuICAgIGlmIChlcnIpIHtcbiAgICAgIHJldHVybiBjYWxsYmFjayhlcnIpO1xuICAgIH1cbiAgICBpZiAocmVzLmRvYy5fYXR0YWNobWVudHMgJiYgcmVzLmRvYy5fYXR0YWNobWVudHNbYXR0YWNobWVudElkXSkge1xuICAgICAgb3B0cy5jdHggPSByZXMuY3R4O1xuICAgICAgc2VsZi5fZ2V0QXR0YWNobWVudChyZXMuZG9jLl9hdHRhY2htZW50c1thdHRhY2htZW50SWRdLCBvcHRzLCBjYWxsYmFjayk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiBjYWxsYmFjayhlcnJvcnMuZXJyb3IoZXJyb3JzLk1JU1NJTkdfRE9DKSk7XG4gICAgfVxuICB9KTtcbn0pO1xuXG5BYnN0cmFjdFBvdWNoREIucHJvdG90eXBlLmFsbERvY3MgPVxuICB1dGlscy5hZGFwdGVyRnVuKCdhbGxEb2NzJywgZnVuY3Rpb24gKG9wdHMsIGNhbGxiYWNrKSB7XG4gIGlmICh0eXBlb2Ygb3B0cyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIGNhbGxiYWNrID0gb3B0cztcbiAgICBvcHRzID0ge307XG4gIH1cbiAgb3B0cyA9IHV0aWxzLmNsb25lKG9wdHMpO1xuICBvcHRzLnNraXAgPSB0eXBlb2Ygb3B0cy5za2lwICE9PSAndW5kZWZpbmVkJyA/IG9wdHMuc2tpcCA6IDA7XG4gIGlmICgna2V5cycgaW4gb3B0cykge1xuICAgIGlmICghQXJyYXkuaXNBcnJheShvcHRzLmtleXMpKSB7XG4gICAgICByZXR1cm4gY2FsbGJhY2sobmV3IFR5cGVFcnJvcignb3B0aW9ucy5rZXlzIG11c3QgYmUgYW4gYXJyYXknKSk7XG4gICAgfVxuICAgIHZhciBpbmNvbXBhdGlibGVPcHQgPVxuICAgICAgWydzdGFydGtleScsICdlbmRrZXknLCAna2V5J10uZmlsdGVyKGZ1bmN0aW9uIChpbmNvbXBhdGlibGVPcHQpIHtcbiAgICAgIHJldHVybiBpbmNvbXBhdGlibGVPcHQgaW4gb3B0cztcbiAgICB9KVswXTtcbiAgICBpZiAoaW5jb21wYXRpYmxlT3B0KSB7XG4gICAgICBjYWxsYmFjayhlcnJvcnMuZXJyb3IoZXJyb3JzLlFVRVJZX1BBUlNFX0VSUk9SLFxuICAgICAgICAnUXVlcnkgcGFyYW1ldGVyIGAnICsgaW5jb21wYXRpYmxlT3B0ICtcbiAgICAgICAgJ2AgaXMgbm90IGNvbXBhdGlibGUgd2l0aCBtdWx0aS1nZXQnXG4gICAgICApKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKHRoaXMudHlwZSgpICE9PSAnaHR0cCcpIHtcbiAgICAgIHJldHVybiBhbGxEb2NzS2V5c1F1ZXJ5KHRoaXMsIG9wdHMsIGNhbGxiYWNrKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gdGhpcy5fYWxsRG9jcyhvcHRzLCBjYWxsYmFjayk7XG59KTtcblxuQWJzdHJhY3RQb3VjaERCLnByb3RvdHlwZS5jaGFuZ2VzID0gZnVuY3Rpb24gKG9wdHMsIGNhbGxiYWNrKSB7XG4gIGlmICh0eXBlb2Ygb3B0cyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIGNhbGxiYWNrID0gb3B0cztcbiAgICBvcHRzID0ge307XG4gIH1cbiAgcmV0dXJuIG5ldyBDaGFuZ2VzKHRoaXMsIG9wdHMsIGNhbGxiYWNrKTtcbn07XG5cbkFic3RyYWN0UG91Y2hEQi5wcm90b3R5cGUuY2xvc2UgPVxuICB1dGlscy5hZGFwdGVyRnVuKCdjbG9zZScsIGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICB0aGlzLl9jbG9zZWQgPSB0cnVlO1xuICByZXR1cm4gdGhpcy5fY2xvc2UoY2FsbGJhY2spO1xufSk7XG5cbkFic3RyYWN0UG91Y2hEQi5wcm90b3R5cGUuaW5mbyA9IHV0aWxzLmFkYXB0ZXJGdW4oJ2luZm8nLCBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICB0aGlzLl9pbmZvKGZ1bmN0aW9uIChlcnIsIGluZm8pIHtcbiAgICBpZiAoZXJyKSB7XG4gICAgICByZXR1cm4gY2FsbGJhY2soZXJyKTtcbiAgICB9XG4gICAgLy8gYXNzdW1lIHdlIGtub3cgYmV0dGVyIHRoYW4gdGhlIGFkYXB0ZXIsIHVubGVzcyBpdCBpbmZvcm1zIHVzXG4gICAgaW5mby5kYl9uYW1lID0gaW5mby5kYl9uYW1lIHx8IHNlbGYuX2RiX25hbWU7XG4gICAgaW5mby5hdXRvX2NvbXBhY3Rpb24gPSAhIShzZWxmLmF1dG9fY29tcGFjdGlvbiAmJiBzZWxmLnR5cGUoKSAhPT0gJ2h0dHAnKTtcbiAgICBjYWxsYmFjayhudWxsLCBpbmZvKTtcbiAgfSk7XG59KTtcblxuQWJzdHJhY3RQb3VjaERCLnByb3RvdHlwZS5pZCA9IHV0aWxzLmFkYXB0ZXJGdW4oJ2lkJywgZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gIHJldHVybiB0aGlzLl9pZChjYWxsYmFjayk7XG59KTtcblxuQWJzdHJhY3RQb3VjaERCLnByb3RvdHlwZS50eXBlID0gZnVuY3Rpb24gKCkge1xuICByZXR1cm4gKHR5cGVvZiB0aGlzLl90eXBlID09PSAnZnVuY3Rpb24nKSA/IHRoaXMuX3R5cGUoKSA6IHRoaXMuYWRhcHRlcjtcbn07XG5cbkFic3RyYWN0UG91Y2hEQi5wcm90b3R5cGUuYnVsa0RvY3MgPVxuICB1dGlscy5hZGFwdGVyRnVuKCdidWxrRG9jcycsIGZ1bmN0aW9uIChyZXEsIG9wdHMsIGNhbGxiYWNrKSB7XG4gIGlmICh0eXBlb2Ygb3B0cyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIGNhbGxiYWNrID0gb3B0cztcbiAgICBvcHRzID0ge307XG4gIH1cblxuICBvcHRzID0gdXRpbHMuY2xvbmUob3B0cyk7XG5cbiAgaWYgKEFycmF5LmlzQXJyYXkocmVxKSkge1xuICAgIHJlcSA9IHtcbiAgICAgIGRvY3M6IHJlcVxuICAgIH07XG4gIH1cblxuICBpZiAoIXJlcSB8fCAhcmVxLmRvY3MgfHwgIUFycmF5LmlzQXJyYXkocmVxLmRvY3MpKSB7XG4gICAgcmV0dXJuIGNhbGxiYWNrKGVycm9ycy5lcnJvcihlcnJvcnMuTUlTU0lOR19CVUxLX0RPQ1MpKTtcbiAgfVxuXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgcmVxLmRvY3MubGVuZ3RoOyArK2kpIHtcbiAgICBpZiAodHlwZW9mIHJlcS5kb2NzW2ldICE9PSAnb2JqZWN0JyB8fCBBcnJheS5pc0FycmF5KHJlcS5kb2NzW2ldKSkge1xuICAgICAgcmV0dXJuIGNhbGxiYWNrKGVycm9ycy5lcnJvcihlcnJvcnMuTk9UX0FOX09CSkVDVCkpO1xuICAgIH1cbiAgfVxuXG4gIHJlcSA9IHV0aWxzLmNsb25lKHJlcSk7XG4gIGlmICghKCduZXdfZWRpdHMnIGluIG9wdHMpKSB7XG4gICAgaWYgKCduZXdfZWRpdHMnIGluIHJlcSkge1xuICAgICAgb3B0cy5uZXdfZWRpdHMgPSByZXEubmV3X2VkaXRzO1xuICAgIH0gZWxzZSB7XG4gICAgICBvcHRzLm5ld19lZGl0cyA9IHRydWU7XG4gICAgfVxuICB9XG5cbiAgaWYgKCFvcHRzLm5ld19lZGl0cyAmJiB0aGlzLnR5cGUoKSAhPT0gJ2h0dHAnKSB7XG4gICAgLy8gZW5zdXJlIHJldmlzaW9ucyBvZiB0aGUgc2FtZSBkb2MgYXJlIHNvcnRlZCwgc28gdGhhdFxuICAgIC8vIHRoZSBsb2NhbCBhZGFwdGVyIHByb2Nlc3NlcyB0aGVtIGNvcnJlY3RseSAoIzI5MzUpXG4gICAgcmVxLmRvY3Muc29ydChmdW5jdGlvbiAoYSwgYikge1xuICAgICAgdmFyIGlkQ29tcGFyZSA9IHV0aWxzLmNvbXBhcmUoYS5faWQsIGIuX2lkKTtcbiAgICAgIGlmIChpZENvbXBhcmUgIT09IDApIHtcbiAgICAgICAgcmV0dXJuIGlkQ29tcGFyZTtcbiAgICAgIH1cbiAgICAgIHZhciBhU3RhcnQgPSBhLl9yZXZpc2lvbnMgPyBhLl9yZXZpc2lvbnMuc3RhcnQgOiAwO1xuICAgICAgdmFyIGJTdGFydCA9IGIuX3JldmlzaW9ucyA/IGIuX3JldmlzaW9ucy5zdGFydCA6IDA7XG4gICAgICByZXR1cm4gdXRpbHMuY29tcGFyZShhU3RhcnQsIGJTdGFydCk7XG4gICAgfSk7XG4gIH1cblxuICByZXEuZG9jcy5mb3JFYWNoKGZ1bmN0aW9uIChkb2MpIHtcbiAgICBpZiAoZG9jLl9kZWxldGVkKSB7XG4gICAgICBkZWxldGUgZG9jLl9hdHRhY2htZW50czsgLy8gaWdub3JlIGF0dHMgZm9yIGRlbGV0ZWQgZG9jc1xuICAgIH1cbiAgfSk7XG5cbiAgcmV0dXJuIHRoaXMuX2J1bGtEb2NzKHJlcSwgb3B0cywgZnVuY3Rpb24gKGVyciwgcmVzKSB7XG4gICAgaWYgKGVycikge1xuICAgICAgcmV0dXJuIGNhbGxiYWNrKGVycik7XG4gICAgfVxuICAgIGlmICghb3B0cy5uZXdfZWRpdHMpIHtcbiAgICAgIC8vIHRoaXMgaXMgd2hhdCBjb3VjaCBkb2VzIHdoZW4gbmV3X2VkaXRzIGlzIGZhbHNlXG4gICAgICByZXMgPSByZXMuZmlsdGVyKGZ1bmN0aW9uICh4KSB7XG4gICAgICAgIHJldHVybiB4LmVycm9yO1xuICAgICAgfSk7XG4gICAgfVxuICAgIGNhbGxiYWNrKG51bGwsIHJlcyk7XG4gIH0pO1xufSk7XG5cbkFic3RyYWN0UG91Y2hEQi5wcm90b3R5cGUucmVnaXN0ZXJEZXBlbmRlbnREYXRhYmFzZSA9XG4gIHV0aWxzLmFkYXB0ZXJGdW4oJ3JlZ2lzdGVyRGVwZW5kZW50RGF0YWJhc2UnLCBmdW5jdGlvbiAoZGVwZW5kZW50RGIsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2FsbGJhY2spIHtcbiAgdmFyIGRlcERCID0gbmV3IHRoaXMuY29uc3RydWN0b3IoZGVwZW5kZW50RGIsIHRoaXMuX19vcHRzIHx8IHt9KTtcblxuICBmdW5jdGlvbiBkaWZmRnVuKGRvYykge1xuICAgIGRvYy5kZXBlbmRlbnREYnMgPSBkb2MuZGVwZW5kZW50RGJzIHx8IHt9O1xuICAgIGlmIChkb2MuZGVwZW5kZW50RGJzW2RlcGVuZGVudERiXSkge1xuICAgICAgcmV0dXJuIGZhbHNlOyAvLyBubyB1cGRhdGUgcmVxdWlyZWRcbiAgICB9XG4gICAgZG9jLmRlcGVuZGVudERic1tkZXBlbmRlbnREYl0gPSB0cnVlO1xuICAgIHJldHVybiBkb2M7XG4gIH1cbiAgdXBzZXJ0KHRoaXMsICdfbG9jYWwvX3BvdWNoX2RlcGVuZGVudERicycsIGRpZmZGdW4sIGZ1bmN0aW9uIChlcnIpIHtcbiAgICBpZiAoZXJyKSB7XG4gICAgICByZXR1cm4gY2FsbGJhY2soZXJyKTtcbiAgICB9XG4gICAgcmV0dXJuIGNhbGxiYWNrKG51bGwsIHtkYjogZGVwREJ9KTtcbiAgfSk7XG59KTtcbiIsIlwidXNlIHN0cmljdFwiO1xuXG52YXIgQ0hBTkdFU19CQVRDSF9TSVpFID0gMjU7XG5cbi8vIGFjY29yZGluZyB0byBodHRwOi8vc3RhY2tvdmVyZmxvdy5jb20vYS80MTcxODQvNjgwNzQyLFxuLy8gdGhlIGRlIGZhY3RvciBVUkwgbGVuZ3RoIGxpbWl0IGlzIDIwMDAgY2hhcmFjdGVycy5cbi8vIGJ1dCBzaW5jZSBtb3N0IG9mIG91ciBtZWFzdXJlbWVudHMgZG9uJ3QgdGFrZSB0aGUgZnVsbFxuLy8gVVJMIGludG8gYWNjb3VudCwgd2UgZnVkZ2UgaXQgYSBiaXQuXG4vLyBUT0RPOiB3ZSBjb3VsZCBtZWFzdXJlIHRoZSBmdWxsIFVSTCB0byBlbmZvcmNlIGV4YWN0bHkgMjAwMCBjaGFyc1xudmFyIE1BWF9VUkxfTEVOR1RIID0gMTgwMDtcblxudmFyIHV0aWxzID0gcmVxdWlyZSgnLi4vLi4vdXRpbHMnKTtcbnZhciBlcnJvcnMgPSByZXF1aXJlKCcuLi8uLi9kZXBzL2Vycm9ycycpO1xudmFyIGxvZyA9IHJlcXVpcmUoJ2RlYnVnJykoJ3BvdWNoZGI6aHR0cCcpO1xudmFyIGlzQnJvd3NlciA9IHR5cGVvZiBwcm9jZXNzID09PSAndW5kZWZpbmVkJyB8fCBwcm9jZXNzLmJyb3dzZXI7XG52YXIgYnVmZmVyID0gcmVxdWlyZSgnLi4vLi4vZGVwcy9idWZmZXInKTtcblxuZnVuY3Rpb24gZW5jb2RlRG9jSWQoaWQpIHtcbiAgaWYgKC9eX2Rlc2lnbi8udGVzdChpZCkpIHtcbiAgICByZXR1cm4gJ19kZXNpZ24vJyArIGVuY29kZVVSSUNvbXBvbmVudChpZC5zbGljZSg4KSk7XG4gIH1cbiAgaWYgKC9eX2xvY2FsLy50ZXN0KGlkKSkge1xuICAgIHJldHVybiAnX2xvY2FsLycgKyBlbmNvZGVVUklDb21wb25lbnQoaWQuc2xpY2UoNykpO1xuICB9XG4gIHJldHVybiBlbmNvZGVVUklDb21wb25lbnQoaWQpO1xufVxuXG5mdW5jdGlvbiBwcmVwcm9jZXNzQXR0YWNobWVudHMoZG9jKSB7XG4gIGlmICghZG9jLl9hdHRhY2htZW50cyB8fCAhT2JqZWN0LmtleXMoZG9jLl9hdHRhY2htZW50cykpIHtcbiAgICByZXR1cm4gdXRpbHMuUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH1cblxuICByZXR1cm4gdXRpbHMuUHJvbWlzZS5hbGwoT2JqZWN0LmtleXMoZG9jLl9hdHRhY2htZW50cykubWFwKGZ1bmN0aW9uIChrZXkpIHtcbiAgICB2YXIgYXR0YWNobWVudCA9IGRvYy5fYXR0YWNobWVudHNba2V5XTtcbiAgICBpZiAoYXR0YWNobWVudC5kYXRhICYmIHR5cGVvZiBhdHRhY2htZW50LmRhdGEgIT09ICdzdHJpbmcnKSB7XG4gICAgICBpZiAoaXNCcm93c2VyKSB7XG4gICAgICAgIHJldHVybiBuZXcgdXRpbHMuUHJvbWlzZShmdW5jdGlvbiAocmVzb2x2ZSkge1xuICAgICAgICAgIHV0aWxzLnJlYWRBc0JpbmFyeVN0cmluZyhhdHRhY2htZW50LmRhdGEsIGZ1bmN0aW9uIChiaW5hcnkpIHtcbiAgICAgICAgICAgIGF0dGFjaG1lbnQuZGF0YSA9IHV0aWxzLmJ0b2EoYmluYXJ5KTtcbiAgICAgICAgICAgIHJlc29sdmUoKTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBhdHRhY2htZW50LmRhdGEgPSBhdHRhY2htZW50LmRhdGEudG9TdHJpbmcoJ2Jhc2U2NCcpO1xuICAgICAgfVxuICAgIH1cbiAgfSkpO1xufVxuXG4vLyBHZXQgYWxsIHRoZSBpbmZvcm1hdGlvbiB5b3UgcG9zc2libHkgY2FuIGFib3V0IHRoZSBVUkkgZ2l2ZW4gYnkgbmFtZSBhbmRcbi8vIHJldHVybiBpdCBhcyBhIHN1aXRhYmxlIG9iamVjdC5cbmZ1bmN0aW9uIGdldEhvc3QobmFtZSwgb3B0cykge1xuICAvLyBJZiB0aGUgZ2l2ZW4gbmFtZSBjb250YWlucyBcImh0dHA6XCJcbiAgaWYgKC9odHRwKHM/KTovLnRlc3QobmFtZSkpIHtcbiAgICAvLyBQcmFzZSB0aGUgVVJJIGludG8gYWxsIGl0cyBsaXR0bGUgYml0c1xuICAgIHZhciB1cmkgPSB1dGlscy5wYXJzZVVyaShuYW1lKTtcblxuICAgIC8vIFN0b3JlIHRoZSBmYWN0IHRoYXQgaXQgaXMgYSByZW1vdGUgVVJJXG4gICAgdXJpLnJlbW90ZSA9IHRydWU7XG5cbiAgICAvLyBTdG9yZSB0aGUgdXNlciBhbmQgcGFzc3dvcmQgYXMgYSBzZXBhcmF0ZSBhdXRoIG9iamVjdFxuICAgIGlmICh1cmkudXNlciB8fCB1cmkucGFzc3dvcmQpIHtcbiAgICAgIHVyaS5hdXRoID0ge3VzZXJuYW1lOiB1cmkudXNlciwgcGFzc3dvcmQ6IHVyaS5wYXNzd29yZH07XG4gICAgfVxuXG4gICAgLy8gU3BsaXQgdGhlIHBhdGggcGFydCBvZiB0aGUgVVJJIGludG8gcGFydHMgdXNpbmcgJy8nIGFzIHRoZSBkZWxpbWl0ZXJcbiAgICAvLyBhZnRlciByZW1vdmluZyBhbnkgbGVhZGluZyAnLycgYW5kIGFueSB0cmFpbGluZyAnLydcbiAgICB2YXIgcGFydHMgPSB1cmkucGF0aC5yZXBsYWNlKC8oXlxcL3xcXC8kKS9nLCAnJykuc3BsaXQoJy8nKTtcblxuICAgIC8vIFN0b3JlIHRoZSBmaXJzdCBwYXJ0IGFzIHRoZSBkYXRhYmFzZSBuYW1lIGFuZCByZW1vdmUgaXQgZnJvbSB0aGUgcGFydHNcbiAgICAvLyBhcnJheVxuICAgIHVyaS5kYiA9IHBhcnRzLnBvcCgpO1xuXG4gICAgLy8gUmVzdG9yZSB0aGUgcGF0aCBieSBqb2luaW5nIGFsbCB0aGUgcmVtYWluaW5nIHBhcnRzIChhbGwgdGhlIHBhcnRzXG4gICAgLy8gZXhjZXB0IGZvciB0aGUgZGF0YWJhc2UgbmFtZSkgd2l0aCAnLydzXG4gICAgdXJpLnBhdGggPSBwYXJ0cy5qb2luKCcvJyk7XG4gICAgb3B0cyA9IG9wdHMgfHwge307XG4gICAgb3B0cyA9IHV0aWxzLmNsb25lKG9wdHMpO1xuICAgIHVyaS5oZWFkZXJzID0gb3B0cy5oZWFkZXJzIHx8IChvcHRzLmFqYXggJiYgb3B0cy5hamF4LmhlYWRlcnMpIHx8IHt9O1xuXG4gICAgaWYgKG9wdHMuYXV0aCB8fCB1cmkuYXV0aCkge1xuICAgICAgdmFyIG5BdXRoID0gb3B0cy5hdXRoIHx8IHVyaS5hdXRoO1xuICAgICAgdmFyIHRva2VuID0gdXRpbHMuYnRvYShuQXV0aC51c2VybmFtZSArICc6JyArIG5BdXRoLnBhc3N3b3JkKTtcbiAgICAgIHVyaS5oZWFkZXJzLkF1dGhvcml6YXRpb24gPSAnQmFzaWMgJyArIHRva2VuO1xuICAgIH1cblxuICAgIGlmIChvcHRzLmhlYWRlcnMpIHtcbiAgICAgIHVyaS5oZWFkZXJzID0gb3B0cy5oZWFkZXJzO1xuICAgIH1cblxuICAgIHJldHVybiB1cmk7XG4gIH1cblxuICAvLyBJZiB0aGUgZ2l2ZW4gbmFtZSBkb2VzIG5vdCBjb250YWluICdodHRwOicgdGhlbiByZXR1cm4gYSB2ZXJ5IGJhc2ljIG9iamVjdFxuICAvLyB3aXRoIG5vIGhvc3QsIHRoZSBjdXJyZW50IHBhdGgsIHRoZSBnaXZlbiBuYW1lIGFzIHRoZSBkYXRhYmFzZSBuYW1lIGFuZCBub1xuICAvLyB1c2VybmFtZS9wYXNzd29yZFxuICByZXR1cm4ge2hvc3Q6ICcnLCBwYXRoOiAnLycsIGRiOiBuYW1lLCBhdXRoOiBmYWxzZX07XG59XG5cbi8vIEdlbmVyYXRlIGEgVVJMIHdpdGggdGhlIGhvc3QgZGF0YSBnaXZlbiBieSBvcHRzIGFuZCB0aGUgZ2l2ZW4gcGF0aFxuZnVuY3Rpb24gZ2VuREJVcmwob3B0cywgcGF0aCkge1xuICByZXR1cm4gZ2VuVXJsKG9wdHMsIG9wdHMuZGIgKyAnLycgKyBwYXRoKTtcbn1cblxuLy8gR2VuZXJhdGUgYSBVUkwgd2l0aCB0aGUgaG9zdCBkYXRhIGdpdmVuIGJ5IG9wdHMgYW5kIHRoZSBnaXZlbiBwYXRoXG5mdW5jdGlvbiBnZW5Vcmwob3B0cywgcGF0aCkge1xuICBpZiAob3B0cy5yZW1vdGUpIHtcbiAgICAvLyBJZiB0aGUgaG9zdCBhbHJlYWR5IGhhcyBhIHBhdGgsIHRoZW4gd2UgbmVlZCB0byBoYXZlIGEgcGF0aCBkZWxpbWl0ZXJcbiAgICAvLyBPdGhlcndpc2UsIHRoZSBwYXRoIGRlbGltaXRlciBpcyB0aGUgZW1wdHkgc3RyaW5nXG4gICAgdmFyIHBhdGhEZWwgPSAhb3B0cy5wYXRoID8gJycgOiAnLyc7XG5cbiAgICAvLyBJZiB0aGUgaG9zdCBhbHJlYWR5IGhhcyBhIHBhdGgsIHRoZW4gd2UgbmVlZCB0byBoYXZlIGEgcGF0aCBkZWxpbWl0ZXJcbiAgICAvLyBPdGhlcndpc2UsIHRoZSBwYXRoIGRlbGltaXRlciBpcyB0aGUgZW1wdHkgc3RyaW5nXG4gICAgcmV0dXJuIG9wdHMucHJvdG9jb2wgKyAnOi8vJyArIG9wdHMuaG9zdCArICc6JyArIG9wdHMucG9ydCArICcvJyArXG4gICAgICAgICAgIG9wdHMucGF0aCArIHBhdGhEZWwgKyBwYXRoO1xuICB9XG5cbiAgcmV0dXJuICcvJyArIHBhdGg7XG59XG5cbi8vIEltcGxlbWVudHMgdGhlIFBvdWNoREIgQVBJIGZvciBkZWFsaW5nIHdpdGggQ291Y2hEQiBpbnN0YW5jZXMgb3ZlciBIVFRQXG5mdW5jdGlvbiBIdHRwUG91Y2gob3B0cywgY2FsbGJhY2spIHtcbiAgLy8gVGhlIGZ1bmN0aW9ucyB0aGF0IHdpbGwgYmUgcHVibGljbHkgYXZhaWxhYmxlIGZvciBIdHRwUG91Y2hcbiAgdmFyIGFwaSA9IHRoaXM7XG4gIGFwaS5nZXRIb3N0ID0gb3B0cy5nZXRIb3N0ID8gb3B0cy5nZXRIb3N0IDogZ2V0SG9zdDtcblxuICAvLyBQYXJzZSB0aGUgVVJJIGdpdmVuIGJ5IG9wdHMubmFtZSBpbnRvIGFuIGVhc3ktdG8tdXNlIG9iamVjdFxuICB2YXIgaG9zdCA9IGFwaS5nZXRIb3N0KG9wdHMubmFtZSwgb3B0cyk7XG5cbiAgLy8gR2VuZXJhdGUgdGhlIGRhdGFiYXNlIFVSTCBiYXNlZCBvbiB0aGUgaG9zdFxuICB2YXIgZGJVcmwgPSBnZW5EQlVybChob3N0LCAnJyk7XG5cbiAgYXBpLmdldFVybCA9IGZ1bmN0aW9uICgpIHtyZXR1cm4gZGJVcmw7IH07XG4gIGFwaS5nZXRIZWFkZXJzID0gZnVuY3Rpb24gKCkge3JldHVybiB1dGlscy5jbG9uZShob3N0LmhlYWRlcnMpOyB9O1xuXG4gIHZhciBhamF4T3B0cyA9IG9wdHMuYWpheCB8fCB7fTtcbiAgb3B0cyA9IHV0aWxzLmNsb25lKG9wdHMpO1xuICBmdW5jdGlvbiBhamF4KG9wdGlvbnMsIGNhbGxiYWNrKSB7XG4gICAgdmFyIHJlcU9wdHMgPSB1dGlscy5leHRlbmQodHJ1ZSwgdXRpbHMuY2xvbmUoYWpheE9wdHMpLCBvcHRpb25zKTtcbiAgICBsb2cocmVxT3B0cy5tZXRob2QgKyAnICcgKyByZXFPcHRzLnVybCk7XG4gICAgcmV0dXJuIHV0aWxzLmFqYXgocmVxT3B0cywgY2FsbGJhY2spO1xuICB9XG5cbiAgLy8gQ3JlYXRlIGEgbmV3IENvdWNoREIgZGF0YWJhc2UgYmFzZWQgb24gdGhlIGdpdmVuIG9wdHNcbiAgdmFyIGNyZWF0ZURCID0gZnVuY3Rpb24gKCkge1xuICAgIGFqYXgoe2hlYWRlcnM6IGhvc3QuaGVhZGVycywgbWV0aG9kOiAnUFVUJywgdXJsOiBkYlVybH0sIGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgIC8vIElmIHdlIGdldCBhbiBcIlVuYXV0aG9yaXplZFwiIGVycm9yXG4gICAgICBpZiAoZXJyICYmIGVyci5zdGF0dXMgPT09IDQwMSkge1xuICAgICAgICAvLyBUZXN0IGlmIHRoZSBkYXRhYmFzZSBhbHJlYWR5IGV4aXN0c1xuICAgICAgICBhamF4KHtoZWFkZXJzOiBob3N0LmhlYWRlcnMsIG1ldGhvZDogJ0hFQUQnLCB1cmw6IGRiVXJsfSxcbiAgICAgICAgICAgICBmdW5jdGlvbiAoZXJyKSB7XG4gICAgICAgICAgLy8gSWYgdGhlcmUgaXMgc3RpbGwgYW4gZXJyb3JcbiAgICAgICAgICBpZiAoZXJyKSB7XG4gICAgICAgICAgICAvLyBHaXZlIHRoZSBlcnJvciB0byB0aGUgY2FsbGJhY2sgdG8gZGVhbCB3aXRoXG4gICAgICAgICAgICBjYWxsYmFjayhlcnIpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvLyBDb250aW51ZSBhcyBpZiB0aGVyZSBoYWQgYmVlbiBubyBlcnJvcnNcbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGFwaSk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgLy8gSWYgdGhlcmUgd2VyZSBubyBlcnJyb3Mgb3IgaWYgdGhlIG9ubHkgZXJyb3IgaXMgXCJQcmVjb25kaXRpb24gRmFpbGVkXCJcbiAgICAgICAgLy8gKG5vdGU6IFwiUHJlY29uZGl0aW9uIEZhaWxlZFwiIG9jY3VycyB3aGVuIHdlIHRyeSB0byBjcmVhdGUgYSBkYXRhYmFzZVxuICAgICAgICAvLyB0aGF0IGFscmVhZHkgZXhpc3RzKVxuICAgICAgfSBlbHNlIGlmICghZXJyIHx8IGVyci5zdGF0dXMgPT09IDQxMikge1xuICAgICAgICAvLyBDb250aW51ZSBhcyBpZiB0aGVyZSBoYWQgYmVlbiBubyBlcnJvcnNcbiAgICAgICAgY2FsbGJhY2sobnVsbCwgYXBpKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNhbGxiYWNrKGVycik7XG4gICAgICB9XG4gICAgfSk7XG4gIH07XG5cbiAgaWYgKCFvcHRzLnNraXBTZXR1cCkge1xuICAgIGFqYXgoe2hlYWRlcnM6IGhvc3QuaGVhZGVycywgbWV0aG9kOiAnR0VUJywgdXJsOiBkYlVybH0sIGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgIC8vY2hlY2sgaWYgdGhlIGRiIGV4aXN0c1xuICAgICAgaWYgKGVycikge1xuICAgICAgICBpZiAoZXJyLnN0YXR1cyA9PT0gNDA0KSB7XG4gICAgICAgICAgdXRpbHMuZXhwbGFpbjQwNChcbiAgICAgICAgICAgICdQb3VjaERCIGlzIGp1c3QgZGV0ZWN0aW5nIGlmIHRoZSByZW1vdGUgREIgZXhpc3RzLicpO1xuICAgICAgICAgIC8vaWYgaXQgZG9lc24ndCwgY3JlYXRlIGl0XG4gICAgICAgICAgY3JlYXRlREIoKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjYWxsYmFjayhlcnIpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvL2dvIGRvIHN0dWZmIHdpdGggdGhlIGRiXG4gICAgICAgIGNhbGxiYWNrKG51bGwsIGFwaSk7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBhcGkudHlwZSA9IGZ1bmN0aW9uICgpIHtcbiAgICByZXR1cm4gJ2h0dHAnO1xuICB9O1xuXG4gIGFwaS5pZCA9IHV0aWxzLmFkYXB0ZXJGdW4oJ2lkJywgZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgYWpheCh7XG4gICAgICBoZWFkZXJzOiBob3N0LmhlYWRlcnMsXG4gICAgICBtZXRob2Q6ICdHRVQnLFxuICAgICAgdXJsOiBnZW5VcmwoaG9zdCwgJycpXG4gICAgfSwgZnVuY3Rpb24gKGVyciwgcmVzdWx0KSB7XG4gICAgICB2YXIgdXVpZCA9IChyZXN1bHQgJiYgcmVzdWx0LnV1aWQpID9cbiAgICAgICAgcmVzdWx0LnV1aWQgKyBob3N0LmRiIDogZ2VuREJVcmwoaG9zdCwgJycpO1xuICAgICAgY2FsbGJhY2sobnVsbCwgdXVpZCk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGFwaS5yZXF1ZXN0ID0gdXRpbHMuYWRhcHRlckZ1bigncmVxdWVzdCcsIGZ1bmN0aW9uIChvcHRpb25zLCBjYWxsYmFjaykge1xuICAgIG9wdGlvbnMuaGVhZGVycyA9IGhvc3QuaGVhZGVycztcbiAgICBvcHRpb25zLnVybCA9IGdlbkRCVXJsKGhvc3QsIG9wdGlvbnMudXJsKTtcbiAgICBhamF4KG9wdGlvbnMsIGNhbGxiYWNrKTtcbiAgfSk7XG5cbiAgLy8gU2VuZHMgYSBQT1NUIHJlcXVlc3QgdG8gdGhlIGhvc3QgY2FsbGluZyB0aGUgY291Y2hkYiBfY29tcGFjdCBmdW5jdGlvblxuICAvLyAgICB2ZXJzaW9uOiBUaGUgdmVyc2lvbiBvZiBDb3VjaERCIGl0IGlzIHJ1bm5pbmdcbiAgYXBpLmNvbXBhY3QgPSB1dGlscy5hZGFwdGVyRnVuKCdjb21wYWN0JywgZnVuY3Rpb24gKG9wdHMsIGNhbGxiYWNrKSB7XG4gICAgaWYgKHR5cGVvZiBvcHRzID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICBjYWxsYmFjayA9IG9wdHM7XG4gICAgICBvcHRzID0ge307XG4gICAgfVxuICAgIG9wdHMgPSB1dGlscy5jbG9uZShvcHRzKTtcbiAgICBhamF4KHtcbiAgICAgIGhlYWRlcnM6IGhvc3QuaGVhZGVycyxcbiAgICAgIHVybDogZ2VuREJVcmwoaG9zdCwgJ19jb21wYWN0JyksXG4gICAgICBtZXRob2Q6ICdQT1NUJ1xuICAgIH0sIGZ1bmN0aW9uICgpIHtcbiAgICAgIGZ1bmN0aW9uIHBpbmcoKSB7XG4gICAgICAgIGFwaS5pbmZvKGZ1bmN0aW9uIChlcnIsIHJlcykge1xuICAgICAgICAgIGlmICghcmVzLmNvbXBhY3RfcnVubmluZykge1xuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwge29rOiB0cnVlfSk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHNldFRpbWVvdXQocGluZywgb3B0cy5pbnRlcnZhbCB8fCAyMDApO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgICAvLyBQaW5nIHRoZSBodHRwIGlmIGl0J3MgZmluaXNoZWQgY29tcGFjdGlvblxuICAgICAgaWYgKHR5cGVvZiBjYWxsYmFjayA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgIHBpbmcoKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfSk7XG5cbiAgLy8gQ2FsbHMgR0VUIG9uIHRoZSBob3N0LCB3aGljaCBnZXRzIGJhY2sgYSBKU09OIHN0cmluZyBjb250YWluaW5nXG4gIC8vICAgIGNvdWNoZGI6IEEgd2VsY29tZSBzdHJpbmdcbiAgLy8gICAgdmVyc2lvbjogVGhlIHZlcnNpb24gb2YgQ291Y2hEQiBpdCBpcyBydW5uaW5nXG4gIGFwaS5faW5mbyA9IGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgIGFqYXgoe1xuICAgICAgaGVhZGVyczogaG9zdC5oZWFkZXJzLFxuICAgICAgbWV0aG9kOiAnR0VUJyxcbiAgICAgIHVybDogZ2VuREJVcmwoaG9zdCwgJycpXG4gICAgfSwgZnVuY3Rpb24gKGVyciwgcmVzKSB7XG4gICAgICBpZiAoZXJyKSB7XG4gICAgICAgIGNhbGxiYWNrKGVycik7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXMuaG9zdCA9IGdlbkRCVXJsKGhvc3QsICcnKTtcbiAgICAgICAgY2FsbGJhY2sobnVsbCwgcmVzKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfTtcblxuICAvLyBHZXQgdGhlIGRvY3VtZW50IHdpdGggdGhlIGdpdmVuIGlkIGZyb20gdGhlIGRhdGFiYXNlIGdpdmVuIGJ5IGhvc3QuXG4gIC8vIFRoZSBpZCBjb3VsZCBiZSBzb2xlbHkgdGhlIF9pZCBpbiB0aGUgZGF0YWJhc2UsIG9yIGl0IG1heSBiZSBhXG4gIC8vIF9kZXNpZ24vSUQgb3IgX2xvY2FsL0lEIHBhdGhcbiAgYXBpLmdldCA9IHV0aWxzLmFkYXB0ZXJGdW4oJ2dldCcsIGZ1bmN0aW9uIChpZCwgb3B0cywgY2FsbGJhY2spIHtcbiAgICAvLyBJZiBubyBvcHRpb25zIHdlcmUgZ2l2ZW4sIHNldCB0aGUgY2FsbGJhY2sgdG8gdGhlIHNlY29uZCBwYXJhbWV0ZXJcbiAgICBpZiAodHlwZW9mIG9wdHMgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIGNhbGxiYWNrID0gb3B0cztcbiAgICAgIG9wdHMgPSB7fTtcbiAgICB9XG4gICAgb3B0cyA9IHV0aWxzLmNsb25lKG9wdHMpO1xuICAgIGlmIChvcHRzLmF1dG9fZW5jb2RlID09PSB1bmRlZmluZWQpIHtcbiAgICAgIG9wdHMuYXV0b19lbmNvZGUgPSB0cnVlO1xuICAgIH1cblxuICAgIC8vIExpc3Qgb2YgcGFyYW1ldGVycyB0byBhZGQgdG8gdGhlIEdFVCByZXF1ZXN0XG4gICAgdmFyIHBhcmFtcyA9IFtdO1xuXG4gICAgLy8gSWYgaXQgZXhpc3RzLCBhZGQgdGhlIG9wdHMucmV2cyB2YWx1ZSB0byB0aGUgbGlzdCBvZiBwYXJhbWV0ZXJzLlxuICAgIC8vIElmIHJldnM9dHJ1ZSB0aGVuIHRoZSByZXN1bHRpbmcgSlNPTiB3aWxsIGluY2x1ZGUgYSBmaWVsZFxuICAgIC8vIF9yZXZpc2lvbnMgY29udGFpbmluZyBhbiBhcnJheSBvZiB0aGUgcmV2aXNpb24gSURzLlxuICAgIGlmIChvcHRzLnJldnMpIHtcbiAgICAgIHBhcmFtcy5wdXNoKCdyZXZzPXRydWUnKTtcbiAgICB9XG5cbiAgICAvLyBJZiBpdCBleGlzdHMsIGFkZCB0aGUgb3B0cy5yZXZzX2luZm8gdmFsdWUgdG8gdGhlIGxpc3Qgb2YgcGFyYW1ldGVycy5cbiAgICAvLyBJZiByZXZzX2luZm89dHJ1ZSB0aGVuIHRoZSByZXN1bHRpbmcgSlNPTiB3aWxsIGluY2x1ZGUgdGhlIGZpZWxkXG4gICAgLy8gX3JldnNfaW5mbyBjb250YWluaW5nIGFuIGFycmF5IG9mIG9iamVjdHMgaW4gd2hpY2ggZWFjaCBvYmplY3RcbiAgICAvLyByZXByZXNlbnRpbmcgYW4gYXZhaWxhYmxlIHJldmlzaW9uLlxuICAgIGlmIChvcHRzLnJldnNfaW5mbykge1xuICAgICAgcGFyYW1zLnB1c2goJ3JldnNfaW5mbz10cnVlJyk7XG4gICAgfVxuXG4gICAgaWYgKG9wdHMubG9jYWxfc2VxKSB7XG4gICAgICBwYXJhbXMucHVzaCgnbG9jYWxfc2VxPXRydWUnKTtcbiAgICB9XG4gICAgLy8gSWYgaXQgZXhpc3RzLCBhZGQgdGhlIG9wdHMub3Blbl9yZXZzIHZhbHVlIHRvIHRoZSBsaXN0IG9mIHBhcmFtZXRlcnMuXG4gICAgLy8gSWYgb3Blbl9yZXZzPWFsbCB0aGVuIHRoZSByZXN1bHRpbmcgSlNPTiB3aWxsIGluY2x1ZGUgYWxsIHRoZSBsZWFmXG4gICAgLy8gcmV2aXNpb25zLiBJZiBvcGVuX3JldnM9W1wicmV2MVwiLCBcInJldjJcIiwuLi5dIHRoZW4gdGhlIHJlc3VsdGluZyBKU09OXG4gICAgLy8gd2lsbCBjb250YWluIGFuIGFycmF5IG9mIG9iamVjdHMgY29udGFpbmluZyBkYXRhIG9mIGFsbCByZXZpc2lvbnNcbiAgICBpZiAob3B0cy5vcGVuX3JldnMpIHtcbiAgICAgIGlmIChvcHRzLm9wZW5fcmV2cyAhPT0gXCJhbGxcIikge1xuICAgICAgICBvcHRzLm9wZW5fcmV2cyA9IEpTT04uc3RyaW5naWZ5KG9wdHMub3Blbl9yZXZzKTtcbiAgICAgIH1cbiAgICAgIHBhcmFtcy5wdXNoKCdvcGVuX3JldnM9JyArIG9wdHMub3Blbl9yZXZzKTtcbiAgICB9XG5cbiAgICAvLyBJZiBpdCBleGlzdHMsIGFkZCB0aGUgb3B0cy5hdHRhY2htZW50cyB2YWx1ZSB0byB0aGUgbGlzdCBvZiBwYXJhbWV0ZXJzLlxuICAgIC8vIElmIGF0dGFjaG1lbnRzPXRydWUgdGhlIHJlc3VsdGluZyBKU09OIHdpbGwgaW5jbHVkZSB0aGUgYmFzZTY0LWVuY29kZWRcbiAgICAvLyBjb250ZW50cyBpbiB0aGUgXCJkYXRhXCIgcHJvcGVydHkgb2YgZWFjaCBhdHRhY2htZW50LlxuICAgIGlmIChvcHRzLmF0dGFjaG1lbnRzKSB7XG4gICAgICBwYXJhbXMucHVzaCgnYXR0YWNobWVudHM9dHJ1ZScpO1xuICAgIH1cblxuICAgIC8vIElmIGl0IGV4aXN0cywgYWRkIHRoZSBvcHRzLnJldiB2YWx1ZSB0byB0aGUgbGlzdCBvZiBwYXJhbWV0ZXJzLlxuICAgIC8vIElmIHJldiBpcyBnaXZlbiBhIHJldmlzaW9uIG51bWJlciB0aGVuIGdldCB0aGUgc3BlY2lmaWVkIHJldmlzaW9uLlxuICAgIGlmIChvcHRzLnJldikge1xuICAgICAgcGFyYW1zLnB1c2goJ3Jldj0nICsgb3B0cy5yZXYpO1xuICAgIH1cblxuICAgIC8vIElmIGl0IGV4aXN0cywgYWRkIHRoZSBvcHRzLmNvbmZsaWN0cyB2YWx1ZSB0byB0aGUgbGlzdCBvZiBwYXJhbWV0ZXJzLlxuICAgIC8vIElmIGNvbmZsaWN0cz10cnVlIHRoZW4gdGhlIHJlc3VsdGluZyBKU09OIHdpbGwgaW5jbHVkZSB0aGUgZmllbGRcbiAgICAvLyBfY29uZmxpY3RzIGNvbnRhaW5pbmcgYWxsIHRoZSBjb25mbGljdGluZyByZXZpc2lvbnMuXG4gICAgaWYgKG9wdHMuY29uZmxpY3RzKSB7XG4gICAgICBwYXJhbXMucHVzaCgnY29uZmxpY3RzPScgKyBvcHRzLmNvbmZsaWN0cyk7XG4gICAgfVxuXG4gICAgLy8gRm9ybWF0IHRoZSBsaXN0IG9mIHBhcmFtZXRlcnMgaW50byBhIHZhbGlkIFVSSSBxdWVyeSBzdHJpbmdcbiAgICBwYXJhbXMgPSBwYXJhbXMuam9pbignJicpO1xuICAgIHBhcmFtcyA9IHBhcmFtcyA9PT0gJycgPyAnJyA6ICc/JyArIHBhcmFtcztcblxuICAgIGlmIChvcHRzLmF1dG9fZW5jb2RlKSB7XG4gICAgICBpZCA9IGVuY29kZURvY0lkKGlkKTtcbiAgICB9XG5cbiAgICAvLyBTZXQgdGhlIG9wdGlvbnMgZm9yIHRoZSBhamF4IGNhbGxcbiAgICB2YXIgb3B0aW9ucyA9IHtcbiAgICAgIGhlYWRlcnM6IGhvc3QuaGVhZGVycyxcbiAgICAgIG1ldGhvZDogJ0dFVCcsXG4gICAgICB1cmw6IGdlbkRCVXJsKGhvc3QsIGlkICsgcGFyYW1zKVxuICAgIH07XG4gICAgdmFyIGdldFJlcXVlc3RBamF4T3B0cyA9IG9wdHMuYWpheCB8fCB7fTtcbiAgICB1dGlscy5leHRlbmQodHJ1ZSwgb3B0aW9ucywgZ2V0UmVxdWVzdEFqYXhPcHRzKTtcblxuICAgIC8vIElmIHRoZSBnaXZlbiBpZCBjb250YWlucyBhdCBsZWFzdCBvbmUgJy8nIGFuZCB0aGUgcGFydCBiZWZvcmUgdGhlICcvJ1xuICAgIC8vIGlzIE5PVCBcIl9kZXNpZ25cIiBhbmQgaXMgTk9UIFwiX2xvY2FsXCJcbiAgICAvLyBPUlxuICAgIC8vIElmIHRoZSBnaXZlbiBpZCBjb250YWlucyBhdCBsZWFzdCB0d28gJy8nIGFuZCB0aGUgcGFydCBiZWZvcmUgdGhlIGZpcnN0XG4gICAgLy8gJy8nIGlzIFwiX2Rlc2lnblwiLlxuICAgIC8vIFRPRE8gVGhpcyBzZWNvbmQgY29uZGl0aW9uIHNlZW1zIHN0cmFuZ2Ugc2luY2UgaWYgcGFydHNbMF0gPT09ICdfZGVzaWduJ1xuICAgIC8vIHRoZW4gd2UgYWxyZWFkeSBrbm93IHRoYXQgcGFydHNbMF0gIT09ICdfbG9jYWwnLlxuICAgIHZhciBwYXJ0cyA9IGlkLnNwbGl0KCcvJyk7XG4gICAgaWYgKChwYXJ0cy5sZW5ndGggPiAxICYmIHBhcnRzWzBdICE9PSAnX2Rlc2lnbicgJiYgcGFydHNbMF0gIT09ICdfbG9jYWwnKSB8fFxuICAgICAgICAocGFydHMubGVuZ3RoID4gMiAmJiBwYXJ0c1swXSA9PT0gJ19kZXNpZ24nICYmIHBhcnRzWzBdICE9PSAnX2xvY2FsJykpIHtcbiAgICAgIC8vIEJpbmFyeSBpcyBleHBlY3RlZCBiYWNrIGZyb20gdGhlIHNlcnZlclxuICAgICAgb3B0aW9ucy5iaW5hcnkgPSB0cnVlO1xuICAgIH1cblxuICAgIC8vIEdldCB0aGUgZG9jdW1lbnRcbiAgICBhamF4KG9wdGlvbnMsIGZ1bmN0aW9uIChlcnIsIGRvYywgeGhyKSB7XG4gICAgICAvLyBJZiB0aGUgZG9jdW1lbnQgZG9lcyBub3QgZXhpc3QsIHNlbmQgYW4gZXJyb3IgdG8gdGhlIGNhbGxiYWNrXG4gICAgICBpZiAoZXJyKSB7XG4gICAgICAgIHJldHVybiBjYWxsYmFjayhlcnIpO1xuICAgICAgfVxuXG4gICAgICAvLyBTZW5kIHRoZSBkb2N1bWVudCB0byB0aGUgY2FsbGJhY2tcbiAgICAgIGNhbGxiYWNrKG51bGwsIGRvYywgeGhyKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgLy8gRGVsZXRlIHRoZSBkb2N1bWVudCBnaXZlbiBieSBkb2MgZnJvbSB0aGUgZGF0YWJhc2UgZ2l2ZW4gYnkgaG9zdC5cbiAgYXBpLnJlbW92ZSA9IHV0aWxzLmFkYXB0ZXJGdW4oJ3JlbW92ZScsXG4gICAgICBmdW5jdGlvbiAoZG9jT3JJZCwgb3B0c09yUmV2LCBvcHRzLCBjYWxsYmFjaykge1xuICAgIHZhciBkb2M7XG4gICAgaWYgKHR5cGVvZiBvcHRzT3JSZXYgPT09ICdzdHJpbmcnKSB7XG4gICAgICAvLyBpZCwgcmV2LCBvcHRzLCBjYWxsYmFjayBzdHlsZVxuICAgICAgZG9jID0ge1xuICAgICAgICBfaWQ6IGRvY09ySWQsXG4gICAgICAgIF9yZXY6IG9wdHNPclJldlxuICAgICAgfTtcbiAgICAgIGlmICh0eXBlb2Ygb3B0cyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICBjYWxsYmFjayA9IG9wdHM7XG4gICAgICAgIG9wdHMgPSB7fTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgLy8gZG9jLCBvcHRzLCBjYWxsYmFjayBzdHlsZVxuICAgICAgZG9jID0gZG9jT3JJZDtcbiAgICAgIGlmICh0eXBlb2Ygb3B0c09yUmV2ID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIGNhbGxiYWNrID0gb3B0c09yUmV2O1xuICAgICAgICBvcHRzID0ge307XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjYWxsYmFjayA9IG9wdHM7XG4gICAgICAgIG9wdHMgPSBvcHRzT3JSZXY7XG4gICAgICB9XG4gICAgfVxuXG4gICAgdmFyIHJldiA9IChkb2MuX3JldiB8fCBvcHRzLnJldik7XG5cbiAgICAvLyBEZWxldGUgdGhlIGRvY3VtZW50XG4gICAgYWpheCh7XG4gICAgICBoZWFkZXJzOiBob3N0LmhlYWRlcnMsXG4gICAgICBtZXRob2Q6ICdERUxFVEUnLFxuICAgICAgdXJsOiBnZW5EQlVybChob3N0LCBlbmNvZGVEb2NJZChkb2MuX2lkKSkgKyAnP3Jldj0nICsgcmV2XG4gICAgfSwgY2FsbGJhY2spO1xuICB9KTtcblxuICBmdW5jdGlvbiBlbmNvZGVBdHRhY2htZW50SWQoYXR0YWNobWVudElkKSB7XG4gICAgcmV0dXJuIGF0dGFjaG1lbnRJZC5zcGxpdChcIi9cIikubWFwKGVuY29kZVVSSUNvbXBvbmVudCkuam9pbihcIi9cIik7XG4gIH1cblxuICAvLyBHZXQgdGhlIGF0dGFjaG1lbnRcbiAgYXBpLmdldEF0dGFjaG1lbnQgPVxuICAgIHV0aWxzLmFkYXB0ZXJGdW4oJ2dldEF0dGFjaG1lbnQnLCBmdW5jdGlvbiAoZG9jSWQsIGF0dGFjaG1lbnRJZCwgb3B0cyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNhbGxiYWNrKSB7XG4gICAgaWYgKHR5cGVvZiBvcHRzID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICBjYWxsYmFjayA9IG9wdHM7XG4gICAgICBvcHRzID0ge307XG4gICAgfVxuICAgIG9wdHMgPSB1dGlscy5jbG9uZShvcHRzKTtcbiAgICBpZiAob3B0cy5hdXRvX2VuY29kZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBvcHRzLmF1dG9fZW5jb2RlID0gdHJ1ZTtcbiAgICB9XG4gICAgaWYgKG9wdHMuYXV0b19lbmNvZGUpIHtcbiAgICAgIGRvY0lkID0gZW5jb2RlRG9jSWQoZG9jSWQpO1xuICAgIH1cbiAgICBvcHRzLmF1dG9fZW5jb2RlID0gZmFsc2U7XG4gICAgYXBpLmdldChkb2NJZCArICcvJyArIGVuY29kZUF0dGFjaG1lbnRJZChhdHRhY2htZW50SWQpLCBvcHRzLCBjYWxsYmFjayk7XG4gIH0pO1xuXG4gIC8vIFJlbW92ZSB0aGUgYXR0YWNobWVudCBnaXZlbiBieSB0aGUgaWQgYW5kIHJldlxuICBhcGkucmVtb3ZlQXR0YWNobWVudCA9XG4gICAgdXRpbHMuYWRhcHRlckZ1bigncmVtb3ZlQXR0YWNobWVudCcsIGZ1bmN0aW9uIChkb2NJZCwgYXR0YWNobWVudElkLCByZXYsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjYWxsYmFjaykge1xuXG4gICAgdmFyIHVybCA9IGdlbkRCVXJsKGhvc3QsIGVuY29kZURvY0lkKGRvY0lkKSArICcvJyArXG4gICAgICBlbmNvZGVBdHRhY2htZW50SWQoYXR0YWNobWVudElkKSkgKyAnP3Jldj0nICsgcmV2O1xuXG4gICAgYWpheCh7XG4gICAgICBoZWFkZXJzOiBob3N0LmhlYWRlcnMsXG4gICAgICBtZXRob2Q6ICdERUxFVEUnLFxuICAgICAgdXJsOiB1cmxcbiAgICB9LCBjYWxsYmFjayk7XG4gIH0pO1xuXG4gIC8vIEFkZCB0aGUgYXR0YWNobWVudCBnaXZlbiBieSBibG9iIGFuZCBpdHMgY29udGVudFR5cGUgcHJvcGVydHlcbiAgLy8gdG8gdGhlIGRvY3VtZW50IHdpdGggdGhlIGdpdmVuIGlkLCB0aGUgcmV2aXNpb24gZ2l2ZW4gYnkgcmV2LCBhbmRcbiAgLy8gYWRkIGl0IHRvIHRoZSBkYXRhYmFzZSBnaXZlbiBieSBob3N0LlxuICBhcGkucHV0QXR0YWNobWVudCA9XG4gICAgdXRpbHMuYWRhcHRlckZ1bigncHV0QXR0YWNobWVudCcsIGZ1bmN0aW9uIChkb2NJZCwgYXR0YWNobWVudElkLCByZXYsIGJsb2IsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlLCBjYWxsYmFjaykge1xuICAgIGlmICh0eXBlb2YgdHlwZSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgY2FsbGJhY2sgPSB0eXBlO1xuICAgICAgdHlwZSA9IGJsb2I7XG4gICAgICBibG9iID0gcmV2O1xuICAgICAgcmV2ID0gbnVsbDtcbiAgICB9XG4gICAgaWYgKHR5cGVvZiB0eXBlID09PSAndW5kZWZpbmVkJykge1xuICAgICAgdHlwZSA9IGJsb2I7XG4gICAgICBibG9iID0gcmV2O1xuICAgICAgcmV2ID0gbnVsbDtcbiAgICB9XG4gICAgdmFyIGlkID0gZW5jb2RlRG9jSWQoZG9jSWQpICsgJy8nICsgZW5jb2RlQXR0YWNobWVudElkKGF0dGFjaG1lbnRJZCk7XG4gICAgdmFyIHVybCA9IGdlbkRCVXJsKGhvc3QsIGlkKTtcbiAgICBpZiAocmV2KSB7XG4gICAgICB1cmwgKz0gJz9yZXY9JyArIHJldjtcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGJsb2IgPT09ICdzdHJpbmcnKSB7XG4gICAgICB2YXIgYmluYXJ5O1xuICAgICAgdHJ5IHtcbiAgICAgICAgYmluYXJ5ID0gdXRpbHMuYXRvYihibG9iKTtcbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICAvLyBpdCdzIG5vdCBiYXNlNjQtZW5jb2RlZCwgc28gdGhyb3cgZXJyb3JcbiAgICAgICAgcmV0dXJuIGNhbGxiYWNrKGVycm9ycy5lcnJvcihlcnJvcnMuQkFEX0FSRyxcbiAgICAgICAgICAgICAgICAgICAgICAgICdBdHRhY2htZW50cyBuZWVkIHRvIGJlIGJhc2U2NCBlbmNvZGVkJykpO1xuICAgICAgfVxuICAgICAgaWYgKGlzQnJvd3Nlcikge1xuICAgICAgICBibG9iID0gdXRpbHMuY3JlYXRlQmxvYihbdXRpbHMuZml4QmluYXJ5KGJpbmFyeSldLCB7dHlwZTogdHlwZX0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYmxvYiA9IGJpbmFyeSA/IG5ldyBidWZmZXIoYmluYXJ5LCAnYmluYXJ5JykgOiAnJztcbiAgICAgIH1cbiAgICB9XG5cbiAgICB2YXIgb3B0cyA9IHtcbiAgICAgIGhlYWRlcnM6IHV0aWxzLmNsb25lKGhvc3QuaGVhZGVycyksXG4gICAgICBtZXRob2Q6ICdQVVQnLFxuICAgICAgdXJsOiB1cmwsXG4gICAgICBwcm9jZXNzRGF0YTogZmFsc2UsXG4gICAgICBib2R5OiBibG9iLFxuICAgICAgdGltZW91dDogNjAwMDBcbiAgICB9O1xuICAgIG9wdHMuaGVhZGVyc1snQ29udGVudC1UeXBlJ10gPSB0eXBlO1xuICAgIC8vIEFkZCB0aGUgYXR0YWNobWVudFxuICAgIGFqYXgob3B0cywgY2FsbGJhY2spO1xuICB9KTtcblxuICAvLyBBZGQgdGhlIGRvY3VtZW50IGdpdmVuIGJ5IGRvYyAoaW4gSlNPTiBzdHJpbmcgZm9ybWF0KSB0byB0aGUgZGF0YWJhc2VcbiAgLy8gZ2l2ZW4gYnkgaG9zdC4gVGhpcyBmYWlscyBpZiB0aGUgZG9jIGhhcyBubyBfaWQgZmllbGQuXG4gIGFwaS5wdXQgPSB1dGlscy5hZGFwdGVyRnVuKCdwdXQnLCB1dGlscy5nZXRBcmd1bWVudHMoZnVuY3Rpb24gKGFyZ3MpIHtcbiAgICB2YXIgdGVtcCwgdGVtcHR5cGUsIG9wdHM7XG4gICAgdmFyIGRvYyA9IGFyZ3Muc2hpZnQoKTtcbiAgICB2YXIgaWQgPSAnX2lkJyBpbiBkb2M7XG4gICAgdmFyIGNhbGxiYWNrID0gYXJncy5wb3AoKTtcbiAgICBpZiAodHlwZW9mIGRvYyAhPT0gJ29iamVjdCcgfHwgQXJyYXkuaXNBcnJheShkb2MpKSB7XG4gICAgICByZXR1cm4gY2FsbGJhY2soZXJyb3JzLmVycm9yKGVycm9ycy5OT1RfQU5fT0JKRUNUKSk7XG4gICAgfVxuXG4gICAgZG9jID0gdXRpbHMuY2xvbmUoZG9jKTtcblxuICAgIHByZXByb2Nlc3NBdHRhY2htZW50cyhkb2MpLnRoZW4oZnVuY3Rpb24gKCkge1xuICAgICAgd2hpbGUgKHRydWUpIHtcbiAgICAgICAgdGVtcCA9IGFyZ3Muc2hpZnQoKTtcbiAgICAgICAgdGVtcHR5cGUgPSB0eXBlb2YgdGVtcDtcbiAgICAgICAgaWYgKHRlbXB0eXBlID09PSBcInN0cmluZ1wiICYmICFpZCkge1xuICAgICAgICAgIGRvYy5faWQgPSB0ZW1wO1xuICAgICAgICAgIGlkID0gdHJ1ZTtcbiAgICAgICAgfSBlbHNlIGlmICh0ZW1wdHlwZSA9PT0gXCJzdHJpbmdcIiAmJiBpZCAmJiAhKCdfcmV2JyBpbiBkb2MpKSB7XG4gICAgICAgICAgZG9jLl9yZXYgPSB0ZW1wO1xuICAgICAgICB9IGVsc2UgaWYgKHRlbXB0eXBlID09PSBcIm9iamVjdFwiKSB7XG4gICAgICAgICAgb3B0cyA9IHV0aWxzLmNsb25lKHRlbXApO1xuICAgICAgICB9XG4gICAgICAgIGlmICghYXJncy5sZW5ndGgpIHtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgb3B0cyA9IG9wdHMgfHwge307XG4gICAgICB2YXIgZXJyb3IgPSB1dGlscy5pbnZhbGlkSWRFcnJvcihkb2MuX2lkKTtcbiAgICAgIGlmIChlcnJvcikge1xuICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgIH1cblxuICAgICAgLy8gTGlzdCBvZiBwYXJhbWV0ZXIgdG8gYWRkIHRvIHRoZSBQVVQgcmVxdWVzdFxuICAgICAgdmFyIHBhcmFtcyA9IFtdO1xuXG4gICAgICAvLyBJZiBpdCBleGlzdHMsIGFkZCB0aGUgb3B0cy5uZXdfZWRpdHMgdmFsdWUgdG8gdGhlIGxpc3Qgb2YgcGFyYW1ldGVycy5cbiAgICAgIC8vIElmIG5ld19lZGl0cyA9IGZhbHNlIHRoZW4gdGhlIGRhdGFiYXNlIHdpbGwgTk9UIGFzc2lnbiB0aGlzIGRvY3VtZW50IGFcbiAgICAgIC8vIG5ldyByZXZpc2lvbiBudW1iZXJcbiAgICAgIGlmIChvcHRzICYmIHR5cGVvZiBvcHRzLm5ld19lZGl0cyAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgICAgcGFyYW1zLnB1c2goJ25ld19lZGl0cz0nICsgb3B0cy5uZXdfZWRpdHMpO1xuICAgICAgfVxuXG4gICAgICAvLyBGb3JtYXQgdGhlIGxpc3Qgb2YgcGFyYW1ldGVycyBpbnRvIGEgdmFsaWQgVVJJIHF1ZXJ5IHN0cmluZ1xuICAgICAgcGFyYW1zID0gcGFyYW1zLmpvaW4oJyYnKTtcbiAgICAgIGlmIChwYXJhbXMgIT09ICcnKSB7XG4gICAgICAgIHBhcmFtcyA9ICc/JyArIHBhcmFtcztcbiAgICAgIH1cblxuICAgICAgLy8gQWRkIHRoZSBkb2N1bWVudFxuICAgICAgYWpheCh7XG4gICAgICAgIGhlYWRlcnM6IGhvc3QuaGVhZGVycyxcbiAgICAgICAgbWV0aG9kOiAnUFVUJyxcbiAgICAgICAgdXJsOiBnZW5EQlVybChob3N0LCBlbmNvZGVEb2NJZChkb2MuX2lkKSkgKyBwYXJhbXMsXG4gICAgICAgIGJvZHk6IGRvY1xuICAgICAgfSwgZnVuY3Rpb24gKGVyciwgcmVzKSB7XG4gICAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgICByZXR1cm4gY2FsbGJhY2soZXJyKTtcbiAgICAgICAgfVxuICAgICAgICByZXMub2sgPSB0cnVlO1xuICAgICAgICBjYWxsYmFjayhudWxsLCByZXMpO1xuICAgICAgfSk7XG4gICAgfSlbXCJjYXRjaFwiXShjYWxsYmFjayk7XG5cbiAgfSkpO1xuXG4gIC8vIEFkZCB0aGUgZG9jdW1lbnQgZ2l2ZW4gYnkgZG9jIChpbiBKU09OIHN0cmluZyBmb3JtYXQpIHRvIHRoZSBkYXRhYmFzZVxuICAvLyBnaXZlbiBieSBob3N0LiBUaGlzIGRvZXMgbm90IGFzc3VtZSB0aGF0IGRvYyBpcyBhIG5ldyBkb2N1bWVudCBcbiAgLy8gKGkuZS4gZG9lcyBub3QgaGF2ZSBhIF9pZCBvciBhIF9yZXYgZmllbGQuKVxuICBhcGkucG9zdCA9IHV0aWxzLmFkYXB0ZXJGdW4oJ3Bvc3QnLCBmdW5jdGlvbiAoZG9jLCBvcHRzLCBjYWxsYmFjaykge1xuICAgIC8vIElmIG5vIG9wdGlvbnMgd2VyZSBnaXZlbiwgc2V0IHRoZSBjYWxsYmFjayB0byBiZSB0aGUgc2Vjb25kIHBhcmFtZXRlclxuICAgIGlmICh0eXBlb2Ygb3B0cyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgY2FsbGJhY2sgPSBvcHRzO1xuICAgICAgb3B0cyA9IHt9O1xuICAgIH1cbiAgICBvcHRzID0gdXRpbHMuY2xvbmUob3B0cyk7XG4gICAgaWYgKHR5cGVvZiBkb2MgIT09ICdvYmplY3QnKSB7XG4gICAgICByZXR1cm4gY2FsbGJhY2soZXJyb3JzLmVycm9yKGVycm9ycy5OT1RfQU5fT0JKRUNUKSk7XG4gICAgfVxuICAgIGlmICghIChcIl9pZFwiIGluIGRvYykpIHtcbiAgICAgIGRvYy5faWQgPSB1dGlscy51dWlkKCk7XG4gICAgfVxuICAgIGFwaS5wdXQoZG9jLCBvcHRzLCBmdW5jdGlvbiAoZXJyLCByZXMpIHtcbiAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgcmV0dXJuIGNhbGxiYWNrKGVycik7XG4gICAgICB9XG4gICAgICByZXMub2sgPSB0cnVlO1xuICAgICAgY2FsbGJhY2sobnVsbCwgcmVzKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgLy8gVXBkYXRlL2NyZWF0ZSBtdWx0aXBsZSBkb2N1bWVudHMgZ2l2ZW4gYnkgcmVxIGluIHRoZSBkYXRhYmFzZVxuICAvLyBnaXZlbiBieSBob3N0LlxuICBhcGkuX2J1bGtEb2NzID0gZnVuY3Rpb24gKHJlcSwgb3B0cywgY2FsbGJhY2spIHtcbiAgICAvLyBJZiBvcHRzLm5ld19lZGl0cyBleGlzdHMgYWRkIGl0IHRvIHRoZSBkb2N1bWVudCBkYXRhIHRvIGJlXG4gICAgLy8gc2VuZCB0byB0aGUgZGF0YWJhc2UuXG4gICAgLy8gSWYgbmV3X2VkaXRzPWZhbHNlIHRoZW4gaXQgcHJldmVudHMgdGhlIGRhdGFiYXNlIGZyb20gY3JlYXRpbmdcbiAgICAvLyBuZXcgcmV2aXNpb24gbnVtYmVycyBmb3IgdGhlIGRvY3VtZW50cy4gSW5zdGVhZCBpdCBqdXN0IHVzZXNcbiAgICAvLyB0aGUgb2xkIG9uZXMuIFRoaXMgaXMgdXNlZCBpbiBkYXRhYmFzZSByZXBsaWNhdGlvbi5cbiAgICBpZiAodHlwZW9mIG9wdHMubmV3X2VkaXRzICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgcmVxLm5ld19lZGl0cyA9IG9wdHMubmV3X2VkaXRzO1xuICAgIH1cblxuICAgIHV0aWxzLlByb21pc2UuYWxsKHJlcS5kb2NzLm1hcChwcmVwcm9jZXNzQXR0YWNobWVudHMpKS50aGVuKGZ1bmN0aW9uICgpIHtcbiAgICAgIC8vIFVwZGF0ZS9jcmVhdGUgdGhlIGRvY3VtZW50c1xuICAgICAgYWpheCh7XG4gICAgICAgIGhlYWRlcnM6IGhvc3QuaGVhZGVycyxcbiAgICAgICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgICAgIHVybDogZ2VuREJVcmwoaG9zdCwgJ19idWxrX2RvY3MnKSxcbiAgICAgICAgYm9keTogcmVxXG4gICAgICB9LCBmdW5jdGlvbiAoZXJyLCByZXN1bHRzKSB7XG4gICAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgICByZXR1cm4gY2FsbGJhY2soZXJyKTtcbiAgICAgICAgfVxuICAgICAgICByZXN1bHRzLmZvckVhY2goZnVuY3Rpb24gKHJlc3VsdCkge1xuICAgICAgICAgIHJlc3VsdC5vayA9IHRydWU7IC8vIHNtb290aHMgb3V0IGNsb3VkYW50IG5vdCBhZGRpbmcgdGhpc1xuICAgICAgICB9KTtcbiAgICAgICAgY2FsbGJhY2sobnVsbCwgcmVzdWx0cyk7XG4gICAgICB9KTtcbiAgICB9KVtcImNhdGNoXCJdKGNhbGxiYWNrKTtcbiAgfTtcblxuICAvLyBHZXQgYSBsaXN0aW5nIG9mIHRoZSBkb2N1bWVudHMgaW4gdGhlIGRhdGFiYXNlIGdpdmVuXG4gIC8vIGJ5IGhvc3QgYW5kIG9yZGVyZWQgYnkgaW5jcmVhc2luZyBpZC5cbiAgYXBpLmFsbERvY3MgPSB1dGlscy5hZGFwdGVyRnVuKCdhbGxEb2NzJywgZnVuY3Rpb24gKG9wdHMsIGNhbGxiYWNrKSB7XG4gICAgaWYgKHR5cGVvZiBvcHRzID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICBjYWxsYmFjayA9IG9wdHM7XG4gICAgICBvcHRzID0ge307XG4gICAgfVxuICAgIG9wdHMgPSB1dGlscy5jbG9uZShvcHRzKTtcbiAgICAvLyBMaXN0IG9mIHBhcmFtZXRlcnMgdG8gYWRkIHRvIHRoZSBHRVQgcmVxdWVzdFxuICAgIHZhciBwYXJhbXMgPSBbXTtcbiAgICB2YXIgYm9keTtcbiAgICB2YXIgbWV0aG9kID0gJ0dFVCc7XG5cbiAgICBpZiAob3B0cy5jb25mbGljdHMpIHtcbiAgICAgIHBhcmFtcy5wdXNoKCdjb25mbGljdHM9dHJ1ZScpO1xuICAgIH1cblxuICAgIC8vIElmIG9wdHMuZGVzY2VuZGluZyBpcyB0cnV0aHkgYWRkIGl0IHRvIHBhcmFtc1xuICAgIGlmIChvcHRzLmRlc2NlbmRpbmcpIHtcbiAgICAgIHBhcmFtcy5wdXNoKCdkZXNjZW5kaW5nPXRydWUnKTtcbiAgICB9XG5cbiAgICAvLyBJZiBvcHRzLmluY2x1ZGVfZG9jcyBleGlzdHMsIGFkZCB0aGUgaW5jbHVkZV9kb2NzIHZhbHVlIHRvIHRoZVxuICAgIC8vIGxpc3Qgb2YgcGFyYW1ldGVycy5cbiAgICAvLyBJZiBpbmNsdWRlX2RvY3M9dHJ1ZSB0aGVuIGluY2x1ZGUgdGhlIGFzc29jaWF0ZWQgZG9jdW1lbnQgd2l0aCBlYWNoXG4gICAgLy8gcmVzdWx0LlxuICAgIGlmIChvcHRzLmluY2x1ZGVfZG9jcykge1xuICAgICAgcGFyYW1zLnB1c2goJ2luY2x1ZGVfZG9jcz10cnVlJyk7XG4gICAgfVxuXG4gICAgaWYgKG9wdHMuYXR0YWNobWVudHMpIHtcbiAgICAgIC8vIGFkZGVkIGluIENvdWNoREIgMS42LjBcbiAgICAgIHBhcmFtcy5wdXNoKCdhdHRhY2htZW50cz10cnVlJyk7XG4gICAgfVxuXG4gICAgaWYgKG9wdHMua2V5KSB7XG4gICAgICBwYXJhbXMucHVzaCgna2V5PScgKyBlbmNvZGVVUklDb21wb25lbnQoSlNPTi5zdHJpbmdpZnkob3B0cy5rZXkpKSk7XG4gICAgfVxuXG4gICAgLy8gSWYgb3B0cy5zdGFydGtleSBleGlzdHMsIGFkZCB0aGUgc3RhcnRrZXkgdmFsdWUgdG8gdGhlIGxpc3Qgb2ZcbiAgICAvLyBwYXJhbWV0ZXJzLlxuICAgIC8vIElmIHN0YXJ0a2V5IGlzIGdpdmVuIHRoZW4gdGhlIHJldHVybmVkIGxpc3Qgb2YgZG9jdW1lbnRzIHdpbGxcbiAgICAvLyBzdGFydCB3aXRoIHRoZSBkb2N1bWVudCB3aG9zZSBpZCBpcyBzdGFydGtleS5cbiAgICBpZiAob3B0cy5zdGFydGtleSkge1xuICAgICAgcGFyYW1zLnB1c2goJ3N0YXJ0a2V5PScgK1xuICAgICAgICBlbmNvZGVVUklDb21wb25lbnQoSlNPTi5zdHJpbmdpZnkob3B0cy5zdGFydGtleSkpKTtcbiAgICB9XG5cbiAgICAvLyBJZiBvcHRzLmVuZGtleSBleGlzdHMsIGFkZCB0aGUgZW5ka2V5IHZhbHVlIHRvIHRoZSBsaXN0IG9mIHBhcmFtZXRlcnMuXG4gICAgLy8gSWYgZW5ka2V5IGlzIGdpdmVuIHRoZW4gdGhlIHJldHVybmVkIGxpc3Qgb2YgZG9jdWVtbnRzIHdpbGxcbiAgICAvLyBlbmQgd2l0aCB0aGUgZG9jdW1lbnQgd2hvc2UgaWQgaXMgZW5ka2V5LlxuICAgIGlmIChvcHRzLmVuZGtleSkge1xuICAgICAgcGFyYW1zLnB1c2goJ2VuZGtleT0nICsgZW5jb2RlVVJJQ29tcG9uZW50KEpTT04uc3RyaW5naWZ5KG9wdHMuZW5ka2V5KSkpO1xuICAgIH1cblxuICAgIGlmICh0eXBlb2Ygb3B0cy5pbmNsdXNpdmVfZW5kICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgcGFyYW1zLnB1c2goJ2luY2x1c2l2ZV9lbmQ9JyArICEhb3B0cy5pbmNsdXNpdmVfZW5kKTtcbiAgICB9XG5cbiAgICAvLyBJZiBvcHRzLmxpbWl0IGV4aXN0cywgYWRkIHRoZSBsaW1pdCB2YWx1ZSB0byB0aGUgcGFyYW1ldGVyIGxpc3QuXG4gICAgaWYgKHR5cGVvZiBvcHRzLmxpbWl0ICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgcGFyYW1zLnB1c2goJ2xpbWl0PScgKyBvcHRzLmxpbWl0KTtcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIG9wdHMuc2tpcCAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgIHBhcmFtcy5wdXNoKCdza2lwPScgKyBvcHRzLnNraXApO1xuICAgIH1cblxuICAgIC8vIEZvcm1hdCB0aGUgbGlzdCBvZiBwYXJhbWV0ZXJzIGludG8gYSB2YWxpZCBVUkkgcXVlcnkgc3RyaW5nXG4gICAgcGFyYW1zID0gcGFyYW1zLmpvaW4oJyYnKTtcbiAgICBpZiAocGFyYW1zICE9PSAnJykge1xuICAgICAgcGFyYW1zID0gJz8nICsgcGFyYW1zO1xuICAgIH1cblxuICAgIGlmICh0eXBlb2Ygb3B0cy5rZXlzICE9PSAndW5kZWZpbmVkJykge1xuXG5cbiAgICAgIHZhciBrZXlzQXNTdHJpbmcgPVxuICAgICAgICAna2V5cz0nICsgZW5jb2RlVVJJQ29tcG9uZW50KEpTT04uc3RyaW5naWZ5KG9wdHMua2V5cykpO1xuICAgICAgaWYgKGtleXNBc1N0cmluZy5sZW5ndGggKyBwYXJhbXMubGVuZ3RoICsgMSA8PSBNQVhfVVJMX0xFTkdUSCkge1xuICAgICAgICAvLyBJZiB0aGUga2V5cyBhcmUgc2hvcnQgZW5vdWdoLCBkbyBhIEdFVC4gd2UgZG8gdGhpcyB0byB3b3JrIGFyb3VuZFxuICAgICAgICAvLyBTYWZhcmkgbm90IHVuZGVyc3RhbmRpbmcgMzA0cyBvbiBQT1NUcyAoc2VlIGlzc3VlICMxMjM5KVxuICAgICAgICBwYXJhbXMgKz0gKHBhcmFtcy5pbmRleE9mKCc/JykgIT09IC0xID8gJyYnIDogJz8nKSArIGtleXNBc1N0cmluZztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIElmIGtleXMgYXJlIHRvbyBsb25nLCBpc3N1ZSBhIFBPU1QgcmVxdWVzdCB0byBjaXJjdW12ZW50IEdFVFxuICAgICAgICAvLyBxdWVyeSBzdHJpbmcgbGltaXRzXG4gICAgICAgIC8vIHNlZSBodHRwOi8vd2lraS5hcGFjaGUub3JnL2NvdWNoZGIvSFRUUF92aWV3X0FQSSNRdWVyeWluZ19PcHRpb25zXG4gICAgICAgIG1ldGhvZCA9ICdQT1NUJztcbiAgICAgICAgYm9keSA9IEpTT04uc3RyaW5naWZ5KHtrZXlzOiBvcHRzLmtleXN9KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBHZXQgdGhlIGRvY3VtZW50IGxpc3RpbmdcbiAgICBhamF4KHtcbiAgICAgIGhlYWRlcnM6IGhvc3QuaGVhZGVycyxcbiAgICAgIG1ldGhvZDogbWV0aG9kLFxuICAgICAgdXJsOiBnZW5EQlVybChob3N0LCAnX2FsbF9kb2NzJyArIHBhcmFtcyksXG4gICAgICBib2R5OiBib2R5XG4gICAgfSwgY2FsbGJhY2spO1xuICB9KTtcblxuICAvLyBHZXQgYSBsaXN0IG9mIGNoYW5nZXMgbWFkZSB0byBkb2N1bWVudHMgaW4gdGhlIGRhdGFiYXNlIGdpdmVuIGJ5IGhvc3QuXG4gIC8vIFRPRE8gQWNjb3JkaW5nIHRvIHRoZSBSRUFETUUsIHRoZXJlIHNob3VsZCBiZSB0d28gb3RoZXIgbWV0aG9kcyBoZXJlLFxuICAvLyBhcGkuY2hhbmdlcy5hZGRMaXN0ZW5lciBhbmQgYXBpLmNoYW5nZXMucmVtb3ZlTGlzdGVuZXIuXG4gIGFwaS5fY2hhbmdlcyA9IGZ1bmN0aW9uIChvcHRzKSB7XG4gICAgLy8gV2UgaW50ZXJuYWxseSBwYWdlIHRoZSByZXN1bHRzIG9mIGEgY2hhbmdlcyByZXF1ZXN0LCB0aGlzIG1lYW5zXG4gICAgLy8gaWYgdGhlcmUgaXMgYSBsYXJnZSBzZXQgb2YgY2hhbmdlcyB0byBiZSByZXR1cm5lZCB3ZSBjYW4gc3RhcnRcbiAgICAvLyBwcm9jZXNzaW5nIHRoZW0gcXVpY2tlciBpbnN0ZWFkIG9mIHdhaXRpbmcgb24gdGhlIGVudGlyZVxuICAgIC8vIHNldCBvZiBjaGFuZ2VzIHRvIHJldHVybiBhbmQgYXR0ZW1wdGluZyB0byBwcm9jZXNzIHRoZW0gYXQgb25jZVxuICAgIHZhciBiYXRjaFNpemUgPSAnYmF0Y2hfc2l6ZScgaW4gb3B0cyA/IG9wdHMuYmF0Y2hfc2l6ZSA6IENIQU5HRVNfQkFUQ0hfU0laRTtcblxuICAgIG9wdHMgPSB1dGlscy5jbG9uZShvcHRzKTtcbiAgICBvcHRzLnRpbWVvdXQgPSBvcHRzLnRpbWVvdXQgfHwgMzAgKiAxMDAwO1xuXG4gICAgLy8gV2UgZ2l2ZSBhIDUgc2Vjb25kIGJ1ZmZlciBmb3IgQ291Y2hEQiBjaGFuZ2VzIHRvIHJlc3BvbmQgd2l0aFxuICAgIC8vIGFuIG9rIHRpbWVvdXRcbiAgICB2YXIgcGFyYW1zID0geyB0aW1lb3V0OiBvcHRzLnRpbWVvdXQgLSAoNSAqIDEwMDApIH07XG4gICAgdmFyIGxpbWl0ID0gKHR5cGVvZiBvcHRzLmxpbWl0ICE9PSAndW5kZWZpbmVkJykgPyBvcHRzLmxpbWl0IDogZmFsc2U7XG4gICAgaWYgKGxpbWl0ID09PSAwKSB7XG4gICAgICBsaW1pdCA9IDE7XG4gICAgfVxuICAgIHZhciByZXR1cm5Eb2NzO1xuICAgIGlmICgncmV0dXJuRG9jcycgaW4gb3B0cykge1xuICAgICAgcmV0dXJuRG9jcyA9IG9wdHMucmV0dXJuRG9jcztcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuRG9jcyA9IHRydWU7XG4gICAgfVxuICAgIC8vXG4gICAgdmFyIGxlZnRUb0ZldGNoID0gbGltaXQ7XG5cbiAgICBpZiAob3B0cy5zdHlsZSkge1xuICAgICAgcGFyYW1zLnN0eWxlID0gb3B0cy5zdHlsZTtcbiAgICB9XG5cbiAgICBpZiAob3B0cy5pbmNsdWRlX2RvY3MgfHwgb3B0cy5maWx0ZXIgJiYgdHlwZW9mIG9wdHMuZmlsdGVyID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICBwYXJhbXMuaW5jbHVkZV9kb2NzID0gdHJ1ZTtcbiAgICB9XG5cbiAgICBpZiAob3B0cy5hdHRhY2htZW50cykge1xuICAgICAgcGFyYW1zLmF0dGFjaG1lbnRzID0gdHJ1ZTtcbiAgICB9XG5cbiAgICBpZiAob3B0cy5jb250aW51b3VzKSB7XG4gICAgICBwYXJhbXMuZmVlZCA9ICdsb25ncG9sbCc7XG4gICAgfVxuXG4gICAgaWYgKG9wdHMuY29uZmxpY3RzKSB7XG4gICAgICBwYXJhbXMuY29uZmxpY3RzID0gdHJ1ZTtcbiAgICB9XG5cbiAgICBpZiAob3B0cy5kZXNjZW5kaW5nKSB7XG4gICAgICBwYXJhbXMuZGVzY2VuZGluZyA9IHRydWU7XG4gICAgfVxuXG4gICAgaWYgKG9wdHMuZmlsdGVyICYmIHR5cGVvZiBvcHRzLmZpbHRlciA9PT0gJ3N0cmluZycpIHtcbiAgICAgIHBhcmFtcy5maWx0ZXIgPSBvcHRzLmZpbHRlcjtcbiAgICAgIGlmIChvcHRzLmZpbHRlciA9PT0gJ192aWV3JyAmJlxuICAgICAgICAgIG9wdHMudmlldyAmJlxuICAgICAgICAgIHR5cGVvZiBvcHRzLnZpZXcgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgIHBhcmFtcy52aWV3ID0gb3B0cy52aWV3O1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIElmIG9wdHMucXVlcnlfcGFyYW1zIGV4aXN0cywgcGFzcyBpdCB0aHJvdWdoIHRvIHRoZSBjaGFuZ2VzIHJlcXVlc3QuXG4gICAgLy8gVGhlc2UgcGFyYW1ldGVycyBtYXkgYmUgdXNlZCBieSB0aGUgZmlsdGVyIG9uIHRoZSBzb3VyY2UgZGF0YWJhc2UuXG4gICAgaWYgKG9wdHMucXVlcnlfcGFyYW1zICYmIHR5cGVvZiBvcHRzLnF1ZXJ5X3BhcmFtcyA9PT0gJ29iamVjdCcpIHtcbiAgICAgIGZvciAodmFyIHBhcmFtX25hbWUgaW4gb3B0cy5xdWVyeV9wYXJhbXMpIHtcbiAgICAgICAgaWYgKG9wdHMucXVlcnlfcGFyYW1zLmhhc093blByb3BlcnR5KHBhcmFtX25hbWUpKSB7XG4gICAgICAgICAgcGFyYW1zW3BhcmFtX25hbWVdID0gb3B0cy5xdWVyeV9wYXJhbXNbcGFyYW1fbmFtZV07XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICB2YXIgbWV0aG9kID0gJ0dFVCc7XG4gICAgdmFyIGJvZHk7XG5cbiAgICBpZiAob3B0cy5kb2NfaWRzKSB7XG4gICAgICAvLyBzZXQgdGhpcyBhdXRvbWFnaWNhbGx5IGZvciB0aGUgdXNlcjsgaXQncyBhbm5veWluZyB0aGF0IGNvdWNoZGJcbiAgICAgIC8vIHJlcXVpcmVzIGJvdGggYSBcImZpbHRlclwiIGFuZCBhIFwiZG9jX2lkc1wiIHBhcmFtLlxuICAgICAgcGFyYW1zLmZpbHRlciA9ICdfZG9jX2lkcyc7XG5cbiAgICAgIHZhciBkb2NJZHNKc29uID0gSlNPTi5zdHJpbmdpZnkob3B0cy5kb2NfaWRzKTtcblxuICAgICAgaWYgKGRvY0lkc0pzb24ubGVuZ3RoIDwgTUFYX1VSTF9MRU5HVEgpIHtcbiAgICAgICAgcGFyYW1zLmRvY19pZHMgPSBkb2NJZHNKc29uO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gYW55dGhpbmcgZ3JlYXRlciB0aGFuIH4yMDAwIGlzIHVuc2FmZSBmb3IgZ2V0cywgc29cbiAgICAgICAgLy8gdXNlIFBPU1QgaW5zdGVhZFxuICAgICAgICBtZXRob2QgPSAnUE9TVCc7XG4gICAgICAgIGJvZHkgPSB7ZG9jX2lkczogb3B0cy5kb2NfaWRzIH07XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKG9wdHMuY29udGludW91cyAmJiBhcGkuX3VzZVNTRSkge1xuICAgICAgcmV0dXJuICBhcGkuc3NlKG9wdHMsIHBhcmFtcywgcmV0dXJuRG9jcyk7XG4gICAgfVxuICAgIHZhciB4aHI7XG4gICAgdmFyIGxhc3RGZXRjaGVkU2VxO1xuXG4gICAgLy8gR2V0IGFsbCB0aGUgY2hhbmdlcyBzdGFydGluZyB3dGloIHRoZSBvbmUgaW1tZWRpYXRlbHkgYWZ0ZXIgdGhlXG4gICAgLy8gc2VxdWVuY2UgbnVtYmVyIGdpdmVuIGJ5IHNpbmNlLlxuICAgIHZhciBmZXRjaCA9IGZ1bmN0aW9uIChzaW5jZSwgY2FsbGJhY2spIHtcbiAgICAgIGlmIChvcHRzLmFib3J0ZWQpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgcGFyYW1zLnNpbmNlID0gc2luY2U7XG4gICAgICBpZiAodHlwZW9mIHBhcmFtcy5zaW5jZSA9PT0gXCJvYmplY3RcIikge1xuICAgICAgICBwYXJhbXMuc2luY2UgPSBKU09OLnN0cmluZ2lmeShwYXJhbXMuc2luY2UpO1xuICAgICAgfVxuXG4gICAgICBpZiAob3B0cy5kZXNjZW5kaW5nKSB7XG4gICAgICAgIGlmIChsaW1pdCkge1xuICAgICAgICAgIHBhcmFtcy5saW1pdCA9IGxlZnRUb0ZldGNoO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBwYXJhbXMubGltaXQgPSAoIWxpbWl0IHx8IGxlZnRUb0ZldGNoID4gYmF0Y2hTaXplKSA/XG4gICAgICAgICAgYmF0Y2hTaXplIDogbGVmdFRvRmV0Y2g7XG4gICAgICB9XG5cbiAgICAgIHZhciBwYXJhbVN0ciA9ICc/JyArIE9iamVjdC5rZXlzKHBhcmFtcykubWFwKGZ1bmN0aW9uIChrKSB7XG4gICAgICAgIHJldHVybiBrICsgJz0nICsgcGFyYW1zW2tdO1xuICAgICAgfSkuam9pbignJicpO1xuXG4gICAgICAvLyBTZXQgdGhlIG9wdGlvbnMgZm9yIHRoZSBhamF4IGNhbGxcbiAgICAgIHZhciB4aHJPcHRzID0ge1xuICAgICAgICBoZWFkZXJzOiBob3N0LmhlYWRlcnMsXG4gICAgICAgIG1ldGhvZDogbWV0aG9kLFxuICAgICAgICB1cmw6IGdlbkRCVXJsKGhvc3QsICdfY2hhbmdlcycgKyBwYXJhbVN0ciksXG4gICAgICAgIC8vIF9jaGFuZ2VzIGNhbiB0YWtlIGEgbG9uZyB0aW1lIHRvIGdlbmVyYXRlLCBlc3BlY2lhbGx5IHdoZW4gZmlsdGVyZWRcbiAgICAgICAgdGltZW91dDogb3B0cy50aW1lb3V0LFxuICAgICAgICBib2R5OiBib2R5XG4gICAgICB9O1xuICAgICAgbGFzdEZldGNoZWRTZXEgPSBzaW5jZTtcblxuICAgICAgaWYgKG9wdHMuYWJvcnRlZCkge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIC8vIEdldCB0aGUgY2hhbmdlc1xuICAgICAgeGhyID0gYWpheCh4aHJPcHRzLCBjYWxsYmFjayk7XG4gICAgfTtcblxuICAgIC8vIElmIG9wdHMuc2luY2UgZXhpc3RzLCBnZXQgYWxsIHRoZSBjaGFuZ2VzIGZyb20gdGhlIHNlcXVlbmNlXG4gICAgLy8gbnVtYmVyIGdpdmVuIGJ5IG9wdHMuc2luY2UuIE90aGVyd2lzZSwgZ2V0IGFsbCB0aGUgY2hhbmdlc1xuICAgIC8vIGZyb20gdGhlIHNlcXVlbmNlIG51bWJlciAwLlxuICAgIHZhciBmZXRjaFRpbWVvdXQgPSAxMDtcbiAgICB2YXIgZmV0Y2hSZXRyeUNvdW50ID0gMDtcblxuICAgIHZhciByZXN1bHRzID0ge3Jlc3VsdHM6IFtdfTtcblxuICAgIHZhciBmZXRjaGVkID0gZnVuY3Rpb24gKGVyciwgcmVzKSB7XG4gICAgICBpZiAob3B0cy5hYm9ydGVkKSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHZhciByYXdfcmVzdWx0c19sZW5ndGggPSAwO1xuICAgICAgLy8gSWYgdGhlIHJlc3VsdCBvZiB0aGUgYWpheCBjYWxsIChyZXMpIGNvbnRhaW5zIGNoYW5nZXMgKHJlcy5yZXN1bHRzKVxuICAgICAgaWYgKHJlcyAmJiByZXMucmVzdWx0cykge1xuICAgICAgICByYXdfcmVzdWx0c19sZW5ndGggPSByZXMucmVzdWx0cy5sZW5ndGg7XG4gICAgICAgIHJlc3VsdHMubGFzdF9zZXEgPSByZXMubGFzdF9zZXE7XG4gICAgICAgIC8vIEZvciBlYWNoIGNoYW5nZVxuICAgICAgICB2YXIgcmVxID0ge307XG4gICAgICAgIHJlcS5xdWVyeSA9IG9wdHMucXVlcnlfcGFyYW1zO1xuICAgICAgICByZXMucmVzdWx0cyA9IHJlcy5yZXN1bHRzLmZpbHRlcihmdW5jdGlvbiAoYykge1xuICAgICAgICAgIGxlZnRUb0ZldGNoLS07XG4gICAgICAgICAgdmFyIHJldCA9IHV0aWxzLmZpbHRlckNoYW5nZShvcHRzKShjKTtcbiAgICAgICAgICBpZiAocmV0KSB7XG4gICAgICAgICAgICBpZiAocmV0dXJuRG9jcykge1xuICAgICAgICAgICAgICByZXN1bHRzLnJlc3VsdHMucHVzaChjKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHV0aWxzLmNhbGwob3B0cy5vbkNoYW5nZSwgYyk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiByZXQ7XG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIGlmIChlcnIpIHtcbiAgICAgICAgLy8gSW4gY2FzZSBvZiBhbiBlcnJvciwgc3RvcCBsaXN0ZW5pbmcgZm9yIGNoYW5nZXMgYW5kIGNhbGxcbiAgICAgICAgLy8gb3B0cy5jb21wbGV0ZVxuICAgICAgICBvcHRzLmFib3J0ZWQgPSB0cnVlO1xuICAgICAgICB1dGlscy5jYWxsKG9wdHMuY29tcGxldGUsIGVycik7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgLy8gVGhlIGNoYW5nZXMgZmVlZCBtYXkgaGF2ZSB0aW1lZCBvdXQgd2l0aCBubyByZXN1bHRzXG4gICAgICAvLyBpZiBzbyByZXVzZSBsYXN0IHVwZGF0ZSBzZXF1ZW5jZVxuICAgICAgaWYgKHJlcyAmJiByZXMubGFzdF9zZXEpIHtcbiAgICAgICAgbGFzdEZldGNoZWRTZXEgPSByZXMubGFzdF9zZXE7XG4gICAgICB9XG5cbiAgICAgIHZhciBmaW5pc2hlZCA9IChsaW1pdCAmJiBsZWZ0VG9GZXRjaCA8PSAwKSB8fFxuICAgICAgICAocmVzICYmIHJhd19yZXN1bHRzX2xlbmd0aCA8IGJhdGNoU2l6ZSkgfHxcbiAgICAgICAgKG9wdHMuZGVzY2VuZGluZyk7XG5cbiAgICAgIGlmICgob3B0cy5jb250aW51b3VzICYmICEobGltaXQgJiYgbGVmdFRvRmV0Y2ggPD0gMCkpIHx8ICFmaW5pc2hlZCkge1xuICAgICAgICAvLyBJbmNyZWFzZSByZXRyeSBkZWxheSBleHBvbmVudGlhbGx5IGFzIGxvbmcgYXMgZXJyb3JzIHBlcnNpc3RcbiAgICAgICAgaWYgKGVycikge1xuICAgICAgICAgIGZldGNoUmV0cnlDb3VudCArPSAxO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGZldGNoUmV0cnlDb3VudCA9IDA7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHRpbWVvdXRNdWx0aXBsaWVyID0gMSA8PCBmZXRjaFJldHJ5Q291bnQ7XG4gICAgICAgIHZhciByZXRyeVdhaXQgPSBmZXRjaFRpbWVvdXQgKiB0aW1lb3V0TXVsdGlwbGllcjtcbiAgICAgICAgdmFyIG1heGltdW1XYWl0ID0gb3B0cy5tYXhpbXVtV2FpdCB8fCAzMDAwMDtcblxuICAgICAgICBpZiAocmV0cnlXYWl0ID4gbWF4aW11bVdhaXQpIHtcbiAgICAgICAgICB1dGlscy5jYWxsKG9wdHMuY29tcGxldGUsIGVyciB8fCBlcnJvcnMuZXJyb3IoZXJyb3JzLlVOS05PV05fRVJST1IpKTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICAvLyBRdWV1ZSBhIGNhbGwgdG8gZmV0Y2ggYWdhaW4gd2l0aCB0aGUgbmV3ZXN0IHNlcXVlbmNlIG51bWJlclxuICAgICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uICgpIHsgZmV0Y2gobGFzdEZldGNoZWRTZXEsIGZldGNoZWQpOyB9LCByZXRyeVdhaXQpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gV2UncmUgZG9uZSwgY2FsbCB0aGUgY2FsbGJhY2tcbiAgICAgICAgdXRpbHMuY2FsbChvcHRzLmNvbXBsZXRlLCBudWxsLCByZXN1bHRzKTtcbiAgICAgIH1cbiAgICB9O1xuXG4gICAgZmV0Y2gob3B0cy5zaW5jZSB8fCAwLCBmZXRjaGVkKTtcblxuICAgIC8vIFJldHVybiBhIG1ldGhvZCB0byBjYW5jZWwgdGhpcyBtZXRob2QgZnJvbSBwcm9jZXNzaW5nIGFueSBtb3JlXG4gICAgcmV0dXJuIHtcbiAgICAgIGNhbmNlbDogZnVuY3Rpb24gKCkge1xuICAgICAgICBvcHRzLmFib3J0ZWQgPSB0cnVlO1xuICAgICAgICBpZiAoeGhyKSB7XG4gICAgICAgICAgeGhyLmFib3J0KCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9O1xuICB9O1xuXG4gIGFwaS5zc2UgPSBmdW5jdGlvbiAob3B0cywgcGFyYW1zLCByZXR1cm5Eb2NzKSB7XG4gICAgcGFyYW1zLmZlZWQgPSAnZXZlbnRzb3VyY2UnO1xuICAgIHBhcmFtcy5zaW5jZSA9IG9wdHMuc2luY2UgfHwgMDtcbiAgICBwYXJhbXMubGltaXQgPSBvcHRzLmxpbWl0O1xuICAgIGRlbGV0ZSBwYXJhbXMudGltZW91dDtcbiAgICB2YXIgcGFyYW1TdHIgPSAnPycgKyBPYmplY3Qua2V5cyhwYXJhbXMpLm1hcChmdW5jdGlvbiAoaykge1xuICAgICAgcmV0dXJuIGsgKyAnPScgKyBwYXJhbXNba107XG4gICAgfSkuam9pbignJicpO1xuICAgIHZhciB1cmwgPSBnZW5EQlVybChob3N0LCAnX2NoYW5nZXMnICsgcGFyYW1TdHIpO1xuICAgIHZhciBzb3VyY2UgPSBuZXcgRXZlbnRTb3VyY2UodXJsKTtcbiAgICB2YXIgcmVzdWx0cyA9IHtcbiAgICAgIHJlc3VsdHM6IFtdLFxuICAgICAgbGFzdF9zZXE6IGZhbHNlXG4gICAgfTtcbiAgICB2YXIgZGlzcGF0Y2hlZCA9IGZhbHNlO1xuICAgIHZhciBvcGVuID0gZmFsc2U7XG4gICAgc291cmNlLmFkZEV2ZW50TGlzdGVuZXIoJ21lc3NhZ2UnLCBtc2dIYW5kbGVyLCBmYWxzZSk7XG4gICAgc291cmNlLm9ub3BlbiA9IGZ1bmN0aW9uICgpIHtcbiAgICAgIG9wZW4gPSB0cnVlO1xuICAgIH07XG4gICAgc291cmNlLm9uZXJyb3IgPSBlcnJIYW5kbGVyO1xuICAgIHJldHVybiB7XG4gICAgICBjYW5jZWw6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgaWYgKGRpc3BhdGNoZWQpIHtcbiAgICAgICAgICByZXR1cm4gZGlzcGF0Y2hlZC5jYW5jZWwoKTtcbiAgICAgICAgfVxuICAgICAgICBzb3VyY2UucmVtb3ZlRXZlbnRMaXN0ZW5lcignbWVzc2FnZScsIG1zZ0hhbmRsZXIsIGZhbHNlKTtcbiAgICAgICAgc291cmNlLmNsb3NlKCk7XG4gICAgICB9XG4gICAgfTtcbiAgICBmdW5jdGlvbiBtc2dIYW5kbGVyKGUpIHtcbiAgICAgIHZhciBkYXRhID0gSlNPTi5wYXJzZShlLmRhdGEpO1xuICAgICAgaWYgKHJldHVybkRvY3MpIHtcbiAgICAgICAgcmVzdWx0cy5yZXN1bHRzLnB1c2goZGF0YSk7XG4gICAgICB9XG4gICAgICByZXN1bHRzLmxhc3Rfc2VxID0gZGF0YS5zZXE7XG4gICAgICB1dGlscy5jYWxsKG9wdHMub25DaGFuZ2UsIGRhdGEpO1xuICAgIH1cbiAgICBmdW5jdGlvbiBlcnJIYW5kbGVyKGVycikge1xuICAgICAgc291cmNlLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ21lc3NhZ2UnLCBtc2dIYW5kbGVyLCBmYWxzZSk7XG4gICAgICBpZiAob3BlbiA9PT0gZmFsc2UpIHtcbiAgICAgICAgLy8gZXJyb3JlZCBiZWZvcmUgaXQgb3BlbmVkXG4gICAgICAgIC8vIGxpa2VseSBkb2Vzbid0IHN1cHBvcnQgRXZlbnRTb3VyY2VcbiAgICAgICAgYXBpLl91c2VTU0UgPSBmYWxzZTtcbiAgICAgICAgZGlzcGF0Y2hlZCA9IGFwaS5fY2hhbmdlcyhvcHRzKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgc291cmNlLmNsb3NlKCk7XG4gICAgICB1dGlscy5jYWxsKG9wdHMuY29tcGxldGUsIGVycik7XG4gICAgfVxuICAgIFxuICB9O1xuXG4gIGFwaS5fdXNlU1NFID0gZmFsc2U7XG4gIC8vIEN1cnJlbnRseSBkaXNhYmxlZCBkdWUgdG8gZmFpbGluZyBjaHJvbWUgdGVzdHMgaW4gc2F1Y2VsYWJzXG4gIC8vIGFwaS5fdXNlU1NFID0gdHlwZW9mIGdsb2JhbC5FdmVudFNvdXJjZSA9PT0gJ2Z1bmN0aW9uJztcblxuICAvLyBHaXZlbiBhIHNldCBvZiBkb2N1bWVudC9yZXZpc2lvbiBJRHMgKGdpdmVuIGJ5IHJlcSksIHRldHMgdGhlIHN1YnNldCBvZlxuICAvLyB0aG9zZSB0aGF0IGRvIE5PVCBjb3JyZXNwb25kIHRvIHJldmlzaW9ucyBzdG9yZWQgaW4gdGhlIGRhdGFiYXNlLlxuICAvLyBTZWUgaHR0cDovL3dpa2kuYXBhY2hlLm9yZy9jb3VjaGRiL0h0dHBQb3N0UmV2c0RpZmZcbiAgYXBpLnJldnNEaWZmID0gdXRpbHMuYWRhcHRlckZ1bigncmV2c0RpZmYnLCBmdW5jdGlvbiAocmVxLCBvcHRzLCBjYWxsYmFjaykge1xuICAgIC8vIElmIG5vIG9wdGlvbnMgd2VyZSBnaXZlbiwgc2V0IHRoZSBjYWxsYmFjayB0byBiZSB0aGUgc2Vjb25kIHBhcmFtZXRlclxuICAgIGlmICh0eXBlb2Ygb3B0cyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgY2FsbGJhY2sgPSBvcHRzO1xuICAgICAgb3B0cyA9IHt9O1xuICAgIH1cblxuICAgIC8vIEdldCB0aGUgbWlzc2luZyBkb2N1bWVudC9yZXZpc2lvbiBJRHNcbiAgICBhamF4KHtcbiAgICAgIGhlYWRlcnM6IGhvc3QuaGVhZGVycyxcbiAgICAgIG1ldGhvZDogJ1BPU1QnLFxuICAgICAgdXJsOiBnZW5EQlVybChob3N0LCAnX3JldnNfZGlmZicpLFxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkocmVxKVxuICAgIH0sIGNhbGxiYWNrKTtcbiAgfSk7XG5cbiAgYXBpLl9jbG9zZSA9IGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgIGNhbGxiYWNrKCk7XG4gIH07XG5cbiAgYXBpLmRlc3Ryb3kgPSB1dGlscy5hZGFwdGVyRnVuKCdkZXN0cm95JywgZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgYWpheCh7XG4gICAgICB1cmw6IGdlbkRCVXJsKGhvc3QsICcnKSxcbiAgICAgIG1ldGhvZDogJ0RFTEVURScsXG4gICAgICBoZWFkZXJzOiBob3N0LmhlYWRlcnNcbiAgICB9LCBmdW5jdGlvbiAoZXJyLCByZXNwKSB7XG4gICAgICBpZiAoZXJyKSB7XG4gICAgICAgIGFwaS5lbWl0KCdlcnJvcicsIGVycik7XG4gICAgICAgIGNhbGxiYWNrKGVycik7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBhcGkuZW1pdCgnZGVzdHJveWVkJyk7XG4gICAgICAgIGNhbGxiYWNrKG51bGwsIHJlc3ApO1xuICAgICAgfVxuICAgIH0pO1xuICB9KTtcbn1cblxuLy8gRGVsZXRlIHRoZSBIdHRwUG91Y2ggc3BlY2lmaWVkIGJ5IHRoZSBnaXZlbiBuYW1lLlxuSHR0cFBvdWNoLmRlc3Ryb3kgPSB1dGlscy50b1Byb21pc2UoZnVuY3Rpb24gKG5hbWUsIG9wdHMsIGNhbGxiYWNrKSB7XG4gIHZhciBob3N0ID0gZ2V0SG9zdChuYW1lLCBvcHRzKTtcbiAgb3B0cyA9IG9wdHMgfHwge307XG4gIGlmICh0eXBlb2Ygb3B0cyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIGNhbGxiYWNrID0gb3B0cztcbiAgICBvcHRzID0ge307XG4gIH1cbiAgb3B0cyA9IHV0aWxzLmNsb25lKG9wdHMpO1xuICBvcHRzLmhlYWRlcnMgPSBob3N0LmhlYWRlcnM7XG4gIG9wdHMubWV0aG9kID0gJ0RFTEVURSc7XG4gIG9wdHMudXJsID0gZ2VuREJVcmwoaG9zdCwgJycpO1xuICB2YXIgYWpheE9wdHMgPSBvcHRzLmFqYXggfHwge307XG4gIG9wdHMgPSB1dGlscy5leHRlbmQoe30sIG9wdHMsIGFqYXhPcHRzKTtcbiAgdXRpbHMuYWpheChvcHRzLCBjYWxsYmFjayk7XG59KTtcblxuLy8gSHR0cFBvdWNoIGlzIGEgdmFsaWQgYWRhcHRlci5cbkh0dHBQb3VjaC52YWxpZCA9IGZ1bmN0aW9uICgpIHtcbiAgcmV0dXJuIHRydWU7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IEh0dHBQb3VjaDtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIG1lcmdlID0gcmVxdWlyZSgnLi4vLi4vbWVyZ2UnKTtcbnZhciBlcnJvcnMgPSByZXF1aXJlKCcuLi8uLi9kZXBzL2Vycm9ycycpO1xudmFyIGlkYlV0aWxzID0gcmVxdWlyZSgnLi9pZGItdXRpbHMnKTtcbnZhciBpZGJDb25zdGFudHMgPSByZXF1aXJlKCcuL2lkYi1jb25zdGFudHMnKTtcblxudmFyIEFUVEFDSF9TVE9SRSA9IGlkYkNvbnN0YW50cy5BVFRBQ0hfU1RPUkU7XG52YXIgQllfU0VRX1NUT1JFID0gaWRiQ29uc3RhbnRzLkJZX1NFUV9TVE9SRTtcbnZhciBET0NfU1RPUkUgPSBpZGJDb25zdGFudHMuRE9DX1NUT1JFO1xuXG52YXIgZGVjb2RlRG9jID0gaWRiVXRpbHMuZGVjb2RlRG9jO1xudmFyIGRlY29kZU1ldGFkYXRhID0gaWRiVXRpbHMuZGVjb2RlTWV0YWRhdGE7XG52YXIgZmV0Y2hBdHRhY2htZW50c0lmTmVjZXNzYXJ5ID0gaWRiVXRpbHMuZmV0Y2hBdHRhY2htZW50c0lmTmVjZXNzYXJ5O1xudmFyIHBvc3RQcm9jZXNzQXR0YWNobWVudHMgPSBpZGJVdGlscy5wb3N0UHJvY2Vzc0F0dGFjaG1lbnRzO1xudmFyIG9wZW5UcmFuc2FjdGlvblNhZmVseSA9IGlkYlV0aWxzLm9wZW5UcmFuc2FjdGlvblNhZmVseTtcblxuZnVuY3Rpb24gY3JlYXRlS2V5UmFuZ2Uoc3RhcnQsIGVuZCwgaW5jbHVzaXZlRW5kLCBrZXksIGRlc2NlbmRpbmcpIHtcbiAgdHJ5IHtcbiAgICBpZiAoc3RhcnQgJiYgZW5kKSB7XG4gICAgICBpZiAoZGVzY2VuZGluZykge1xuICAgICAgICByZXR1cm4gSURCS2V5UmFuZ2UuYm91bmQoZW5kLCBzdGFydCwgIWluY2x1c2l2ZUVuZCwgZmFsc2UpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuIElEQktleVJhbmdlLmJvdW5kKHN0YXJ0LCBlbmQsIGZhbHNlLCAhaW5jbHVzaXZlRW5kKTtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHN0YXJ0KSB7XG4gICAgICBpZiAoZGVzY2VuZGluZykge1xuICAgICAgICByZXR1cm4gSURCS2V5UmFuZ2UudXBwZXJCb3VuZChzdGFydCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gSURCS2V5UmFuZ2UubG93ZXJCb3VuZChzdGFydCk7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChlbmQpIHtcbiAgICAgIGlmIChkZXNjZW5kaW5nKSB7XG4gICAgICAgIHJldHVybiBJREJLZXlSYW5nZS5sb3dlckJvdW5kKGVuZCwgIWluY2x1c2l2ZUVuZCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gSURCS2V5UmFuZ2UudXBwZXJCb3VuZChlbmQsICFpbmNsdXNpdmVFbmQpO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoa2V5KSB7XG4gICAgICByZXR1cm4gSURCS2V5UmFuZ2Uub25seShrZXkpO1xuICAgIH1cbiAgfSBjYXRjaCAoZSkge1xuICAgIHJldHVybiB7ZXJyb3I6IGV9O1xuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG5mdW5jdGlvbiBoYW5kbGVLZXlSYW5nZUVycm9yKGFwaSwgb3B0cywgZXJyLCBjYWxsYmFjaykge1xuICBpZiAoZXJyLm5hbWUgPT09IFwiRGF0YUVycm9yXCIgJiYgZXJyLmNvZGUgPT09IDApIHtcbiAgICAvLyBkYXRhIGVycm9yLCBzdGFydCBpcyBsZXNzIHRoYW4gZW5kXG4gICAgcmV0dXJuIGNhbGxiYWNrKG51bGwsIHtcbiAgICAgIHRvdGFsX3Jvd3M6IGFwaS5fbWV0YS5kb2NDb3VudCxcbiAgICAgIG9mZnNldDogb3B0cy5za2lwLFxuICAgICAgcm93czogW11cbiAgICB9KTtcbiAgfVxuICBjYWxsYmFjayhlcnJvcnMuZXJyb3IoZXJyb3JzLklEQl9FUlJPUiwgZXJyLm5hbWUsIGVyci5tZXNzYWdlKSk7XG59XG5cbmZ1bmN0aW9uIGlkYkFsbERvY3Mob3B0cywgYXBpLCBpZGIsIGNhbGxiYWNrKSB7XG5cbiAgZnVuY3Rpb24gYWxsRG9jc1F1ZXJ5KG9wdHMsIGNhbGxiYWNrKSB7XG4gICAgdmFyIHN0YXJ0ID0gJ3N0YXJ0a2V5JyBpbiBvcHRzID8gb3B0cy5zdGFydGtleSA6IGZhbHNlO1xuICAgIHZhciBlbmQgPSAnZW5ka2V5JyBpbiBvcHRzID8gb3B0cy5lbmRrZXkgOiBmYWxzZTtcbiAgICB2YXIga2V5ID0gJ2tleScgaW4gb3B0cyA/IG9wdHMua2V5IDogZmFsc2U7XG4gICAgdmFyIHNraXAgPSBvcHRzLnNraXAgfHwgMDtcbiAgICB2YXIgbGltaXQgPSB0eXBlb2Ygb3B0cy5saW1pdCA9PT0gJ251bWJlcicgPyBvcHRzLmxpbWl0IDogLTE7XG4gICAgdmFyIGluY2x1c2l2ZUVuZCA9IG9wdHMuaW5jbHVzaXZlX2VuZCAhPT0gZmFsc2U7XG4gICAgdmFyIGRlc2NlbmRpbmcgPSAnZGVzY2VuZGluZycgaW4gb3B0cyAmJiBvcHRzLmRlc2NlbmRpbmcgPyAncHJldicgOiBudWxsO1xuXG4gICAgdmFyIGtleVJhbmdlID0gY3JlYXRlS2V5UmFuZ2Uoc3RhcnQsIGVuZCwgaW5jbHVzaXZlRW5kLCBrZXksIGRlc2NlbmRpbmcpO1xuICAgIGlmIChrZXlSYW5nZSAmJiBrZXlSYW5nZS5lcnJvcikge1xuICAgICAgcmV0dXJuIGhhbmRsZUtleVJhbmdlRXJyb3IoYXBpLCBvcHRzLCBrZXlSYW5nZS5lcnJvciwgY2FsbGJhY2spO1xuICAgIH1cblxuICAgIHZhciBzdG9yZXMgPSBbRE9DX1NUT1JFLCBCWV9TRVFfU1RPUkVdO1xuXG4gICAgaWYgKG9wdHMuYXR0YWNobWVudHMpIHtcbiAgICAgIHN0b3Jlcy5wdXNoKEFUVEFDSF9TVE9SRSk7XG4gICAgfVxuICAgIHZhciB0eG5SZXN1bHQgPSBvcGVuVHJhbnNhY3Rpb25TYWZlbHkoaWRiLCBzdG9yZXMsICdyZWFkb25seScpO1xuICAgIGlmICh0eG5SZXN1bHQuZXJyb3IpIHtcbiAgICAgIHJldHVybiBjYWxsYmFjayh0eG5SZXN1bHQuZXJyb3IpO1xuICAgIH1cbiAgICB2YXIgdHhuID0gdHhuUmVzdWx0LnR4bjtcbiAgICB2YXIgZG9jU3RvcmUgPSB0eG4ub2JqZWN0U3RvcmUoRE9DX1NUT1JFKTtcbiAgICB2YXIgc2VxU3RvcmUgPSB0eG4ub2JqZWN0U3RvcmUoQllfU0VRX1NUT1JFKTtcbiAgICB2YXIgY3Vyc29yID0gZGVzY2VuZGluZyA/XG4gICAgICBkb2NTdG9yZS5vcGVuQ3Vyc29yKGtleVJhbmdlLCBkZXNjZW5kaW5nKSA6XG4gICAgICBkb2NTdG9yZS5vcGVuQ3Vyc29yKGtleVJhbmdlKTtcbiAgICB2YXIgZG9jSWRSZXZJbmRleCA9IHNlcVN0b3JlLmluZGV4KCdfZG9jX2lkX3JldicpO1xuICAgIHZhciByZXN1bHRzID0gW107XG4gICAgdmFyIGRvY0NvdW50ID0gMDtcblxuICAgIC8vIGlmIHRoZSB1c2VyIHNwZWNpZmllcyBpbmNsdWRlX2RvY3M9dHJ1ZSwgdGhlbiB3ZSBkb24ndFxuICAgIC8vIHdhbnQgdG8gYmxvY2sgdGhlIG1haW4gY3Vyc29yIHdoaWxlIHdlJ3JlIGZldGNoaW5nIHRoZSBkb2NcbiAgICBmdW5jdGlvbiBmZXRjaERvY0FzeW5jaHJvbm91c2x5KG1ldGFkYXRhLCByb3csIHdpbm5pbmdSZXYpIHtcbiAgICAgIHZhciBrZXkgPSBtZXRhZGF0YS5pZCArIFwiOjpcIiArIHdpbm5pbmdSZXY7XG4gICAgICBkb2NJZFJldkluZGV4LmdldChrZXkpLm9uc3VjY2VzcyA9ICBmdW5jdGlvbiBvbkdldERvYyhlKSB7XG4gICAgICAgIHJvdy5kb2MgPSBkZWNvZGVEb2MoZS50YXJnZXQucmVzdWx0KTtcbiAgICAgICAgaWYgKG9wdHMuY29uZmxpY3RzKSB7XG4gICAgICAgICAgcm93LmRvYy5fY29uZmxpY3RzID0gbWVyZ2UuY29sbGVjdENvbmZsaWN0cyhtZXRhZGF0YSk7XG4gICAgICAgIH1cbiAgICAgICAgZmV0Y2hBdHRhY2htZW50c0lmTmVjZXNzYXJ5KHJvdy5kb2MsIG9wdHMsIHR4bik7XG4gICAgICB9O1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGFsbERvY3NJbm5lcihjdXJzb3IsIHdpbm5pbmdSZXYsIG1ldGFkYXRhKSB7XG4gICAgICB2YXIgcm93ID0ge1xuICAgICAgICBpZDogbWV0YWRhdGEuaWQsXG4gICAgICAgIGtleTogbWV0YWRhdGEuaWQsXG4gICAgICAgIHZhbHVlOiB7XG4gICAgICAgICAgcmV2OiB3aW5uaW5nUmV2XG4gICAgICAgIH1cbiAgICAgIH07XG4gICAgICB2YXIgZGVsZXRlZCA9IG1ldGFkYXRhLmRlbGV0ZWQ7XG4gICAgICBpZiAob3B0cy5kZWxldGVkID09PSAnb2snKSB7XG4gICAgICAgIHJlc3VsdHMucHVzaChyb3cpO1xuICAgICAgICAvLyBkZWxldGVkIGRvY3MgYXJlIG9rYXkgd2l0aCBcImtleXNcIiByZXF1ZXN0c1xuICAgICAgICBpZiAoZGVsZXRlZCkge1xuICAgICAgICAgIHJvdy52YWx1ZS5kZWxldGVkID0gdHJ1ZTtcbiAgICAgICAgICByb3cuZG9jID0gbnVsbDtcbiAgICAgICAgfSBlbHNlIGlmIChvcHRzLmluY2x1ZGVfZG9jcykge1xuICAgICAgICAgIGZldGNoRG9jQXN5bmNocm9ub3VzbHkobWV0YWRhdGEsIHJvdywgd2lubmluZ1Jldik7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAoIWRlbGV0ZWQgJiYgc2tpcC0tIDw9IDApIHtcbiAgICAgICAgcmVzdWx0cy5wdXNoKHJvdyk7XG4gICAgICAgIGlmIChvcHRzLmluY2x1ZGVfZG9jcykge1xuICAgICAgICAgIGZldGNoRG9jQXN5bmNocm9ub3VzbHkobWV0YWRhdGEsIHJvdywgd2lubmluZ1Jldik7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKC0tbGltaXQgPT09IDApIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGN1cnNvcltcImNvbnRpbnVlXCJdKCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gb25HZXRDdXJzb3IoZSkge1xuICAgICAgZG9jQ291bnQgPSBhcGkuX21ldGEuZG9jQ291bnQ7IC8vIGRvIHRoaXMgd2l0aGluIHRoZSB0eG4gZm9yIGNvbnNpc3RlbmN5XG4gICAgICB2YXIgY3Vyc29yID0gZS50YXJnZXQucmVzdWx0O1xuICAgICAgaWYgKCFjdXJzb3IpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgdmFyIG1ldGFkYXRhID0gZGVjb2RlTWV0YWRhdGEoY3Vyc29yLnZhbHVlKTtcbiAgICAgIHZhciB3aW5uaW5nUmV2ID0gbWV0YWRhdGEud2lubmluZ1JldjtcblxuICAgICAgYWxsRG9jc0lubmVyKGN1cnNvciwgd2lubmluZ1JldiwgbWV0YWRhdGEpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIG9uUmVzdWx0c1JlYWR5KCkge1xuICAgICAgY2FsbGJhY2sobnVsbCwge1xuICAgICAgICB0b3RhbF9yb3dzOiBkb2NDb3VudCxcbiAgICAgICAgb2Zmc2V0OiBvcHRzLnNraXAsXG4gICAgICAgIHJvd3M6IHJlc3VsdHNcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIG9uVHhuQ29tcGxldGUoKSB7XG4gICAgICBpZiAob3B0cy5hdHRhY2htZW50cykge1xuICAgICAgICBwb3N0UHJvY2Vzc0F0dGFjaG1lbnRzKHJlc3VsdHMpLnRoZW4ob25SZXN1bHRzUmVhZHkpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgb25SZXN1bHRzUmVhZHkoKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0eG4ub25jb21wbGV0ZSA9IG9uVHhuQ29tcGxldGU7XG4gICAgY3Vyc29yLm9uc3VjY2VzcyA9IG9uR2V0Q3Vyc29yO1xuICB9XG5cbiAgZnVuY3Rpb24gYWxsRG9jcyhvcHRzLCBjYWxsYmFjaykge1xuXG4gICAgaWYgKG9wdHMubGltaXQgPT09IDApIHtcbiAgICAgIHJldHVybiBjYWxsYmFjayhudWxsLCB7XG4gICAgICAgIHRvdGFsX3Jvd3M6IGFwaS5fbWV0YS5kb2NDb3VudCxcbiAgICAgICAgb2Zmc2V0OiBvcHRzLnNraXAsXG4gICAgICAgIHJvd3M6IFtdXG4gICAgICB9KTtcbiAgICB9XG4gICAgYWxsRG9jc1F1ZXJ5KG9wdHMsIGNhbGxiYWNrKTtcbiAgfVxuXG4gIGFsbERvY3Mob3B0cywgY2FsbGJhY2spO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGlkYkFsbERvY3M7IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuLi8uLi91dGlscycpO1xudmFyIGlkYkNvbnN0YW50cyA9IHJlcXVpcmUoJy4vaWRiLWNvbnN0YW50cycpO1xudmFyIERFVEVDVF9CTE9CX1NVUFBPUlRfU1RPUkUgPSBpZGJDb25zdGFudHMuREVURUNUX0JMT0JfU1VQUE9SVF9TVE9SRTtcblxuLy9cbi8vIERldGVjdCBibG9iIHN1cHBvcnQuIENocm9tZSBkaWRuJ3Qgc3VwcG9ydCBpdCB1bnRpbCB2ZXJzaW9uIDM4LlxuLy8gSW4gdmVyc2lvbiAzNyB0aGV5IGhhZCBhIGJyb2tlbiB2ZXJzaW9uIHdoZXJlIFBOR3MgKGFuZCBwb3NzaWJseVxuLy8gb3RoZXIgYmluYXJ5IHR5cGVzKSBhcmVuJ3Qgc3RvcmVkIGNvcnJlY3RseSwgYmVjYXVzZSB3aGVuIHlvdSBmZXRjaFxuLy8gdGhlbSwgdGhlIGNvbnRlbnQgdHlwZSBpcyBhbHdheXMgbnVsbC5cbi8vXG4vLyBGdXJ0aGVybW9yZSwgdGhleSBoYXZlIHNvbWUgb3V0c3RhbmRpbmcgYnVncyB3aGVyZSBibG9icyBvY2Nhc2lvbmFsbHlcbi8vIGFyZSByZWFkIGJ5IEZpbGVSZWFkZXIgYXMgbnVsbCwgb3IgYnkgYWpheCBhcyA0MDRzLlxuLy9cbi8vIFNhZGx5IHdlIHVzZSB0aGUgNDA0IGJ1ZyB0byBkZXRlY3QgdGhlIEZpbGVSZWFkZXIgYnVnLCBzbyBpZiB0aGV5XG4vLyBnZXQgZml4ZWQgaW5kZXBlbmRlbnRseSBhbmQgcmVsZWFzZWQgaW4gZGlmZmVyZW50IHZlcnNpb25zIG9mIENocm9tZSxcbi8vIHRoZW4gdGhlIGJ1ZyBjb3VsZCBjb21lIGJhY2suIFNvIGl0J3Mgd29ydGh3aGlsZSB0byB3YXRjaCB0aGVzZSBpc3N1ZXM6XG4vLyA0MDQgYnVnOiBodHRwczovL2NvZGUuZ29vZ2xlLmNvbS9wL2Nocm9taXVtL2lzc3Vlcy9kZXRhaWw/aWQ9NDQ3OTE2XG4vLyBGaWxlUmVhZGVyIGJ1ZzogaHR0cHM6Ly9jb2RlLmdvb2dsZS5jb20vcC9jaHJvbWl1bS9pc3N1ZXMvZGV0YWlsP2lkPTQ0NzgzNlxuLy9cbmZ1bmN0aW9uIGNoZWNrQmxvYlN1cHBvcnQodHhuLCBpZGIpIHtcbiAgcmV0dXJuIG5ldyB1dGlscy5Qcm9taXNlKGZ1bmN0aW9uIChyZXNvbHZlLCByZWplY3QpIHtcbiAgICB2YXIgYmxvYiA9IHV0aWxzLmNyZWF0ZUJsb2IoWycnXSwge3R5cGU6ICdpbWFnZS9wbmcnfSk7XG4gICAgdHhuLm9iamVjdFN0b3JlKERFVEVDVF9CTE9CX1NVUFBPUlRfU1RPUkUpLnB1dChibG9iLCAna2V5Jyk7XG4gICAgdHhuLm9uY29tcGxldGUgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAvLyBoYXZlIHRvIGRvIGl0IGluIGEgc2VwYXJhdGUgdHJhbnNhY3Rpb24sIGVsc2UgdGhlIGNvcnJlY3RcbiAgICAgIC8vIGNvbnRlbnQgdHlwZSBpcyBhbHdheXMgcmV0dXJuZWRcbiAgICAgIHZhciBibG9iVHhuID0gaWRiLnRyYW5zYWN0aW9uKFtERVRFQ1RfQkxPQl9TVVBQT1JUX1NUT1JFXSxcbiAgICAgICAgJ3JlYWR3cml0ZScpO1xuICAgICAgdmFyIGdldEJsb2JSZXEgPSBibG9iVHhuLm9iamVjdFN0b3JlKFxuICAgICAgICBERVRFQ1RfQkxPQl9TVVBQT1JUX1NUT1JFKS5nZXQoJ2tleScpO1xuICAgICAgZ2V0QmxvYlJlcS5vbmVycm9yID0gcmVqZWN0O1xuICAgICAgZ2V0QmxvYlJlcS5vbnN1Y2Nlc3MgPSBmdW5jdGlvbiAoZSkge1xuXG4gICAgICAgIHZhciBzdG9yZWRCbG9iID0gZS50YXJnZXQucmVzdWx0O1xuICAgICAgICB2YXIgdXJsID0gVVJMLmNyZWF0ZU9iamVjdFVSTChzdG9yZWRCbG9iKTtcblxuICAgICAgICB1dGlscy5hamF4KHtcbiAgICAgICAgICB1cmw6IHVybCxcbiAgICAgICAgICBjYWNoZTogdHJ1ZSxcbiAgICAgICAgICBiaW5hcnk6IHRydWVcbiAgICAgICAgfSwgZnVuY3Rpb24gKGVyciwgcmVzKSB7XG4gICAgICAgICAgaWYgKGVyciAmJiBlcnIuc3RhdHVzID09PSA0MDUpIHtcbiAgICAgICAgICAgIC8vIGZpcmVmb3ggd29uJ3QgbGV0IHVzIGRvIHRoYXQuIGJ1dCBmaXJlZm94IGRvZXNuJ3RcbiAgICAgICAgICAgIC8vIGhhdmUgdGhlIGJsb2IgdHlwZSBidWcgdGhhdCBDaHJvbWUgZG9lcywgc28gdGhhdCdzIG9rXG4gICAgICAgICAgICByZXNvbHZlKHRydWUpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByZXNvbHZlKCEhKHJlcyAmJiByZXMudHlwZSA9PT0gJ2ltYWdlL3BuZycpKTtcbiAgICAgICAgICAgIGlmIChlcnIgJiYgZXJyLnN0YXR1cyA9PT0gNDA0KSB7XG4gICAgICAgICAgICAgIHV0aWxzLmV4cGxhaW40MDQoJ1BvdWNoREIgaXMganVzdCBkZXRlY3RpbmcgYmxvYiBVUkwgc3VwcG9ydC4nKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgICAgVVJMLnJldm9rZU9iamVjdFVSTCh1cmwpO1xuICAgICAgICB9KTtcbiAgICAgIH07XG4gICAgfTtcbiAgfSlbXCJjYXRjaFwiXShmdW5jdGlvbiAoKSB7XG4gICAgcmV0dXJuIGZhbHNlOyAvLyBlcnJvciwgc28gYXNzdW1lIHVuc3VwcG9ydGVkXG4gIH0pO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGNoZWNrQmxvYlN1cHBvcnQ7IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuLi8uLi91dGlscycpO1xudmFyIGVycm9ycyA9IHJlcXVpcmUoJy4uLy4uL2RlcHMvZXJyb3JzJyk7XG52YXIgaWRiVXRpbHMgPSByZXF1aXJlKCcuL2lkYi11dGlscycpO1xudmFyIGlkYkNvbnN0YW50cyA9IHJlcXVpcmUoJy4vaWRiLWNvbnN0YW50cycpO1xuXG52YXIgQVRUQUNIX0FORF9TRVFfU1RPUkUgPSBpZGJDb25zdGFudHMuQVRUQUNIX0FORF9TRVFfU1RPUkU7XG52YXIgQVRUQUNIX1NUT1JFID0gaWRiQ29uc3RhbnRzLkFUVEFDSF9TVE9SRTtcbnZhciBCWV9TRVFfU1RPUkUgPSBpZGJDb25zdGFudHMuQllfU0VRX1NUT1JFO1xudmFyIERPQ19TVE9SRSA9IGlkYkNvbnN0YW50cy5ET0NfU1RPUkU7XG52YXIgTE9DQUxfU1RPUkUgPSBpZGJDb25zdGFudHMuTE9DQUxfU1RPUkU7XG52YXIgTUVUQV9TVE9SRSA9IGlkYkNvbnN0YW50cy5NRVRBX1NUT1JFO1xuXG52YXIgY29tcGFjdFJldnMgPSBpZGJVdGlscy5jb21wYWN0UmV2cztcbnZhciBkZWNvZGVNZXRhZGF0YSA9IGlkYlV0aWxzLmRlY29kZU1ldGFkYXRhO1xudmFyIGVuY29kZU1ldGFkYXRhID0gaWRiVXRpbHMuZW5jb2RlTWV0YWRhdGE7XG52YXIgaWRiRXJyb3IgPSBpZGJVdGlscy5pZGJFcnJvcjtcbnZhciBvcGVuVHJhbnNhY3Rpb25TYWZlbHkgPSBpZGJVdGlscy5vcGVuVHJhbnNhY3Rpb25TYWZlbHk7XG5cbmZ1bmN0aW9uIGlkYkJ1bGtEb2NzKHJlcSwgb3B0cywgYXBpLCBpZGIsIENoYW5nZXMsIGNhbGxiYWNrKSB7XG4gIHZhciBkb2NJbmZvcyA9IHJlcS5kb2NzO1xuICB2YXIgdHhuO1xuICB2YXIgZG9jU3RvcmU7XG4gIHZhciBieVNlcVN0b3JlO1xuICB2YXIgYXR0YWNoU3RvcmU7XG4gIHZhciBhdHRhY2hBbmRTZXFTdG9yZTtcbiAgdmFyIGRvY0luZm9FcnJvcjtcbiAgdmFyIGRvY0NvdW50RGVsdGEgPSAwO1xuXG4gIGZvciAodmFyIGkgPSAwLCBsZW4gPSBkb2NJbmZvcy5sZW5ndGg7IGkgPCBsZW47IGkrKykge1xuICAgIHZhciBkb2MgPSBkb2NJbmZvc1tpXTtcbiAgICBpZiAoZG9jLl9pZCAmJiB1dGlscy5pc0xvY2FsSWQoZG9jLl9pZCkpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBkb2MgPSBkb2NJbmZvc1tpXSA9IHV0aWxzLnBhcnNlRG9jKGRvYywgb3B0cy5uZXdfZWRpdHMpO1xuICAgIGlmIChkb2MuZXJyb3IgJiYgIWRvY0luZm9FcnJvcikge1xuICAgICAgZG9jSW5mb0Vycm9yID0gZG9jO1xuICAgIH1cbiAgfVxuXG4gIGlmIChkb2NJbmZvRXJyb3IpIHtcbiAgICByZXR1cm4gY2FsbGJhY2soZG9jSW5mb0Vycm9yKTtcbiAgfVxuXG4gIHZhciByZXN1bHRzID0gbmV3IEFycmF5KGRvY0luZm9zLmxlbmd0aCk7XG4gIHZhciBmZXRjaGVkRG9jcyA9IG5ldyB1dGlscy5NYXAoKTtcbiAgdmFyIHByZWNvbmRpdGlvbkVycm9yZWQgPSBmYWxzZTtcbiAgdmFyIGJsb2JUeXBlID0gYXBpLl9tZXRhLmJsb2JTdXBwb3J0ID8gJ2Jsb2InIDogJ2Jhc2U2NCc7XG5cbiAgdXRpbHMucHJlcHJvY2Vzc0F0dGFjaG1lbnRzKGRvY0luZm9zLCBibG9iVHlwZSwgZnVuY3Rpb24gKGVycikge1xuICAgIGlmIChlcnIpIHtcbiAgICAgIHJldHVybiBjYWxsYmFjayhlcnIpO1xuICAgIH1cbiAgICBzdGFydFRyYW5zYWN0aW9uKCk7XG4gIH0pO1xuXG4gIGZ1bmN0aW9uIHN0YXJ0VHJhbnNhY3Rpb24oKSB7XG5cbiAgICB2YXIgc3RvcmVzID0gW1xuICAgICAgRE9DX1NUT1JFLCBCWV9TRVFfU1RPUkUsXG4gICAgICBBVFRBQ0hfU1RPUkUsIE1FVEFfU1RPUkUsXG4gICAgICBMT0NBTF9TVE9SRSwgQVRUQUNIX0FORF9TRVFfU1RPUkVcbiAgICBdO1xuICAgIHZhciB0eG5SZXN1bHQgPSBvcGVuVHJhbnNhY3Rpb25TYWZlbHkoaWRiLCBzdG9yZXMsICdyZWFkd3JpdGUnKTtcbiAgICBpZiAodHhuUmVzdWx0LmVycm9yKSB7XG4gICAgICByZXR1cm4gY2FsbGJhY2sodHhuUmVzdWx0LmVycm9yKTtcbiAgICB9XG4gICAgdHhuID0gdHhuUmVzdWx0LnR4bjtcbiAgICB0eG4ub25lcnJvciA9IGlkYkVycm9yKGNhbGxiYWNrKTtcbiAgICB0eG4ub250aW1lb3V0ID0gaWRiRXJyb3IoY2FsbGJhY2spO1xuICAgIHR4bi5vbmNvbXBsZXRlID0gY29tcGxldGU7XG4gICAgZG9jU3RvcmUgPSB0eG4ub2JqZWN0U3RvcmUoRE9DX1NUT1JFKTtcbiAgICBieVNlcVN0b3JlID0gdHhuLm9iamVjdFN0b3JlKEJZX1NFUV9TVE9SRSk7XG4gICAgYXR0YWNoU3RvcmUgPSB0eG4ub2JqZWN0U3RvcmUoQVRUQUNIX1NUT1JFKTtcbiAgICBhdHRhY2hBbmRTZXFTdG9yZSA9IHR4bi5vYmplY3RTdG9yZShBVFRBQ0hfQU5EX1NFUV9TVE9SRSk7XG5cbiAgICB2ZXJpZnlBdHRhY2htZW50cyhmdW5jdGlvbiAoZXJyKSB7XG4gICAgICBpZiAoZXJyKSB7XG4gICAgICAgIHByZWNvbmRpdGlvbkVycm9yZWQgPSB0cnVlO1xuICAgICAgICByZXR1cm4gY2FsbGJhY2soZXJyKTtcbiAgICAgIH1cbiAgICAgIGZldGNoRXhpc3RpbmdEb2NzKCk7XG4gICAgfSk7XG4gIH1cblxuICBmdW5jdGlvbiBwcm9jZXNzRG9jcygpIHtcblxuICAgIHV0aWxzLnByb2Nlc3NEb2NzKGRvY0luZm9zLCBhcGksIGZldGNoZWREb2NzLCB0eG4sIHJlc3VsdHMsXG4gICAgICB3cml0ZURvYywgb3B0cyk7XG4gIH1cblxuICBmdW5jdGlvbiBmZXRjaEV4aXN0aW5nRG9jcygpIHtcblxuICAgIGlmICghZG9jSW5mb3MubGVuZ3RoKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdmFyIG51bUZldGNoZWQgPSAwO1xuXG4gICAgZnVuY3Rpb24gY2hlY2tEb25lKCkge1xuICAgICAgaWYgKCsrbnVtRmV0Y2hlZCA9PT0gZG9jSW5mb3MubGVuZ3RoKSB7XG4gICAgICAgIHByb2Nlc3NEb2NzKCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcmVhZE1ldGFkYXRhKGV2ZW50KSB7XG4gICAgICB2YXIgbWV0YWRhdGEgPSBkZWNvZGVNZXRhZGF0YShldmVudC50YXJnZXQucmVzdWx0KTtcblxuICAgICAgaWYgKG1ldGFkYXRhKSB7XG4gICAgICAgIGZldGNoZWREb2NzLnNldChtZXRhZGF0YS5pZCwgbWV0YWRhdGEpO1xuICAgICAgfVxuICAgICAgY2hlY2tEb25lKCk7XG4gICAgfVxuXG4gICAgZm9yICh2YXIgaSA9IDAsIGxlbiA9IGRvY0luZm9zLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgICB2YXIgZG9jSW5mbyA9IGRvY0luZm9zW2ldO1xuICAgICAgaWYgKGRvY0luZm8uX2lkICYmIHV0aWxzLmlzTG9jYWxJZChkb2NJbmZvLl9pZCkpIHtcbiAgICAgICAgY2hlY2tEb25lKCk7IC8vIHNraXAgbG9jYWwgZG9jc1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIHZhciByZXEgPSBkb2NTdG9yZS5nZXQoZG9jSW5mby5tZXRhZGF0YS5pZCk7XG4gICAgICByZXEub25zdWNjZXNzID0gcmVhZE1ldGFkYXRhO1xuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIGNvbXBsZXRlKCkge1xuICAgIGlmIChwcmVjb25kaXRpb25FcnJvcmVkKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgQ2hhbmdlcy5ub3RpZnkoYXBpLl9tZXRhLm5hbWUpO1xuICAgIGFwaS5fbWV0YS5kb2NDb3VudCArPSBkb2NDb3VudERlbHRhO1xuICAgIGNhbGxiYWNrKG51bGwsIHJlc3VsdHMpO1xuICB9XG5cbiAgZnVuY3Rpb24gdmVyaWZ5QXR0YWNobWVudChkaWdlc3QsIGNhbGxiYWNrKSB7XG5cbiAgICB2YXIgcmVxID0gYXR0YWNoU3RvcmUuZ2V0KGRpZ2VzdCk7XG4gICAgcmVxLm9uc3VjY2VzcyA9IGZ1bmN0aW9uIChlKSB7XG4gICAgICBpZiAoIWUudGFyZ2V0LnJlc3VsdCkge1xuICAgICAgICB2YXIgZXJyID0gZXJyb3JzLmVycm9yKGVycm9ycy5NSVNTSU5HX1NUVUIsXG4gICAgICAgICAgJ3Vua25vd24gc3R1YiBhdHRhY2htZW50IHdpdGggZGlnZXN0ICcgK1xuICAgICAgICAgIGRpZ2VzdCk7XG4gICAgICAgIGVyci5zdGF0dXMgPSA0MTI7XG4gICAgICAgIGNhbGxiYWNrKGVycik7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjYWxsYmFjaygpO1xuICAgICAgfVxuICAgIH07XG4gIH1cblxuICBmdW5jdGlvbiB2ZXJpZnlBdHRhY2htZW50cyhmaW5pc2gpIHtcblxuXG4gICAgdmFyIGRpZ2VzdHMgPSBbXTtcbiAgICBkb2NJbmZvcy5mb3JFYWNoKGZ1bmN0aW9uIChkb2NJbmZvKSB7XG4gICAgICBpZiAoZG9jSW5mby5kYXRhICYmIGRvY0luZm8uZGF0YS5fYXR0YWNobWVudHMpIHtcbiAgICAgICAgT2JqZWN0LmtleXMoZG9jSW5mby5kYXRhLl9hdHRhY2htZW50cykuZm9yRWFjaChmdW5jdGlvbiAoZmlsZW5hbWUpIHtcbiAgICAgICAgICB2YXIgYXR0ID0gZG9jSW5mby5kYXRhLl9hdHRhY2htZW50c1tmaWxlbmFtZV07XG4gICAgICAgICAgaWYgKGF0dC5zdHViKSB7XG4gICAgICAgICAgICBkaWdlc3RzLnB1c2goYXR0LmRpZ2VzdCk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICBpZiAoIWRpZ2VzdHMubGVuZ3RoKSB7XG4gICAgICByZXR1cm4gZmluaXNoKCk7XG4gICAgfVxuICAgIHZhciBudW1Eb25lID0gMDtcbiAgICB2YXIgZXJyO1xuXG4gICAgZnVuY3Rpb24gY2hlY2tEb25lKCkge1xuICAgICAgaWYgKCsrbnVtRG9uZSA9PT0gZGlnZXN0cy5sZW5ndGgpIHtcbiAgICAgICAgZmluaXNoKGVycik7XG4gICAgICB9XG4gICAgfVxuICAgIGRpZ2VzdHMuZm9yRWFjaChmdW5jdGlvbiAoZGlnZXN0KSB7XG4gICAgICB2ZXJpZnlBdHRhY2htZW50KGRpZ2VzdCwgZnVuY3Rpb24gKGF0dEVycikge1xuICAgICAgICBpZiAoYXR0RXJyICYmICFlcnIpIHtcbiAgICAgICAgICBlcnIgPSBhdHRFcnI7XG4gICAgICAgIH1cbiAgICAgICAgY2hlY2tEb25lKCk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHdyaXRlRG9jKGRvY0luZm8sIHdpbm5pbmdSZXYsIHdpbm5pbmdSZXZJc0RlbGV0ZWQsIG5ld1JldklzRGVsZXRlZCxcbiAgICAgICAgICAgICAgICAgICAgaXNVcGRhdGUsIGRlbHRhLCByZXN1bHRzSWR4LCBjYWxsYmFjaykge1xuXG4gICAgZG9jQ291bnREZWx0YSArPSBkZWx0YTtcblxuICAgIHZhciBkb2MgPSBkb2NJbmZvLmRhdGE7XG4gICAgZG9jLl9pZCA9IGRvY0luZm8ubWV0YWRhdGEuaWQ7XG4gICAgZG9jLl9yZXYgPSBkb2NJbmZvLm1ldGFkYXRhLnJldjtcblxuICAgIGlmIChuZXdSZXZJc0RlbGV0ZWQpIHtcbiAgICAgIGRvYy5fZGVsZXRlZCA9IHRydWU7XG4gICAgfVxuXG4gICAgdmFyIGhhc0F0dGFjaG1lbnRzID0gZG9jLl9hdHRhY2htZW50cyAmJlxuICAgICAgT2JqZWN0LmtleXMoZG9jLl9hdHRhY2htZW50cykubGVuZ3RoO1xuICAgIGlmIChoYXNBdHRhY2htZW50cykge1xuICAgICAgcmV0dXJuIHdyaXRlQXR0YWNobWVudHMoZG9jSW5mbywgd2lubmluZ1Jldiwgd2lubmluZ1JldklzRGVsZXRlZCxcbiAgICAgICAgaXNVcGRhdGUsIHJlc3VsdHNJZHgsIGNhbGxiYWNrKTtcbiAgICB9XG5cbiAgICBmaW5pc2hEb2MoZG9jSW5mbywgd2lubmluZ1Jldiwgd2lubmluZ1JldklzRGVsZXRlZCxcbiAgICAgIGlzVXBkYXRlLCByZXN1bHRzSWR4LCBjYWxsYmFjayk7XG4gIH1cblxuICBmdW5jdGlvbiBhdXRvQ29tcGFjdChkb2NJbmZvKSB7XG5cbiAgICB2YXIgcmV2c1RvRGVsZXRlID0gdXRpbHMuY29tcGFjdFRyZWUoZG9jSW5mby5tZXRhZGF0YSk7XG4gICAgY29tcGFjdFJldnMocmV2c1RvRGVsZXRlLCBkb2NJbmZvLm1ldGFkYXRhLmlkLCB0eG4pO1xuICB9XG5cbiAgZnVuY3Rpb24gZmluaXNoRG9jKGRvY0luZm8sIHdpbm5pbmdSZXYsIHdpbm5pbmdSZXZJc0RlbGV0ZWQsXG4gICAgICAgICAgICAgICAgICAgICBpc1VwZGF0ZSwgcmVzdWx0c0lkeCwgY2FsbGJhY2spIHtcblxuICAgIHZhciBkb2MgPSBkb2NJbmZvLmRhdGE7XG4gICAgdmFyIG1ldGFkYXRhID0gZG9jSW5mby5tZXRhZGF0YTtcblxuICAgIGRvYy5fZG9jX2lkX3JldiA9IG1ldGFkYXRhLmlkICsgJzo6JyArIG1ldGFkYXRhLnJldjtcbiAgICBkZWxldGUgZG9jLl9pZDtcbiAgICBkZWxldGUgZG9jLl9yZXY7XG5cbiAgICBmdW5jdGlvbiBhZnRlclB1dERvYyhlKSB7XG4gICAgICBpZiAoaXNVcGRhdGUgJiYgYXBpLmF1dG9fY29tcGFjdGlvbikge1xuICAgICAgICBhdXRvQ29tcGFjdChkb2NJbmZvKTtcbiAgICAgIH1cbiAgICAgIG1ldGFkYXRhLnNlcSA9IGUudGFyZ2V0LnJlc3VsdDtcbiAgICAgIC8vIEN1cnJlbnQgX3JldiBpcyBjYWxjdWxhdGVkIGZyb20gX3Jldl90cmVlIG9uIHJlYWRcbiAgICAgIGRlbGV0ZSBtZXRhZGF0YS5yZXY7XG4gICAgICB2YXIgbWV0YWRhdGFUb1N0b3JlID0gZW5jb2RlTWV0YWRhdGEobWV0YWRhdGEsIHdpbm5pbmdSZXYsXG4gICAgICAgIHdpbm5pbmdSZXZJc0RlbGV0ZWQpO1xuICAgICAgdmFyIG1ldGFEYXRhUmVxID0gZG9jU3RvcmUucHV0KG1ldGFkYXRhVG9TdG9yZSk7XG4gICAgICBtZXRhRGF0YVJlcS5vbnN1Y2Nlc3MgPSBhZnRlclB1dE1ldGFkYXRhO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGFmdGVyUHV0RG9jRXJyb3IoZSkge1xuICAgICAgLy8gQ29uc3RyYWludEVycm9yLCBuZWVkIHRvIHVwZGF0ZSwgbm90IHB1dCAoc2VlICMxNjM4IGZvciBkZXRhaWxzKVxuICAgICAgZS5wcmV2ZW50RGVmYXVsdCgpOyAvLyBhdm9pZCB0cmFuc2FjdGlvbiBhYm9ydFxuICAgICAgZS5zdG9wUHJvcGFnYXRpb24oKTsgLy8gYXZvaWQgdHJhbnNhY3Rpb24gb25lcnJvclxuICAgICAgdmFyIGluZGV4ID0gYnlTZXFTdG9yZS5pbmRleCgnX2RvY19pZF9yZXYnKTtcbiAgICAgIHZhciBnZXRLZXlSZXEgPSBpbmRleC5nZXRLZXkoZG9jLl9kb2NfaWRfcmV2KTtcbiAgICAgIGdldEtleVJlcS5vbnN1Y2Nlc3MgPSBmdW5jdGlvbiAoZSkge1xuICAgICAgICB2YXIgcHV0UmVxID0gYnlTZXFTdG9yZS5wdXQoZG9jLCBlLnRhcmdldC5yZXN1bHQpO1xuICAgICAgICBwdXRSZXEub25zdWNjZXNzID0gYWZ0ZXJQdXREb2M7XG4gICAgICB9O1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGFmdGVyUHV0TWV0YWRhdGEoKSB7XG4gICAgICByZXN1bHRzW3Jlc3VsdHNJZHhdID0ge1xuICAgICAgICBvazogdHJ1ZSxcbiAgICAgICAgaWQ6IG1ldGFkYXRhLmlkLFxuICAgICAgICByZXY6IHdpbm5pbmdSZXZcbiAgICAgIH07XG4gICAgICBmZXRjaGVkRG9jcy5zZXQoZG9jSW5mby5tZXRhZGF0YS5pZCwgZG9jSW5mby5tZXRhZGF0YSk7XG4gICAgICBpbnNlcnRBdHRhY2htZW50TWFwcGluZ3MoZG9jSW5mbywgbWV0YWRhdGEuc2VxLCBjYWxsYmFjayk7XG4gICAgfVxuXG4gICAgdmFyIHB1dFJlcSA9IGJ5U2VxU3RvcmUucHV0KGRvYyk7XG5cbiAgICBwdXRSZXEub25zdWNjZXNzID0gYWZ0ZXJQdXREb2M7XG4gICAgcHV0UmVxLm9uZXJyb3IgPSBhZnRlclB1dERvY0Vycm9yO1xuICB9XG5cbiAgZnVuY3Rpb24gd3JpdGVBdHRhY2htZW50cyhkb2NJbmZvLCB3aW5uaW5nUmV2LCB3aW5uaW5nUmV2SXNEZWxldGVkLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlzVXBkYXRlLCByZXN1bHRzSWR4LCBjYWxsYmFjaykge1xuXG5cbiAgICB2YXIgZG9jID0gZG9jSW5mby5kYXRhO1xuXG4gICAgdmFyIG51bURvbmUgPSAwO1xuICAgIHZhciBhdHRhY2htZW50cyA9IE9iamVjdC5rZXlzKGRvYy5fYXR0YWNobWVudHMpO1xuXG4gICAgZnVuY3Rpb24gY29sbGVjdFJlc3VsdHMoKSB7XG4gICAgICBpZiAobnVtRG9uZSA9PT0gYXR0YWNobWVudHMubGVuZ3RoKSB7XG4gICAgICAgIGZpbmlzaERvYyhkb2NJbmZvLCB3aW5uaW5nUmV2LCB3aW5uaW5nUmV2SXNEZWxldGVkLFxuICAgICAgICAgIGlzVXBkYXRlLCByZXN1bHRzSWR4LCBjYWxsYmFjayk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gYXR0YWNobWVudFNhdmVkKCkge1xuICAgICAgbnVtRG9uZSsrO1xuICAgICAgY29sbGVjdFJlc3VsdHMoKTtcbiAgICB9XG5cbiAgICBhdHRhY2htZW50cy5mb3JFYWNoKGZ1bmN0aW9uIChrZXkpIHtcbiAgICAgIHZhciBhdHQgPSBkb2NJbmZvLmRhdGEuX2F0dGFjaG1lbnRzW2tleV07XG4gICAgICBpZiAoIWF0dC5zdHViKSB7XG4gICAgICAgIHZhciBkYXRhID0gYXR0LmRhdGE7XG4gICAgICAgIGRlbGV0ZSBhdHQuZGF0YTtcbiAgICAgICAgdmFyIGRpZ2VzdCA9IGF0dC5kaWdlc3Q7XG4gICAgICAgIHNhdmVBdHRhY2htZW50KGRpZ2VzdCwgZGF0YSwgYXR0YWNobWVudFNhdmVkKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG51bURvbmUrKztcbiAgICAgICAgY29sbGVjdFJlc3VsdHMoKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIC8vIG1hcCBzZXFzIHRvIGF0dGFjaG1lbnQgZGlnZXN0cywgd2hpY2hcbiAgLy8gd2Ugd2lsbCBuZWVkIGxhdGVyIGR1cmluZyBjb21wYWN0aW9uXG4gIGZ1bmN0aW9uIGluc2VydEF0dGFjaG1lbnRNYXBwaW5ncyhkb2NJbmZvLCBzZXEsIGNhbGxiYWNrKSB7XG5cbiAgICB2YXIgYXR0c0FkZGVkID0gMDtcbiAgICB2YXIgYXR0c1RvQWRkID0gT2JqZWN0LmtleXMoZG9jSW5mby5kYXRhLl9hdHRhY2htZW50cyB8fCB7fSk7XG5cbiAgICBpZiAoIWF0dHNUb0FkZC5sZW5ndGgpIHtcbiAgICAgIHJldHVybiBjYWxsYmFjaygpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGNoZWNrRG9uZSgpIHtcbiAgICAgIGlmICgrK2F0dHNBZGRlZCA9PT0gYXR0c1RvQWRkLmxlbmd0aCkge1xuICAgICAgICBjYWxsYmFjaygpO1xuICAgICAgfVxuICAgIH1cblxuICAgIGZ1bmN0aW9uIGFkZChhdHQpIHtcbiAgICAgIHZhciBkaWdlc3QgPSBkb2NJbmZvLmRhdGEuX2F0dGFjaG1lbnRzW2F0dF0uZGlnZXN0O1xuICAgICAgdmFyIHJlcSA9IGF0dGFjaEFuZFNlcVN0b3JlLnB1dCh7XG4gICAgICAgIHNlcTogc2VxLFxuICAgICAgICBkaWdlc3RTZXE6IGRpZ2VzdCArICc6OicgKyBzZXFcbiAgICAgIH0pO1xuXG4gICAgICByZXEub25zdWNjZXNzID0gY2hlY2tEb25lO1xuICAgICAgcmVxLm9uZXJyb3IgPSBmdW5jdGlvbiAoZSkge1xuICAgICAgICAvLyB0aGlzIGNhbGxiYWNrIGlzIGZvciBhIGNvbnN0YWludCBlcnJvciwgd2hpY2ggd2UgaWdub3JlXG4gICAgICAgIC8vIGJlY2F1c2UgdGhpcyBkb2NpZC9yZXYgaGFzIGFscmVhZHkgYmVlbiBhc3NvY2lhdGVkIHdpdGhcbiAgICAgICAgLy8gdGhlIGRpZ2VzdCAoZS5nLiB3aGVuIG5ld19lZGl0cyA9PSBmYWxzZSlcbiAgICAgICAgZS5wcmV2ZW50RGVmYXVsdCgpOyAvLyBhdm9pZCB0cmFuc2FjdGlvbiBhYm9ydFxuICAgICAgICBlLnN0b3BQcm9wYWdhdGlvbigpOyAvLyBhdm9pZCB0cmFuc2FjdGlvbiBvbmVycm9yXG4gICAgICAgIGNoZWNrRG9uZSgpO1xuICAgICAgfTtcbiAgICB9XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBhdHRzVG9BZGQubGVuZ3RoOyBpKyspIHtcbiAgICAgIGFkZChhdHRzVG9BZGRbaV0pOyAvLyBkbyBpbiBwYXJhbGxlbFxuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIHNhdmVBdHRhY2htZW50KGRpZ2VzdCwgZGF0YSwgY2FsbGJhY2spIHtcblxuXG4gICAgdmFyIGdldEtleVJlcSA9IGF0dGFjaFN0b3JlLmNvdW50KGRpZ2VzdCk7XG4gICAgZ2V0S2V5UmVxLm9uc3VjY2VzcyA9IGZ1bmN0aW9uKGUpIHtcbiAgICAgIHZhciBjb3VudCA9IGUudGFyZ2V0LnJlc3VsdDtcbiAgICAgIGlmIChjb3VudCkge1xuICAgICAgICByZXR1cm4gY2FsbGJhY2soKTsgLy8gYWxyZWFkeSBleGlzdHNcbiAgICAgIH1cbiAgICAgIHZhciBuZXdBdHQgPSB7XG4gICAgICAgIGRpZ2VzdDogZGlnZXN0LFxuICAgICAgICBib2R5OiBkYXRhXG4gICAgICB9O1xuICAgICAgdmFyIHB1dFJlcSA9IGF0dGFjaFN0b3JlLnB1dChuZXdBdHQpO1xuICAgICAgcHV0UmVxLm9uc3VjY2VzcyA9IGNhbGxiYWNrO1xuICAgIH07XG4gIH1cbn1cblxubW9kdWxlLmV4cG9ydHMgPSBpZGJCdWxrRG9jczsiLCIndXNlIHN0cmljdCc7XG5cbi8vIEluZGV4ZWREQiByZXF1aXJlcyBhIHZlcnNpb25lZCBkYXRhYmFzZSBzdHJ1Y3R1cmUsIHNvIHdlIHVzZSB0aGVcbi8vIHZlcnNpb24gaGVyZSB0byBtYW5hZ2UgbWlncmF0aW9ucy5cbmV4cG9ydHMuQURBUFRFUl9WRVJTSU9OID0gNTtcblxuLy8gVGhlIG9iamVjdCBzdG9yZXMgY3JlYXRlZCBmb3IgZWFjaCBkYXRhYmFzZVxuLy8gRE9DX1NUT1JFIHN0b3JlcyB0aGUgZG9jdW1lbnQgbWV0YSBkYXRhLCBpdHMgcmV2aXNpb24gaGlzdG9yeSBhbmQgc3RhdGVcbi8vIEtleWVkIGJ5IGRvY3VtZW50IGlkXG5leHBvcnRzLiBET0NfU1RPUkUgPSAnZG9jdW1lbnQtc3RvcmUnO1xuLy8gQllfU0VRX1NUT1JFIHN0b3JlcyBhIHBhcnRpY3VsYXIgdmVyc2lvbiBvZiBhIGRvY3VtZW50LCBrZXllZCBieSBpdHNcbi8vIHNlcXVlbmNlIGlkXG5leHBvcnRzLkJZX1NFUV9TVE9SRSA9ICdieS1zZXF1ZW5jZSc7XG4vLyBXaGVyZSB3ZSBzdG9yZSBhdHRhY2htZW50c1xuZXhwb3J0cy5BVFRBQ0hfU1RPUkUgPSAnYXR0YWNoLXN0b3JlJztcbi8vIFdoZXJlIHdlIHN0b3JlIG1hbnktdG8tbWFueSByZWxhdGlvbnNcbi8vIGJldHdlZW4gYXR0YWNobWVudCBkaWdlc3RzIGFuZCBzZXFzXG5leHBvcnRzLkFUVEFDSF9BTkRfU0VRX1NUT1JFID0gJ2F0dGFjaC1zZXEtc3RvcmUnO1xuXG4vLyBXaGVyZSB3ZSBzdG9yZSBkYXRhYmFzZS13aWRlIG1ldGEgZGF0YSBpbiBhIHNpbmdsZSByZWNvcmRcbi8vIGtleWVkIGJ5IGlkOiBNRVRBX1NUT1JFXG5leHBvcnRzLk1FVEFfU1RPUkUgPSAnbWV0YS1zdG9yZSc7XG4vLyBXaGVyZSB3ZSBzdG9yZSBsb2NhbCBkb2N1bWVudHNcbmV4cG9ydHMuTE9DQUxfU1RPUkUgPSAnbG9jYWwtc3RvcmUnO1xuLy8gV2hlcmUgd2UgZGV0ZWN0IGJsb2Igc3VwcG9ydFxuZXhwb3J0cy5ERVRFQ1RfQkxPQl9TVVBQT1JUX1NUT1JFID0gJ2RldGVjdC1ibG9iLXN1cHBvcnQnOyIsIid1c2Ugc3RyaWN0JztcblxudmFyIGVycm9ycyA9IHJlcXVpcmUoJy4uLy4uL2RlcHMvZXJyb3JzJyk7XG52YXIgdXRpbHMgPSByZXF1aXJlKCcuLi8uLi91dGlscycpO1xudmFyIGNvbnN0YW50cyA9IHJlcXVpcmUoJy4vaWRiLWNvbnN0YW50cycpO1xuXG5mdW5jdGlvbiB0cnlDb2RlKGZ1biwgdGhhdCwgYXJncykge1xuICB0cnkge1xuICAgIGZ1bi5hcHBseSh0aGF0LCBhcmdzKTtcbiAgfSBjYXRjaCAoZXJyKSB7IC8vIHNob3VsZG4ndCBoYXBwZW5cbiAgICBpZiAodHlwZW9mIFBvdWNoREIgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICBQb3VjaERCLmVtaXQoJ2Vycm9yJywgZXJyKTtcbiAgICB9XG4gIH1cbn1cblxuZXhwb3J0cy50YXNrUXVldWUgPSB7XG4gIHJ1bm5pbmc6IGZhbHNlLFxuICBxdWV1ZTogW11cbn07XG5cbmV4cG9ydHMuYXBwbHlOZXh0ID0gZnVuY3Rpb24gKCkge1xuICBpZiAoZXhwb3J0cy50YXNrUXVldWUucnVubmluZyB8fCAhZXhwb3J0cy50YXNrUXVldWUucXVldWUubGVuZ3RoKSB7XG4gICAgcmV0dXJuO1xuICB9XG4gIGV4cG9ydHMudGFza1F1ZXVlLnJ1bm5pbmcgPSB0cnVlO1xuICB2YXIgaXRlbSA9IGV4cG9ydHMudGFza1F1ZXVlLnF1ZXVlLnNoaWZ0KCk7XG4gIGl0ZW0uYWN0aW9uKGZ1bmN0aW9uIChlcnIsIHJlcykge1xuICAgIHRyeUNvZGUoaXRlbS5jYWxsYmFjaywgdGhpcywgW2VyciwgcmVzXSk7XG4gICAgZXhwb3J0cy50YXNrUXVldWUucnVubmluZyA9IGZhbHNlO1xuICAgIHByb2Nlc3MubmV4dFRpY2soZXhwb3J0cy5hcHBseU5leHQpO1xuICB9KTtcbn07XG5cbmV4cG9ydHMuaWRiRXJyb3IgPSBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgcmV0dXJuIGZ1bmN0aW9uIChldmVudCkge1xuICAgIHZhciBtZXNzYWdlID0gKGV2ZW50LnRhcmdldCAmJiBldmVudC50YXJnZXQuZXJyb3IgJiZcbiAgICAgIGV2ZW50LnRhcmdldC5lcnJvci5uYW1lKSB8fCBldmVudC50YXJnZXQ7XG4gICAgY2FsbGJhY2soZXJyb3JzLmVycm9yKGVycm9ycy5JREJfRVJST1IsIG1lc3NhZ2UsIGV2ZW50LnR5cGUpKTtcbiAgfTtcbn07XG5cbi8vIFVuZm9ydHVuYXRlbHksIHRoZSBtZXRhZGF0YSBoYXMgdG8gYmUgc3RyaW5naWZpZWRcbi8vIHdoZW4gaXQgaXMgcHV0IGludG8gdGhlIGRhdGFiYXNlLCBiZWNhdXNlIG90aGVyd2lzZVxuLy8gSW5kZXhlZERCIGNhbiB0aHJvdyBlcnJvcnMgZm9yIGRlZXBseS1uZXN0ZWQgb2JqZWN0cy5cbi8vIE9yaWdpbmFsbHkgd2UganVzdCB1c2VkIEpTT04ucGFyc2UvSlNPTi5zdHJpbmdpZnk7IG5vd1xuLy8gd2UgdXNlIHRoaXMgY3VzdG9tIHZ1dnV6ZWxhIGxpYnJhcnkgdGhhdCBhdm9pZHMgcmVjdXJzaW9uLlxuLy8gSWYgd2UgY291bGQgZG8gaXQgYWxsIG92ZXIgYWdhaW4sIHdlJ2QgcHJvYmFibHkgdXNlIGFcbi8vIGZvcm1hdCBmb3IgdGhlIHJldmlzaW9uIHRyZWVzIG90aGVyIHRoYW4gSlNPTi5cbmV4cG9ydHMuZW5jb2RlTWV0YWRhdGEgPSBmdW5jdGlvbiAobWV0YWRhdGEsIHdpbm5pbmdSZXYsIGRlbGV0ZWQpIHtcbiAgcmV0dXJuIHtcbiAgICBkYXRhOiB1dGlscy5zYWZlSnNvblN0cmluZ2lmeShtZXRhZGF0YSksXG4gICAgd2lubmluZ1Jldjogd2lubmluZ1JldixcbiAgICBkZWxldGVkT3JMb2NhbDogZGVsZXRlZCA/ICcxJyA6ICcwJyxcbiAgICBzZXE6IG1ldGFkYXRhLnNlcSwgLy8gaGlnaGVzdCBzZXEgZm9yIHRoaXMgZG9jXG4gICAgaWQ6IG1ldGFkYXRhLmlkXG4gIH07XG59O1xuXG5leHBvcnRzLmRlY29kZU1ldGFkYXRhID0gZnVuY3Rpb24gKHN0b3JlZE9iamVjdCkge1xuICBpZiAoIXN0b3JlZE9iamVjdCkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG4gIHZhciBtZXRhZGF0YSA9IHV0aWxzLnNhZmVKc29uUGFyc2Uoc3RvcmVkT2JqZWN0LmRhdGEpO1xuICBtZXRhZGF0YS53aW5uaW5nUmV2ID0gc3RvcmVkT2JqZWN0Lndpbm5pbmdSZXY7XG4gIG1ldGFkYXRhLmRlbGV0ZWQgPSBzdG9yZWRPYmplY3QuZGVsZXRlZE9yTG9jYWwgPT09ICcxJztcbiAgbWV0YWRhdGEuc2VxID0gc3RvcmVkT2JqZWN0LnNlcTtcbiAgcmV0dXJuIG1ldGFkYXRhO1xufTtcblxuLy8gcmVhZCB0aGUgZG9jIGJhY2sgb3V0IGZyb20gdGhlIGRhdGFiYXNlLiB3ZSBkb24ndCBzdG9yZSB0aGVcbi8vIF9pZCBvciBfcmV2IGJlY2F1c2Ugd2UgYWxyZWFkeSBoYXZlIF9kb2NfaWRfcmV2LlxuZXhwb3J0cy5kZWNvZGVEb2MgPSBmdW5jdGlvbiAoZG9jKSB7XG4gIGlmICghZG9jKSB7XG4gICAgcmV0dXJuIGRvYztcbiAgfVxuICB2YXIgaWR4ID0gdXRpbHMubGFzdEluZGV4T2YoZG9jLl9kb2NfaWRfcmV2LCAnOicpO1xuICBkb2MuX2lkID0gZG9jLl9kb2NfaWRfcmV2LnN1YnN0cmluZygwLCBpZHggLSAxKTtcbiAgZG9jLl9yZXYgPSBkb2MuX2RvY19pZF9yZXYuc3Vic3RyaW5nKGlkeCArIDEpO1xuICBkZWxldGUgZG9jLl9kb2NfaWRfcmV2O1xuICByZXR1cm4gZG9jO1xufTtcblxuLy8gUmVhZCBhIGJsb2IgZnJvbSB0aGUgZGF0YWJhc2UsIGVuY29kaW5nIGFzIG5lY2Vzc2FyeVxuLy8gYW5kIHRyYW5zbGF0aW5nIGZyb20gYmFzZTY0IGlmIHRoZSBJREIgZG9lc24ndCBzdXBwb3J0XG4vLyBuYXRpdmUgQmxvYnNcbmV4cG9ydHMucmVhZEJsb2JEYXRhID0gZnVuY3Rpb24gKGJvZHksIHR5cGUsIGVuY29kZSwgY2FsbGJhY2spIHtcbiAgaWYgKGVuY29kZSkge1xuICAgIGlmICghYm9keSkge1xuICAgICAgY2FsbGJhY2soJycpO1xuICAgIH0gZWxzZSBpZiAodHlwZW9mIGJvZHkgIT09ICdzdHJpbmcnKSB7IC8vIHdlIGhhdmUgYmxvYiBzdXBwb3J0XG4gICAgICB1dGlscy5yZWFkQXNCaW5hcnlTdHJpbmcoYm9keSwgZnVuY3Rpb24gKGJpbmFyeSkge1xuICAgICAgICBjYWxsYmFjayh1dGlscy5idG9hKGJpbmFyeSkpO1xuICAgICAgfSk7XG4gICAgfSBlbHNlIHsgLy8gbm8gYmxvYiBzdXBwb3J0XG4gICAgICBjYWxsYmFjayhib2R5KTtcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgaWYgKCFib2R5KSB7XG4gICAgICBjYWxsYmFjayh1dGlscy5jcmVhdGVCbG9iKFsnJ10sIHt0eXBlOiB0eXBlfSkpO1xuICAgIH0gZWxzZSBpZiAodHlwZW9mIGJvZHkgIT09ICdzdHJpbmcnKSB7IC8vIHdlIGhhdmUgYmxvYiBzdXBwb3J0XG4gICAgICBjYWxsYmFjayhib2R5KTtcbiAgICB9IGVsc2UgeyAvLyBubyBibG9iIHN1cHBvcnRcbiAgICAgIGJvZHkgPSB1dGlscy5maXhCaW5hcnkoYXRvYihib2R5KSk7XG4gICAgICBjYWxsYmFjayh1dGlscy5jcmVhdGVCbG9iKFtib2R5XSwge3R5cGU6IHR5cGV9KSk7XG4gICAgfVxuICB9XG59O1xuXG5leHBvcnRzLmZldGNoQXR0YWNobWVudHNJZk5lY2Vzc2FyeSA9IGZ1bmN0aW9uIChkb2MsIG9wdHMsIHR4biwgY2IpIHtcbiAgdmFyIGF0dGFjaG1lbnRzID0gT2JqZWN0LmtleXMoZG9jLl9hdHRhY2htZW50cyB8fCB7fSk7XG4gIGlmICghYXR0YWNobWVudHMubGVuZ3RoKSB7XG4gICAgcmV0dXJuIGNiICYmIGNiKCk7XG4gIH1cbiAgdmFyIG51bURvbmUgPSAwO1xuXG4gIGZ1bmN0aW9uIGNoZWNrRG9uZSgpIHtcbiAgICBpZiAoKytudW1Eb25lID09PSBhdHRhY2htZW50cy5sZW5ndGggJiYgY2IpIHtcbiAgICAgIGNiKCk7XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gZmV0Y2hBdHRhY2htZW50KGRvYywgYXR0KSB7XG4gICAgdmFyIGF0dE9iaiA9IGRvYy5fYXR0YWNobWVudHNbYXR0XTtcbiAgICB2YXIgZGlnZXN0ID0gYXR0T2JqLmRpZ2VzdDtcbiAgICB2YXIgcmVxID0gdHhuLm9iamVjdFN0b3JlKGNvbnN0YW50cy5BVFRBQ0hfU1RPUkUpLmdldChkaWdlc3QpO1xuICAgIHJlcS5vbnN1Y2Nlc3MgPSBmdW5jdGlvbiAoZSkge1xuICAgICAgYXR0T2JqLmJvZHkgPSBlLnRhcmdldC5yZXN1bHQuYm9keTtcbiAgICAgIGNoZWNrRG9uZSgpO1xuICAgIH07XG4gIH1cblxuICBhdHRhY2htZW50cy5mb3JFYWNoKGZ1bmN0aW9uIChhdHQpIHtcbiAgICBpZiAob3B0cy5hdHRhY2htZW50cyAmJiBvcHRzLmluY2x1ZGVfZG9jcykge1xuICAgICAgZmV0Y2hBdHRhY2htZW50KGRvYywgYXR0KTtcbiAgICB9IGVsc2Uge1xuICAgICAgZG9jLl9hdHRhY2htZW50c1thdHRdLnN0dWIgPSB0cnVlO1xuICAgICAgY2hlY2tEb25lKCk7XG4gICAgfVxuICB9KTtcbn07XG5cbi8vIElEQi1zcGVjaWZpYyBwb3N0cHJvY2Vzc2luZyBuZWNlc3NhcnkgYmVjYXVzZVxuLy8gd2UgZG9uJ3Qga25vdyB3aGV0aGVyIHdlIHN0b3JlZCBhIHRydWUgQmxvYiBvclxuLy8gYSBiYXNlNjQtZW5jb2RlZCBzdHJpbmcsIGFuZCBpZiBpdCdzIGEgQmxvYiBpdFxuLy8gbmVlZHMgdG8gYmUgcmVhZCBvdXRzaWRlIG9mIHRoZSB0cmFuc2FjdGlvbiBjb250ZXh0XG5leHBvcnRzLnBvc3RQcm9jZXNzQXR0YWNobWVudHMgPSBmdW5jdGlvbiAocmVzdWx0cykge1xuICByZXR1cm4gdXRpbHMuUHJvbWlzZS5hbGwocmVzdWx0cy5tYXAoZnVuY3Rpb24gKHJvdykge1xuICAgIGlmIChyb3cuZG9jICYmIHJvdy5kb2MuX2F0dGFjaG1lbnRzKSB7XG4gICAgICB2YXIgYXR0TmFtZXMgPSBPYmplY3Qua2V5cyhyb3cuZG9jLl9hdHRhY2htZW50cyk7XG4gICAgICByZXR1cm4gdXRpbHMuUHJvbWlzZS5hbGwoYXR0TmFtZXMubWFwKGZ1bmN0aW9uIChhdHQpIHtcbiAgICAgICAgdmFyIGF0dE9iaiA9IHJvdy5kb2MuX2F0dGFjaG1lbnRzW2F0dF07XG4gICAgICAgIGlmICghKCdib2R5JyBpbiBhdHRPYmopKSB7IC8vIGFscmVhZHkgcHJvY2Vzc2VkXG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHZhciBib2R5ID0gYXR0T2JqLmJvZHk7XG4gICAgICAgIHZhciB0eXBlID0gYXR0T2JqLmNvbnRlbnRfdHlwZTtcbiAgICAgICAgcmV0dXJuIG5ldyB1dGlscy5Qcm9taXNlKGZ1bmN0aW9uIChyZXNvbHZlKSB7XG4gICAgICAgICAgZXhwb3J0cy5yZWFkQmxvYkRhdGEoYm9keSwgdHlwZSwgdHJ1ZSwgZnVuY3Rpb24gKGJhc2U2NCkge1xuICAgICAgICAgICAgcm93LmRvYy5fYXR0YWNobWVudHNbYXR0XSA9IHV0aWxzLmV4dGVuZChcbiAgICAgICAgICAgICAgdXRpbHMucGljayhhdHRPYmosIFsnZGlnZXN0JywgJ2NvbnRlbnRfdHlwZSddKSxcbiAgICAgICAgICAgICAge2RhdGE6IGJhc2U2NH1cbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICByZXNvbHZlKCk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgICAgfSkpO1xuICAgIH1cbiAgfSkpO1xufTtcblxuZXhwb3J0cy5jb21wYWN0UmV2cyA9IGZ1bmN0aW9uIChyZXZzLCBkb2NJZCwgdHhuKSB7XG5cbiAgdmFyIHBvc3NpYmx5T3JwaGFuZWREaWdlc3RzID0gW107XG4gIHZhciBzZXFTdG9yZSA9IHR4bi5vYmplY3RTdG9yZShjb25zdGFudHMuQllfU0VRX1NUT1JFKTtcbiAgdmFyIGF0dFN0b3JlID0gdHhuLm9iamVjdFN0b3JlKGNvbnN0YW50cy5BVFRBQ0hfU1RPUkUpO1xuICB2YXIgYXR0QW5kU2VxU3RvcmUgPSB0eG4ub2JqZWN0U3RvcmUoY29uc3RhbnRzLkFUVEFDSF9BTkRfU0VRX1NUT1JFKTtcbiAgdmFyIGNvdW50ID0gcmV2cy5sZW5ndGg7XG5cbiAgZnVuY3Rpb24gY2hlY2tEb25lKCkge1xuICAgIGNvdW50LS07XG4gICAgaWYgKCFjb3VudCkgeyAvLyBkb25lIHByb2Nlc3NpbmcgYWxsIHJldnNcbiAgICAgIGRlbGV0ZU9ycGhhbmVkQXR0YWNobWVudHMoKTtcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBkZWxldGVPcnBoYW5lZEF0dGFjaG1lbnRzKCkge1xuICAgIGlmICghcG9zc2libHlPcnBoYW5lZERpZ2VzdHMubGVuZ3RoKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHBvc3NpYmx5T3JwaGFuZWREaWdlc3RzLmZvckVhY2goZnVuY3Rpb24gKGRpZ2VzdCkge1xuICAgICAgdmFyIGNvdW50UmVxID0gYXR0QW5kU2VxU3RvcmUuaW5kZXgoJ2RpZ2VzdFNlcScpLmNvdW50KFxuICAgICAgICBJREJLZXlSYW5nZS5ib3VuZChcbiAgICAgICAgICBkaWdlc3QgKyAnOjonLCBkaWdlc3QgKyAnOjpcXHVmZmZmJywgZmFsc2UsIGZhbHNlKSk7XG4gICAgICBjb3VudFJlcS5vbnN1Y2Nlc3MgPSBmdW5jdGlvbiAoZSkge1xuICAgICAgICB2YXIgY291bnQgPSBlLnRhcmdldC5yZXN1bHQ7XG4gICAgICAgIGlmICghY291bnQpIHtcbiAgICAgICAgICAvLyBvcnBoYW5lZFxuICAgICAgICAgIGF0dFN0b3JlW1wiZGVsZXRlXCJdKGRpZ2VzdCk7XG4gICAgICAgIH1cbiAgICAgIH07XG4gICAgfSk7XG4gIH1cblxuICByZXZzLmZvckVhY2goZnVuY3Rpb24gKHJldikge1xuICAgIHZhciBpbmRleCA9IHNlcVN0b3JlLmluZGV4KCdfZG9jX2lkX3JldicpO1xuICAgIHZhciBrZXkgPSBkb2NJZCArIFwiOjpcIiArIHJldjtcbiAgICBpbmRleC5nZXRLZXkoa2V5KS5vbnN1Y2Nlc3MgPSBmdW5jdGlvbiAoZSkge1xuICAgICAgdmFyIHNlcSA9IGUudGFyZ2V0LnJlc3VsdDtcbiAgICAgIGlmICh0eXBlb2Ygc2VxICE9PSAnbnVtYmVyJykge1xuICAgICAgICByZXR1cm4gY2hlY2tEb25lKCk7XG4gICAgICB9XG4gICAgICBzZXFTdG9yZVtcImRlbGV0ZVwiXShzZXEpO1xuXG4gICAgICB2YXIgY3Vyc29yID0gYXR0QW5kU2VxU3RvcmUuaW5kZXgoJ3NlcScpXG4gICAgICAgIC5vcGVuQ3Vyc29yKElEQktleVJhbmdlLm9ubHkoc2VxKSk7XG5cbiAgICAgIGN1cnNvci5vbnN1Y2Nlc3MgPSBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICAgICAgdmFyIGN1cnNvciA9IGV2ZW50LnRhcmdldC5yZXN1bHQ7XG4gICAgICAgIGlmIChjdXJzb3IpIHtcbiAgICAgICAgICB2YXIgZGlnZXN0ID0gY3Vyc29yLnZhbHVlLmRpZ2VzdFNlcS5zcGxpdCgnOjonKVswXTtcbiAgICAgICAgICBwb3NzaWJseU9ycGhhbmVkRGlnZXN0cy5wdXNoKGRpZ2VzdCk7XG4gICAgICAgICAgYXR0QW5kU2VxU3RvcmVbXCJkZWxldGVcIl0oY3Vyc29yLnByaW1hcnlLZXkpO1xuICAgICAgICAgIGN1cnNvcltcImNvbnRpbnVlXCJdKCk7XG4gICAgICAgIH0gZWxzZSB7IC8vIGRvbmVcbiAgICAgICAgICBjaGVja0RvbmUoKTtcbiAgICAgICAgfVxuICAgICAgfTtcbiAgICB9O1xuICB9KTtcbn07XG5cbmV4cG9ydHMub3BlblRyYW5zYWN0aW9uU2FmZWx5ID0gZnVuY3Rpb24gKGlkYiwgc3RvcmVzLCBtb2RlKSB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHR4bjogaWRiLnRyYW5zYWN0aW9uKHN0b3JlcywgbW9kZSlcbiAgICB9O1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICByZXR1cm4ge1xuICAgICAgZXJyb3I6IGVyclxuICAgIH07XG4gIH1cbn07IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuLi8uLi91dGlscycpO1xudmFyIG1lcmdlID0gcmVxdWlyZSgnLi4vLi4vbWVyZ2UnKTtcbnZhciBlcnJvcnMgPSByZXF1aXJlKCcuLi8uLi9kZXBzL2Vycm9ycycpO1xudmFyIGlkYlV0aWxzID0gcmVxdWlyZSgnLi9pZGItdXRpbHMnKTtcbnZhciBpZGJDb25zdGFudHMgPSByZXF1aXJlKCcuL2lkYi1jb25zdGFudHMnKTtcbnZhciBpZGJCdWxrRG9jcyA9IHJlcXVpcmUoJy4vaWRiLWJ1bGstZG9jcycpO1xudmFyIGlkYkFsbERvY3MgPSByZXF1aXJlKCcuL2lkYi1hbGwtZG9jcycpO1xudmFyIGNoZWNrQmxvYlN1cHBvcnQgPSByZXF1aXJlKCcuL2lkYi1ibG9iLXN1cHBvcnQnKTtcblxudmFyIEFEQVBURVJfVkVSU0lPTiA9IGlkYkNvbnN0YW50cy5BREFQVEVSX1ZFUlNJT047XG52YXIgQVRUQUNIX0FORF9TRVFfU1RPUkUgPSBpZGJDb25zdGFudHMuQVRUQUNIX0FORF9TRVFfU1RPUkU7XG52YXIgQVRUQUNIX1NUT1JFID0gaWRiQ29uc3RhbnRzLkFUVEFDSF9TVE9SRTtcbnZhciBCWV9TRVFfU1RPUkUgPSBpZGJDb25zdGFudHMuQllfU0VRX1NUT1JFO1xudmFyIERFVEVDVF9CTE9CX1NVUFBPUlRfU1RPUkUgPSBpZGJDb25zdGFudHMuREVURUNUX0JMT0JfU1VQUE9SVF9TVE9SRTtcbnZhciBET0NfU1RPUkUgPSBpZGJDb25zdGFudHMuRE9DX1NUT1JFO1xudmFyIExPQ0FMX1NUT1JFID0gaWRiQ29uc3RhbnRzLkxPQ0FMX1NUT1JFO1xudmFyIE1FVEFfU1RPUkUgPSBpZGJDb25zdGFudHMuTUVUQV9TVE9SRTtcblxudmFyIGFwcGx5TmV4dCA9IGlkYlV0aWxzLmFwcGx5TmV4dDtcbnZhciBjb21wYWN0UmV2cyA9IGlkYlV0aWxzLmNvbXBhY3RSZXZzO1xudmFyIGRlY29kZURvYyA9IGlkYlV0aWxzLmRlY29kZURvYztcbnZhciBkZWNvZGVNZXRhZGF0YSA9IGlkYlV0aWxzLmRlY29kZU1ldGFkYXRhO1xudmFyIGVuY29kZU1ldGFkYXRhID0gaWRiVXRpbHMuZW5jb2RlTWV0YWRhdGE7XG52YXIgZmV0Y2hBdHRhY2htZW50c0lmTmVjZXNzYXJ5ID0gaWRiVXRpbHMuZmV0Y2hBdHRhY2htZW50c0lmTmVjZXNzYXJ5O1xudmFyIGlkYkVycm9yID0gaWRiVXRpbHMuaWRiRXJyb3I7XG52YXIgcG9zdFByb2Nlc3NBdHRhY2htZW50cyA9IGlkYlV0aWxzLnBvc3RQcm9jZXNzQXR0YWNobWVudHM7XG52YXIgcmVhZEJsb2JEYXRhID0gaWRiVXRpbHMucmVhZEJsb2JEYXRhO1xudmFyIHRhc2tRdWV1ZSA9IGlkYlV0aWxzLnRhc2tRdWV1ZTtcbnZhciBvcGVuVHJhbnNhY3Rpb25TYWZlbHkgPSBpZGJVdGlscy5vcGVuVHJhbnNhY3Rpb25TYWZlbHk7XG5cbnZhciBjYWNoZWREQnMgPSB7fTtcbnZhciBibG9iU3VwcG9ydFByb21pc2U7XG5cbmZ1bmN0aW9uIElkYlBvdWNoKG9wdHMsIGNhbGxiYWNrKSB7XG4gIHZhciBhcGkgPSB0aGlzO1xuXG4gIHRhc2tRdWV1ZS5xdWV1ZS5wdXNoKHtcbiAgICBhY3Rpb246IGZ1bmN0aW9uICh0aGlzQ2FsbGJhY2spIHtcbiAgICAgIGluaXQoYXBpLCBvcHRzLCB0aGlzQ2FsbGJhY2spO1xuICAgIH0sXG4gICAgY2FsbGJhY2s6IGNhbGxiYWNrXG4gIH0pO1xuICBhcHBseU5leHQoKTtcbn1cblxuZnVuY3Rpb24gaW5pdChhcGksIG9wdHMsIGNhbGxiYWNrKSB7XG5cbiAgdmFyIGRiTmFtZSA9IG9wdHMubmFtZTtcblxuICB2YXIgaWRiID0gbnVsbDtcbiAgYXBpLl9tZXRhID0gbnVsbDtcblxuICAvLyBjYWxsZWQgd2hlbiBjcmVhdGluZyBhIGZyZXNoIG5ldyBkYXRhYmFzZVxuICBmdW5jdGlvbiBjcmVhdGVTY2hlbWEoZGIpIHtcbiAgICB2YXIgZG9jU3RvcmUgPSBkYi5jcmVhdGVPYmplY3RTdG9yZShET0NfU1RPUkUsIHtrZXlQYXRoIDogJ2lkJ30pO1xuICAgIGRiLmNyZWF0ZU9iamVjdFN0b3JlKEJZX1NFUV9TVE9SRSwge2F1dG9JbmNyZW1lbnQ6IHRydWV9KVxuICAgICAgLmNyZWF0ZUluZGV4KCdfZG9jX2lkX3JldicsICdfZG9jX2lkX3JldicsIHt1bmlxdWU6IHRydWV9KTtcbiAgICBkYi5jcmVhdGVPYmplY3RTdG9yZShBVFRBQ0hfU1RPUkUsIHtrZXlQYXRoOiAnZGlnZXN0J30pO1xuICAgIGRiLmNyZWF0ZU9iamVjdFN0b3JlKE1FVEFfU1RPUkUsIHtrZXlQYXRoOiAnaWQnLCBhdXRvSW5jcmVtZW50OiBmYWxzZX0pO1xuICAgIGRiLmNyZWF0ZU9iamVjdFN0b3JlKERFVEVDVF9CTE9CX1NVUFBPUlRfU1RPUkUpO1xuXG4gICAgLy8gYWRkZWQgaW4gdjJcbiAgICBkb2NTdG9yZS5jcmVhdGVJbmRleCgnZGVsZXRlZE9yTG9jYWwnLCAnZGVsZXRlZE9yTG9jYWwnLCB7dW5pcXVlIDogZmFsc2V9KTtcblxuICAgIC8vIGFkZGVkIGluIHYzXG4gICAgZGIuY3JlYXRlT2JqZWN0U3RvcmUoTE9DQUxfU1RPUkUsIHtrZXlQYXRoOiAnX2lkJ30pO1xuXG4gICAgLy8gYWRkZWQgaW4gdjRcbiAgICB2YXIgYXR0QW5kU2VxU3RvcmUgPSBkYi5jcmVhdGVPYmplY3RTdG9yZShBVFRBQ0hfQU5EX1NFUV9TVE9SRSxcbiAgICAgIHthdXRvSW5jcmVtZW50OiB0cnVlfSk7XG4gICAgYXR0QW5kU2VxU3RvcmUuY3JlYXRlSW5kZXgoJ3NlcScsICdzZXEnKTtcbiAgICBhdHRBbmRTZXFTdG9yZS5jcmVhdGVJbmRleCgnZGlnZXN0U2VxJywgJ2RpZ2VzdFNlcScsIHt1bmlxdWU6IHRydWV9KTtcbiAgfVxuXG4gIC8vIG1pZ3JhdGlvbiB0byB2ZXJzaW9uIDJcbiAgLy8gdW5mb3J0dW5hdGVseSBcImRlbGV0ZWRPckxvY2FsXCIgaXMgYSBtaXNub21lciBub3cgdGhhdCB3ZSBubyBsb25nZXJcbiAgLy8gc3RvcmUgbG9jYWwgZG9jcyBpbiB0aGUgbWFpbiBkb2Mtc3RvcmUsIGJ1dCB3aGFkZHlhZ29ubmFkb1xuICBmdW5jdGlvbiBhZGREZWxldGVkT3JMb2NhbEluZGV4KHR4biwgY2FsbGJhY2spIHtcbiAgICB2YXIgZG9jU3RvcmUgPSB0eG4ub2JqZWN0U3RvcmUoRE9DX1NUT1JFKTtcbiAgICBkb2NTdG9yZS5jcmVhdGVJbmRleCgnZGVsZXRlZE9yTG9jYWwnLCAnZGVsZXRlZE9yTG9jYWwnLCB7dW5pcXVlIDogZmFsc2V9KTtcblxuICAgIGRvY1N0b3JlLm9wZW5DdXJzb3IoKS5vbnN1Y2Nlc3MgPSBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICAgIHZhciBjdXJzb3IgPSBldmVudC50YXJnZXQucmVzdWx0O1xuICAgICAgaWYgKGN1cnNvcikge1xuICAgICAgICB2YXIgbWV0YWRhdGEgPSBjdXJzb3IudmFsdWU7XG4gICAgICAgIHZhciBkZWxldGVkID0gdXRpbHMuaXNEZWxldGVkKG1ldGFkYXRhKTtcbiAgICAgICAgbWV0YWRhdGEuZGVsZXRlZE9yTG9jYWwgPSBkZWxldGVkID8gXCIxXCIgOiBcIjBcIjtcbiAgICAgICAgZG9jU3RvcmUucHV0KG1ldGFkYXRhKTtcbiAgICAgICAgY3Vyc29yW1wiY29udGludWVcIl0oKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNhbGxiYWNrKCk7XG4gICAgICB9XG4gICAgfTtcbiAgfVxuXG4gIC8vIG1pZ3JhdGlvbiB0byB2ZXJzaW9uIDMgKHBhcnQgMSlcbiAgZnVuY3Rpb24gY3JlYXRlTG9jYWxTdG9yZVNjaGVtYShkYikge1xuICAgIGRiLmNyZWF0ZU9iamVjdFN0b3JlKExPQ0FMX1NUT1JFLCB7a2V5UGF0aDogJ19pZCd9KVxuICAgICAgLmNyZWF0ZUluZGV4KCdfZG9jX2lkX3JldicsICdfZG9jX2lkX3JldicsIHt1bmlxdWU6IHRydWV9KTtcbiAgfVxuXG4gIC8vIG1pZ3JhdGlvbiB0byB2ZXJzaW9uIDMgKHBhcnQgMilcbiAgZnVuY3Rpb24gbWlncmF0ZUxvY2FsU3RvcmUodHhuLCBjYikge1xuICAgIHZhciBsb2NhbFN0b3JlID0gdHhuLm9iamVjdFN0b3JlKExPQ0FMX1NUT1JFKTtcbiAgICB2YXIgZG9jU3RvcmUgPSB0eG4ub2JqZWN0U3RvcmUoRE9DX1NUT1JFKTtcbiAgICB2YXIgc2VxU3RvcmUgPSB0eG4ub2JqZWN0U3RvcmUoQllfU0VRX1NUT1JFKTtcblxuICAgIHZhciBjdXJzb3IgPSBkb2NTdG9yZS5vcGVuQ3Vyc29yKCk7XG4gICAgY3Vyc29yLm9uc3VjY2VzcyA9IGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgdmFyIGN1cnNvciA9IGV2ZW50LnRhcmdldC5yZXN1bHQ7XG4gICAgICBpZiAoY3Vyc29yKSB7XG4gICAgICAgIHZhciBtZXRhZGF0YSA9IGN1cnNvci52YWx1ZTtcbiAgICAgICAgdmFyIGRvY0lkID0gbWV0YWRhdGEuaWQ7XG4gICAgICAgIHZhciBsb2NhbCA9IHV0aWxzLmlzTG9jYWxJZChkb2NJZCk7XG4gICAgICAgIHZhciByZXYgPSBtZXJnZS53aW5uaW5nUmV2KG1ldGFkYXRhKTtcbiAgICAgICAgaWYgKGxvY2FsKSB7XG4gICAgICAgICAgdmFyIGRvY0lkUmV2ID0gZG9jSWQgKyBcIjo6XCIgKyByZXY7XG4gICAgICAgICAgLy8gcmVtb3ZlIGFsbCBzZXEgZW50cmllc1xuICAgICAgICAgIC8vIGFzc29jaWF0ZWQgd2l0aCB0aGlzIGRvY0lkXG4gICAgICAgICAgdmFyIHN0YXJ0ID0gZG9jSWQgKyBcIjo6XCI7XG4gICAgICAgICAgdmFyIGVuZCA9IGRvY0lkICsgXCI6On5cIjtcbiAgICAgICAgICB2YXIgaW5kZXggPSBzZXFTdG9yZS5pbmRleCgnX2RvY19pZF9yZXYnKTtcbiAgICAgICAgICB2YXIgcmFuZ2UgPSBJREJLZXlSYW5nZS5ib3VuZChzdGFydCwgZW5kLCBmYWxzZSwgZmFsc2UpO1xuICAgICAgICAgIHZhciBzZXFDdXJzb3IgPSBpbmRleC5vcGVuQ3Vyc29yKHJhbmdlKTtcbiAgICAgICAgICBzZXFDdXJzb3Iub25zdWNjZXNzID0gZnVuY3Rpb24gKGUpIHtcbiAgICAgICAgICAgIHNlcUN1cnNvciA9IGUudGFyZ2V0LnJlc3VsdDtcbiAgICAgICAgICAgIGlmICghc2VxQ3Vyc29yKSB7XG4gICAgICAgICAgICAgIC8vIGRvbmVcbiAgICAgICAgICAgICAgZG9jU3RvcmVbXCJkZWxldGVcIl0oY3Vyc29yLnByaW1hcnlLZXkpO1xuICAgICAgICAgICAgICBjdXJzb3JbXCJjb250aW51ZVwiXSgpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgdmFyIGRhdGEgPSBzZXFDdXJzb3IudmFsdWU7XG4gICAgICAgICAgICAgIGlmIChkYXRhLl9kb2NfaWRfcmV2ID09PSBkb2NJZFJldikge1xuICAgICAgICAgICAgICAgIGxvY2FsU3RvcmUucHV0KGRhdGEpO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIHNlcVN0b3JlW1wiZGVsZXRlXCJdKHNlcUN1cnNvci5wcmltYXJ5S2V5KTtcbiAgICAgICAgICAgICAgc2VxQ3Vyc29yW1wiY29udGludWVcIl0oKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9O1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGN1cnNvcltcImNvbnRpbnVlXCJdKCk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAoY2IpIHtcbiAgICAgICAgY2IoKTtcbiAgICAgIH1cbiAgICB9O1xuICB9XG5cbiAgLy8gbWlncmF0aW9uIHRvIHZlcnNpb24gNCAocGFydCAxKVxuICBmdW5jdGlvbiBhZGRBdHRhY2hBbmRTZXFTdG9yZShkYikge1xuICAgIHZhciBhdHRBbmRTZXFTdG9yZSA9IGRiLmNyZWF0ZU9iamVjdFN0b3JlKEFUVEFDSF9BTkRfU0VRX1NUT1JFLFxuICAgICAge2F1dG9JbmNyZW1lbnQ6IHRydWV9KTtcbiAgICBhdHRBbmRTZXFTdG9yZS5jcmVhdGVJbmRleCgnc2VxJywgJ3NlcScpO1xuICAgIGF0dEFuZFNlcVN0b3JlLmNyZWF0ZUluZGV4KCdkaWdlc3RTZXEnLCAnZGlnZXN0U2VxJywge3VuaXF1ZTogdHJ1ZX0pO1xuICB9XG5cbiAgLy8gbWlncmF0aW9uIHRvIHZlcnNpb24gNCAocGFydCAyKVxuICBmdW5jdGlvbiBtaWdyYXRlQXR0c0FuZFNlcXModHhuLCBjYWxsYmFjaykge1xuICAgIHZhciBzZXFTdG9yZSA9IHR4bi5vYmplY3RTdG9yZShCWV9TRVFfU1RPUkUpO1xuICAgIHZhciBhdHRTdG9yZSA9IHR4bi5vYmplY3RTdG9yZShBVFRBQ0hfU1RPUkUpO1xuICAgIHZhciBhdHRBbmRTZXFTdG9yZSA9IHR4bi5vYmplY3RTdG9yZShBVFRBQ0hfQU5EX1NFUV9TVE9SRSk7XG5cbiAgICAvLyBuZWVkIHRvIGFjdHVhbGx5IHBvcHVsYXRlIHRoZSB0YWJsZS4gdGhpcyBpcyB0aGUgZXhwZW5zaXZlIHBhcnQsXG4gICAgLy8gc28gYXMgYW4gb3B0aW1pemF0aW9uLCBjaGVjayBmaXJzdCB0aGF0IHRoaXMgZGF0YWJhc2UgZXZlblxuICAgIC8vIGNvbnRhaW5zIGF0dGFjaG1lbnRzXG4gICAgdmFyIHJlcSA9IGF0dFN0b3JlLmNvdW50KCk7XG4gICAgcmVxLm9uc3VjY2VzcyA9IGZ1bmN0aW9uIChlKSB7XG4gICAgICB2YXIgY291bnQgPSBlLnRhcmdldC5yZXN1bHQ7XG4gICAgICBpZiAoIWNvdW50KSB7XG4gICAgICAgIHJldHVybiBjYWxsYmFjaygpOyAvLyBkb25lXG4gICAgICB9XG5cbiAgICAgIHNlcVN0b3JlLm9wZW5DdXJzb3IoKS5vbnN1Y2Nlc3MgPSBmdW5jdGlvbiAoZSkge1xuICAgICAgICB2YXIgY3Vyc29yID0gZS50YXJnZXQucmVzdWx0O1xuICAgICAgICBpZiAoIWN1cnNvcikge1xuICAgICAgICAgIHJldHVybiBjYWxsYmFjaygpOyAvLyBkb25lXG4gICAgICAgIH1cbiAgICAgICAgdmFyIGRvYyA9IGN1cnNvci52YWx1ZTtcbiAgICAgICAgdmFyIHNlcSA9IGN1cnNvci5wcmltYXJ5S2V5O1xuICAgICAgICB2YXIgYXR0cyA9IE9iamVjdC5rZXlzKGRvYy5fYXR0YWNobWVudHMgfHwge30pO1xuICAgICAgICB2YXIgZGlnZXN0TWFwID0ge307XG4gICAgICAgIGZvciAodmFyIGogPSAwOyBqIDwgYXR0cy5sZW5ndGg7IGorKykge1xuICAgICAgICAgIHZhciBhdHQgPSBkb2MuX2F0dGFjaG1lbnRzW2F0dHNbal1dO1xuICAgICAgICAgIGRpZ2VzdE1hcFthdHQuZGlnZXN0XSA9IHRydWU7IC8vIHVuaXEgZGlnZXN0cywganVzdCBpbiBjYXNlXG4gICAgICAgIH1cbiAgICAgICAgdmFyIGRpZ2VzdHMgPSBPYmplY3Qua2V5cyhkaWdlc3RNYXApO1xuICAgICAgICBmb3IgKGogPSAwOyBqIDwgZGlnZXN0cy5sZW5ndGg7IGorKykge1xuICAgICAgICAgIHZhciBkaWdlc3QgPSBkaWdlc3RzW2pdO1xuICAgICAgICAgIGF0dEFuZFNlcVN0b3JlLnB1dCh7XG4gICAgICAgICAgICBzZXE6IHNlcSxcbiAgICAgICAgICAgIGRpZ2VzdFNlcTogZGlnZXN0ICsgJzo6JyArIHNlcVxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIGN1cnNvcltcImNvbnRpbnVlXCJdKCk7XG4gICAgICB9O1xuICAgIH07XG4gIH1cblxuICAvLyBtaWdyYXRpb24gdG8gdmVyc2lvbiA1XG4gIC8vIEluc3RlYWQgb2YgcmVseWluZyBvbiBvbi10aGUtZmx5IG1pZ3JhdGlvbiBvZiBtZXRhZGF0YSxcbiAgLy8gdGhpcyBicmluZ3MgdGhlIGRvYy1zdG9yZSB0byBpdHMgbW9kZXJuIGZvcm06XG4gIC8vIC0gbWV0YWRhdGEud2lubmluZ3JldlxuICAvLyAtIG1ldGFkYXRhLnNlcVxuICAvLyAtIHN0cmluZ2lmeSB0aGUgbWV0YWRhdGEgd2hlbiBzdG9yaW5nIGl0XG4gIGZ1bmN0aW9uIG1pZ3JhdGVNZXRhZGF0YSh0eG4pIHtcblxuICAgIGZ1bmN0aW9uIGRlY29kZU1ldGFkYXRhQ29tcGF0KHN0b3JlZE9iamVjdCkge1xuICAgICAgaWYgKCFzdG9yZWRPYmplY3QuZGF0YSkge1xuICAgICAgICAvLyBvbGQgZm9ybWF0LCB3aGVuIHdlIGRpZG4ndCBzdG9yZSBpdCBzdHJpbmdpZmllZFxuICAgICAgICBzdG9yZWRPYmplY3QuZGVsZXRlZCA9IHN0b3JlZE9iamVjdC5kZWxldGVkT3JMb2NhbCA9PT0gJzEnO1xuICAgICAgICByZXR1cm4gc3RvcmVkT2JqZWN0O1xuICAgICAgfVxuICAgICAgcmV0dXJuIGRlY29kZU1ldGFkYXRhKHN0b3JlZE9iamVjdCk7XG4gICAgfVxuXG4gICAgLy8gZW5zdXJlIHRoYXQgZXZlcnkgbWV0YWRhdGEgaGFzIGEgd2lubmluZ1JldiBhbmQgc2VxLFxuICAgIC8vIHdoaWNoIHdhcyBwcmV2aW91c2x5IGNyZWF0ZWQgb24tdGhlLWZseSBidXQgYmV0dGVyIHRvIG1pZ3JhdGVcbiAgICB2YXIgYnlTZXFTdG9yZSA9IHR4bi5vYmplY3RTdG9yZShCWV9TRVFfU1RPUkUpO1xuICAgIHZhciBkb2NTdG9yZSA9IHR4bi5vYmplY3RTdG9yZShET0NfU1RPUkUpO1xuICAgIHZhciBjdXJzb3IgPSBkb2NTdG9yZS5vcGVuQ3Vyc29yKCk7XG4gICAgY3Vyc29yLm9uc3VjY2VzcyA9IGZ1bmN0aW9uIChlKSB7XG4gICAgICB2YXIgY3Vyc29yID0gZS50YXJnZXQucmVzdWx0O1xuICAgICAgaWYgKCFjdXJzb3IpIHtcbiAgICAgICAgcmV0dXJuOyAvLyBkb25lXG4gICAgICB9XG4gICAgICB2YXIgbWV0YWRhdGEgPSBkZWNvZGVNZXRhZGF0YUNvbXBhdChjdXJzb3IudmFsdWUpO1xuXG4gICAgICBtZXRhZGF0YS53aW5uaW5nUmV2ID0gbWV0YWRhdGEud2lubmluZ1JldiB8fCBtZXJnZS53aW5uaW5nUmV2KG1ldGFkYXRhKTtcblxuICAgICAgZnVuY3Rpb24gZmV0Y2hNZXRhZGF0YVNlcSgpIHtcbiAgICAgICAgLy8gbWV0YWRhdGEuc2VxIHdhcyBhZGRlZCBwb3N0LTMuMi4wLCBzbyBpZiBpdCdzIG1pc3NpbmcsXG4gICAgICAgIC8vIHdlIG5lZWQgdG8gZmV0Y2ggaXQgbWFudWFsbHlcbiAgICAgICAgdmFyIHN0YXJ0ID0gbWV0YWRhdGEuaWQgKyAnOjonO1xuICAgICAgICB2YXIgZW5kID0gbWV0YWRhdGEuaWQgKyAnOjpcXHVmZmZmJztcbiAgICAgICAgdmFyIHJlcSA9IGJ5U2VxU3RvcmUuaW5kZXgoJ19kb2NfaWRfcmV2Jykub3BlbkN1cnNvcihcbiAgICAgICAgICBJREJLZXlSYW5nZS5ib3VuZChzdGFydCwgZW5kKSk7XG5cbiAgICAgICAgdmFyIG1ldGFkYXRhU2VxID0gMDtcbiAgICAgICAgcmVxLm9uc3VjY2VzcyA9IGZ1bmN0aW9uIChlKSB7XG4gICAgICAgICAgdmFyIGN1cnNvciA9IGUudGFyZ2V0LnJlc3VsdDtcbiAgICAgICAgICBpZiAoIWN1cnNvcikge1xuICAgICAgICAgICAgbWV0YWRhdGEuc2VxID0gbWV0YWRhdGFTZXE7XG4gICAgICAgICAgICByZXR1cm4gb25HZXRNZXRhZGF0YVNlcSgpO1xuICAgICAgICAgIH1cbiAgICAgICAgICB2YXIgc2VxID0gY3Vyc29yLnByaW1hcnlLZXk7XG4gICAgICAgICAgaWYgKHNlcSA+IG1ldGFkYXRhU2VxKSB7XG4gICAgICAgICAgICBtZXRhZGF0YVNlcSA9IHNlcTtcbiAgICAgICAgICB9XG4gICAgICAgICAgY3Vyc29yW1wiY29udGludWVcIl0oKTtcbiAgICAgICAgfTtcbiAgICAgIH1cblxuICAgICAgZnVuY3Rpb24gb25HZXRNZXRhZGF0YVNlcSgpIHtcbiAgICAgICAgdmFyIG1ldGFkYXRhVG9TdG9yZSA9IGVuY29kZU1ldGFkYXRhKG1ldGFkYXRhLFxuICAgICAgICAgIG1ldGFkYXRhLndpbm5pbmdSZXYsIG1ldGFkYXRhLmRlbGV0ZWQpO1xuXG4gICAgICAgIHZhciByZXEgPSBkb2NTdG9yZS5wdXQobWV0YWRhdGFUb1N0b3JlKTtcbiAgICAgICAgcmVxLm9uc3VjY2VzcyA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICBjdXJzb3JbXCJjb250aW51ZVwiXSgpO1xuICAgICAgICB9O1xuICAgICAgfVxuXG4gICAgICBpZiAobWV0YWRhdGEuc2VxKSB7XG4gICAgICAgIHJldHVybiBvbkdldE1ldGFkYXRhU2VxKCk7XG4gICAgICB9XG5cbiAgICAgIGZldGNoTWV0YWRhdGFTZXEoKTtcbiAgICB9O1xuXG4gIH1cblxuICBhcGkudHlwZSA9IGZ1bmN0aW9uICgpIHtcbiAgICByZXR1cm4gJ2lkYic7XG4gIH07XG5cbiAgYXBpLl9pZCA9IHV0aWxzLnRvUHJvbWlzZShmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICBjYWxsYmFjayhudWxsLCBhcGkuX21ldGEuaW5zdGFuY2VJZCk7XG4gIH0pO1xuXG4gIGFwaS5fYnVsa0RvY3MgPSBmdW5jdGlvbiBpZGJfYnVsa0RvY3MocmVxLCBvcHRzLCBjYWxsYmFjaykge1xuICAgIGlkYkJ1bGtEb2NzKHJlcSwgb3B0cywgYXBpLCBpZGIsIElkYlBvdWNoLkNoYW5nZXMsIGNhbGxiYWNrKTtcbiAgfTtcblxuICAvLyBGaXJzdCB3ZSBsb29rIHVwIHRoZSBtZXRhZGF0YSBpbiB0aGUgaWRzIGRhdGFiYXNlLCB0aGVuIHdlIGZldGNoIHRoZVxuICAvLyBjdXJyZW50IHJldmlzaW9uKHMpIGZyb20gdGhlIGJ5IHNlcXVlbmNlIHN0b3JlXG4gIGFwaS5fZ2V0ID0gZnVuY3Rpb24gaWRiX2dldChpZCwgb3B0cywgY2FsbGJhY2spIHtcbiAgICB2YXIgZG9jO1xuICAgIHZhciBtZXRhZGF0YTtcbiAgICB2YXIgZXJyO1xuICAgIHZhciB0eG47XG4gICAgb3B0cyA9IHV0aWxzLmNsb25lKG9wdHMpO1xuICAgIGlmIChvcHRzLmN0eCkge1xuICAgICAgdHhuID0gb3B0cy5jdHg7XG4gICAgfSBlbHNlIHtcbiAgICAgIHZhciB0eG5SZXN1bHQgPSBvcGVuVHJhbnNhY3Rpb25TYWZlbHkoaWRiLFxuICAgICAgICBbRE9DX1NUT1JFLCBCWV9TRVFfU1RPUkUsIEFUVEFDSF9TVE9SRV0sICdyZWFkb25seScpO1xuICAgICAgaWYgKHR4blJlc3VsdC5lcnJvcikge1xuICAgICAgICByZXR1cm4gY2FsbGJhY2sodHhuUmVzdWx0LmVycm9yKTtcbiAgICAgIH1cbiAgICAgIHR4biA9IHR4blJlc3VsdC50eG47XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZmluaXNoKCkge1xuICAgICAgY2FsbGJhY2soZXJyLCB7ZG9jOiBkb2MsIG1ldGFkYXRhOiBtZXRhZGF0YSwgY3R4OiB0eG59KTtcbiAgICB9XG5cbiAgICB0eG4ub2JqZWN0U3RvcmUoRE9DX1NUT1JFKS5nZXQoaWQpLm9uc3VjY2VzcyA9IGZ1bmN0aW9uIChlKSB7XG4gICAgICBtZXRhZGF0YSA9IGRlY29kZU1ldGFkYXRhKGUudGFyZ2V0LnJlc3VsdCk7XG4gICAgICAvLyB3ZSBjYW4gZGV0ZXJtaW5lIHRoZSByZXN1bHQgaGVyZSBpZjpcbiAgICAgIC8vIDEuIHRoZXJlIGlzIG5vIHN1Y2ggZG9jdW1lbnRcbiAgICAgIC8vIDIuIHRoZSBkb2N1bWVudCBpcyBkZWxldGVkIGFuZCB3ZSBkb24ndCBhc2sgYWJvdXQgc3BlY2lmaWMgcmV2XG4gICAgICAvLyBXaGVuIHdlIGFzayB3aXRoIG9wdHMucmV2IHdlIGV4cGVjdCB0aGUgYW5zd2VyIHRvIGJlIGVpdGhlclxuICAgICAgLy8gZG9jIChwb3NzaWJseSB3aXRoIF9kZWxldGVkPXRydWUpIG9yIG1pc3NpbmcgZXJyb3JcbiAgICAgIGlmICghbWV0YWRhdGEpIHtcbiAgICAgICAgZXJyID0gZXJyb3JzLmVycm9yKGVycm9ycy5NSVNTSU5HX0RPQywgJ21pc3NpbmcnKTtcbiAgICAgICAgcmV0dXJuIGZpbmlzaCgpO1xuICAgICAgfVxuICAgICAgaWYgKHV0aWxzLmlzRGVsZXRlZChtZXRhZGF0YSkgJiYgIW9wdHMucmV2KSB7XG4gICAgICAgIGVyciA9IGVycm9ycy5lcnJvcihlcnJvcnMuTUlTU0lOR19ET0MsIFwiZGVsZXRlZFwiKTtcbiAgICAgICAgcmV0dXJuIGZpbmlzaCgpO1xuICAgICAgfVxuICAgICAgdmFyIG9iamVjdFN0b3JlID0gdHhuLm9iamVjdFN0b3JlKEJZX1NFUV9TVE9SRSk7XG5cbiAgICAgIHZhciByZXYgPSBvcHRzLnJldiB8fCBtZXRhZGF0YS53aW5uaW5nUmV2O1xuICAgICAgdmFyIGtleSA9IG1ldGFkYXRhLmlkICsgJzo6JyArIHJldjtcblxuICAgICAgb2JqZWN0U3RvcmUuaW5kZXgoJ19kb2NfaWRfcmV2JykuZ2V0KGtleSkub25zdWNjZXNzID0gZnVuY3Rpb24gKGUpIHtcbiAgICAgICAgZG9jID0gZS50YXJnZXQucmVzdWx0O1xuICAgICAgICBpZiAoZG9jKSB7XG4gICAgICAgICAgZG9jID0gZGVjb2RlRG9jKGRvYyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFkb2MpIHtcbiAgICAgICAgICBlcnIgPSBlcnJvcnMuZXJyb3IoZXJyb3JzLk1JU1NJTkdfRE9DLCAnbWlzc2luZycpO1xuICAgICAgICAgIHJldHVybiBmaW5pc2goKTtcbiAgICAgICAgfVxuICAgICAgICBmaW5pc2goKTtcbiAgICAgIH07XG4gICAgfTtcbiAgfTtcblxuICBhcGkuX2dldEF0dGFjaG1lbnQgPSBmdW5jdGlvbiAoYXR0YWNobWVudCwgb3B0cywgY2FsbGJhY2spIHtcbiAgICB2YXIgdHhuO1xuICAgIG9wdHMgPSB1dGlscy5jbG9uZShvcHRzKTtcbiAgICBpZiAob3B0cy5jdHgpIHtcbiAgICAgIHR4biA9IG9wdHMuY3R4O1xuICAgIH0gZWxzZSB7XG4gICAgICB2YXIgdHhuUmVzdWx0ID0gb3BlblRyYW5zYWN0aW9uU2FmZWx5KGlkYixcbiAgICAgICAgW0RPQ19TVE9SRSwgQllfU0VRX1NUT1JFLCBBVFRBQ0hfU1RPUkVdLCAncmVhZG9ubHknKTtcbiAgICAgIGlmICh0eG5SZXN1bHQuZXJyb3IpIHtcbiAgICAgICAgcmV0dXJuIGNhbGxiYWNrKHR4blJlc3VsdC5lcnJvcik7XG4gICAgICB9XG4gICAgICB0eG4gPSB0eG5SZXN1bHQudHhuO1xuICAgIH1cbiAgICB2YXIgZGlnZXN0ID0gYXR0YWNobWVudC5kaWdlc3Q7XG4gICAgdmFyIHR5cGUgPSBhdHRhY2htZW50LmNvbnRlbnRfdHlwZTtcblxuICAgIHR4bi5vYmplY3RTdG9yZShBVFRBQ0hfU1RPUkUpLmdldChkaWdlc3QpLm9uc3VjY2VzcyA9IGZ1bmN0aW9uIChlKSB7XG4gICAgICB2YXIgYm9keSA9IGUudGFyZ2V0LnJlc3VsdC5ib2R5O1xuICAgICAgcmVhZEJsb2JEYXRhKGJvZHksIHR5cGUsIG9wdHMuZW5jb2RlLCBmdW5jdGlvbiAoYmxvYkRhdGEpIHtcbiAgICAgICAgY2FsbGJhY2sobnVsbCwgYmxvYkRhdGEpO1xuICAgICAgfSk7XG4gICAgfTtcbiAgfTtcblxuICBhcGkuX2luZm8gPSBmdW5jdGlvbiBpZGJfaW5mbyhjYWxsYmFjaykge1xuXG4gICAgaWYgKGlkYiA9PT0gbnVsbCB8fCAhY2FjaGVkREJzW2RiTmFtZV0pIHtcbiAgICAgIHZhciBlcnJvciA9IG5ldyBFcnJvcignZGIgaXNuXFwndCBvcGVuJyk7XG4gICAgICBlcnJvci5pZCA9ICdpZGJOdWxsJztcbiAgICAgIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgfVxuICAgIHZhciB1cGRhdGVTZXE7XG4gICAgdmFyIGRvY0NvdW50O1xuXG4gICAgdmFyIHR4blJlc3VsdCA9IG9wZW5UcmFuc2FjdGlvblNhZmVseShpZGIsIFtCWV9TRVFfU1RPUkVdLCAncmVhZG9ubHknKTtcbiAgICBpZiAodHhuUmVzdWx0LmVycm9yKSB7XG4gICAgICByZXR1cm4gY2FsbGJhY2sodHhuUmVzdWx0LmVycm9yKTtcbiAgICB9XG4gICAgdmFyIHR4biA9IHR4blJlc3VsdC50eG47XG4gICAgdmFyIGN1cnNvciA9IHR4bi5vYmplY3RTdG9yZShCWV9TRVFfU1RPUkUpLm9wZW5DdXJzb3IobnVsbCwgJ3ByZXYnKTtcbiAgICBjdXJzb3Iub25zdWNjZXNzID0gZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgICB2YXIgY3Vyc29yID0gZXZlbnQudGFyZ2V0LnJlc3VsdDtcbiAgICAgIHVwZGF0ZVNlcSA9IGN1cnNvciA/IGN1cnNvci5rZXkgOiAwO1xuICAgICAgLy8gY291bnQgd2l0aGluIHRoZSBzYW1lIHR4biBmb3IgY29uc2lzdGVuY3lcbiAgICAgIGRvY0NvdW50ID0gYXBpLl9tZXRhLmRvY0NvdW50O1xuICAgIH07XG5cbiAgICB0eG4ub25jb21wbGV0ZSA9IGZ1bmN0aW9uICgpIHtcbiAgICAgIGNhbGxiYWNrKG51bGwsIHtcbiAgICAgICAgZG9jX2NvdW50OiBkb2NDb3VudCxcbiAgICAgICAgdXBkYXRlX3NlcTogdXBkYXRlU2VxLFxuICAgICAgICAvLyBmb3IgZGVidWdnaW5nXG4gICAgICAgIGlkYl9hdHRhY2htZW50X2Zvcm1hdDogKGFwaS5fbWV0YS5ibG9iU3VwcG9ydCA/ICdiaW5hcnknIDogJ2Jhc2U2NCcpXG4gICAgICB9KTtcbiAgICB9O1xuICB9O1xuXG4gIGFwaS5fYWxsRG9jcyA9IGZ1bmN0aW9uIGlkYl9hbGxEb2NzKG9wdHMsIGNhbGxiYWNrKSB7XG4gICAgaWRiQWxsRG9jcyhvcHRzLCBhcGksIGlkYiwgY2FsbGJhY2spO1xuICB9O1xuXG4gIGFwaS5fY2hhbmdlcyA9IGZ1bmN0aW9uIChvcHRzKSB7XG4gICAgb3B0cyA9IHV0aWxzLmNsb25lKG9wdHMpO1xuXG4gICAgaWYgKG9wdHMuY29udGludW91cykge1xuICAgICAgdmFyIGlkID0gZGJOYW1lICsgJzonICsgdXRpbHMudXVpZCgpO1xuICAgICAgSWRiUG91Y2guQ2hhbmdlcy5hZGRMaXN0ZW5lcihkYk5hbWUsIGlkLCBhcGksIG9wdHMpO1xuICAgICAgSWRiUG91Y2guQ2hhbmdlcy5ub3RpZnkoZGJOYW1lKTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGNhbmNlbDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgIElkYlBvdWNoLkNoYW5nZXMucmVtb3ZlTGlzdGVuZXIoZGJOYW1lLCBpZCk7XG4gICAgICAgIH1cbiAgICAgIH07XG4gICAgfVxuXG4gICAgdmFyIGRvY0lkcyA9IG9wdHMuZG9jX2lkcyAmJiBuZXcgdXRpbHMuU2V0KG9wdHMuZG9jX2lkcyk7XG4gICAgdmFyIGRlc2NlbmRpbmcgPSBvcHRzLmRlc2NlbmRpbmcgPyAncHJldicgOiBudWxsO1xuXG4gICAgb3B0cy5zaW5jZSA9IG9wdHMuc2luY2UgfHwgMDtcbiAgICB2YXIgbGFzdFNlcSA9IG9wdHMuc2luY2U7XG5cbiAgICB2YXIgbGltaXQgPSAnbGltaXQnIGluIG9wdHMgPyBvcHRzLmxpbWl0IDogLTE7XG4gICAgaWYgKGxpbWl0ID09PSAwKSB7XG4gICAgICBsaW1pdCA9IDE7IC8vIHBlciBDb3VjaERCIF9jaGFuZ2VzIHNwZWNcbiAgICB9XG4gICAgdmFyIHJldHVybkRvY3M7XG4gICAgaWYgKCdyZXR1cm5Eb2NzJyBpbiBvcHRzKSB7XG4gICAgICByZXR1cm5Eb2NzID0gb3B0cy5yZXR1cm5Eb2NzO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm5Eb2NzID0gdHJ1ZTtcbiAgICB9XG5cbiAgICB2YXIgcmVzdWx0cyA9IFtdO1xuICAgIHZhciBudW1SZXN1bHRzID0gMDtcbiAgICB2YXIgZmlsdGVyID0gdXRpbHMuZmlsdGVyQ2hhbmdlKG9wdHMpO1xuICAgIHZhciBkb2NJZHNUb01ldGFkYXRhID0gbmV3IHV0aWxzLk1hcCgpO1xuXG4gICAgdmFyIHR4bjtcbiAgICB2YXIgYnlTZXFTdG9yZTtcbiAgICB2YXIgZG9jU3RvcmU7XG5cbiAgICBmdW5jdGlvbiBvbkdldEN1cnNvcihjdXJzb3IpIHtcblxuICAgICAgdmFyIGRvYyA9IGRlY29kZURvYyhjdXJzb3IudmFsdWUpO1xuICAgICAgdmFyIHNlcSA9IGN1cnNvci5rZXk7XG5cbiAgICAgIGlmIChkb2NJZHMgJiYgIWRvY0lkcy5oYXMoZG9jLl9pZCkpIHtcbiAgICAgICAgcmV0dXJuIGN1cnNvcltcImNvbnRpbnVlXCJdKCk7XG4gICAgICB9XG5cbiAgICAgIHZhciBtZXRhZGF0YTtcblxuICAgICAgZnVuY3Rpb24gb25HZXRNZXRhZGF0YSgpIHtcbiAgICAgICAgaWYgKG1ldGFkYXRhLnNlcSAhPT0gc2VxKSB7XG4gICAgICAgICAgLy8gc29tZSBvdGhlciBzZXEgaXMgbGF0ZXJcbiAgICAgICAgICByZXR1cm4gY3Vyc29yW1wiY29udGludWVcIl0oKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGxhc3RTZXEgPSBzZXE7XG5cbiAgICAgICAgaWYgKG1ldGFkYXRhLndpbm5pbmdSZXYgPT09IGRvYy5fcmV2KSB7XG4gICAgICAgICAgcmV0dXJuIG9uR2V0V2lubmluZ0RvYyhkb2MpO1xuICAgICAgICB9XG5cbiAgICAgICAgZmV0Y2hXaW5uaW5nRG9jKCk7XG4gICAgICB9XG5cbiAgICAgIGZ1bmN0aW9uIGZldGNoV2lubmluZ0RvYygpIHtcbiAgICAgICAgdmFyIGRvY0lkUmV2ID0gZG9jLl9pZCArICc6OicgKyBtZXRhZGF0YS53aW5uaW5nUmV2O1xuICAgICAgICB2YXIgcmVxID0gYnlTZXFTdG9yZS5pbmRleCgnX2RvY19pZF9yZXYnKS5vcGVuQ3Vyc29yKFxuICAgICAgICAgIElEQktleVJhbmdlLmJvdW5kKGRvY0lkUmV2LCBkb2NJZFJldiArICdcXHVmZmZmJykpO1xuICAgICAgICByZXEub25zdWNjZXNzID0gZnVuY3Rpb24gKGUpIHtcbiAgICAgICAgICBvbkdldFdpbm5pbmdEb2MoZGVjb2RlRG9jKGUudGFyZ2V0LnJlc3VsdC52YWx1ZSkpO1xuICAgICAgICB9O1xuICAgICAgfVxuXG4gICAgICBmdW5jdGlvbiBvbkdldFdpbm5pbmdEb2Mod2lubmluZ0RvYykge1xuXG4gICAgICAgIHZhciBjaGFuZ2UgPSBvcHRzLnByb2Nlc3NDaGFuZ2Uod2lubmluZ0RvYywgbWV0YWRhdGEsIG9wdHMpO1xuICAgICAgICBjaGFuZ2Uuc2VxID0gbWV0YWRhdGEuc2VxO1xuICAgICAgICBpZiAoZmlsdGVyKGNoYW5nZSkpIHtcbiAgICAgICAgICBudW1SZXN1bHRzKys7XG4gICAgICAgICAgaWYgKHJldHVybkRvY3MpIHtcbiAgICAgICAgICAgIHJlc3VsdHMucHVzaChjaGFuZ2UpO1xuICAgICAgICAgIH1cbiAgICAgICAgICAvLyBwcm9jZXNzIHRoZSBhdHRhY2htZW50IGltbWVkaWF0ZWx5XG4gICAgICAgICAgLy8gZm9yIHRoZSBiZW5lZml0IG9mIGxpdmUgbGlzdGVuZXJzXG4gICAgICAgICAgaWYgKG9wdHMuYXR0YWNobWVudHMgJiYgb3B0cy5pbmNsdWRlX2RvY3MpIHtcbiAgICAgICAgICAgIGZldGNoQXR0YWNobWVudHNJZk5lY2Vzc2FyeSh3aW5uaW5nRG9jLCBvcHRzLCB0eG4sIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgcG9zdFByb2Nlc3NBdHRhY2htZW50cyhbY2hhbmdlXSkudGhlbihmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgb3B0cy5vbkNoYW5nZShjaGFuZ2UpO1xuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBvcHRzLm9uQ2hhbmdlKGNoYW5nZSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGlmIChudW1SZXN1bHRzICE9PSBsaW1pdCkge1xuICAgICAgICAgIGN1cnNvcltcImNvbnRpbnVlXCJdKCk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgbWV0YWRhdGEgPSBkb2NJZHNUb01ldGFkYXRhLmdldChkb2MuX2lkKTtcbiAgICAgIGlmIChtZXRhZGF0YSkgeyAvLyBjYWNoZWRcbiAgICAgICAgcmV0dXJuIG9uR2V0TWV0YWRhdGEoKTtcbiAgICAgIH1cbiAgICAgIC8vIG1ldGFkYXRhIG5vdCBjYWNoZWQsIGhhdmUgdG8gZ28gZmV0Y2ggaXRcbiAgICAgIGRvY1N0b3JlLmdldChkb2MuX2lkKS5vbnN1Y2Nlc3MgPSBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICAgICAgbWV0YWRhdGEgPSBkZWNvZGVNZXRhZGF0YShldmVudC50YXJnZXQucmVzdWx0KTtcbiAgICAgICAgZG9jSWRzVG9NZXRhZGF0YS5zZXQoZG9jLl9pZCwgbWV0YWRhdGEpO1xuICAgICAgICBvbkdldE1ldGFkYXRhKCk7XG4gICAgICB9O1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIG9uc3VjY2VzcyhldmVudCkge1xuICAgICAgdmFyIGN1cnNvciA9IGV2ZW50LnRhcmdldC5yZXN1bHQ7XG5cbiAgICAgIGlmICghY3Vyc29yKSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIG9uR2V0Q3Vyc29yKGN1cnNvcik7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZmV0Y2hDaGFuZ2VzKCkge1xuICAgICAgdmFyIG9iamVjdFN0b3JlcyA9IFtET0NfU1RPUkUsIEJZX1NFUV9TVE9SRV07XG4gICAgICBpZiAob3B0cy5hdHRhY2htZW50cykge1xuICAgICAgICBvYmplY3RTdG9yZXMucHVzaChBVFRBQ0hfU1RPUkUpO1xuICAgICAgfVxuICAgICAgdmFyIHR4blJlc3VsdCA9IG9wZW5UcmFuc2FjdGlvblNhZmVseShpZGIsIG9iamVjdFN0b3JlcywgJ3JlYWRvbmx5Jyk7XG4gICAgICBpZiAodHhuUmVzdWx0LmVycm9yKSB7XG4gICAgICAgIHJldHVybiBvcHRzLmNvbXBsZXRlKHR4blJlc3VsdC5lcnJvcik7XG4gICAgICB9XG4gICAgICB0eG4gPSB0eG5SZXN1bHQudHhuO1xuICAgICAgdHhuLm9uZXJyb3IgPSBpZGJFcnJvcihvcHRzLmNvbXBsZXRlKTtcbiAgICAgIHR4bi5vbmNvbXBsZXRlID0gb25UeG5Db21wbGV0ZTtcblxuICAgICAgYnlTZXFTdG9yZSA9IHR4bi5vYmplY3RTdG9yZShCWV9TRVFfU1RPUkUpO1xuICAgICAgZG9jU3RvcmUgPSB0eG4ub2JqZWN0U3RvcmUoRE9DX1NUT1JFKTtcblxuICAgICAgdmFyIHJlcTtcblxuICAgICAgaWYgKGRlc2NlbmRpbmcpIHtcbiAgICAgICAgcmVxID0gYnlTZXFTdG9yZS5vcGVuQ3Vyc29yKFxuXG4gICAgICAgICAgbnVsbCwgZGVzY2VuZGluZyk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXEgPSBieVNlcVN0b3JlLm9wZW5DdXJzb3IoXG4gICAgICAgICAgSURCS2V5UmFuZ2UubG93ZXJCb3VuZChvcHRzLnNpbmNlLCB0cnVlKSk7XG4gICAgICB9XG5cbiAgICAgIHJlcS5vbnN1Y2Nlc3MgPSBvbnN1Y2Nlc3M7XG4gICAgfVxuXG4gICAgZmV0Y2hDaGFuZ2VzKCk7XG5cbiAgICBmdW5jdGlvbiBvblR4bkNvbXBsZXRlKCkge1xuXG4gICAgICBmdW5jdGlvbiBmaW5pc2goKSB7XG4gICAgICAgIG9wdHMuY29tcGxldGUobnVsbCwge1xuICAgICAgICAgIHJlc3VsdHM6IHJlc3VsdHMsXG4gICAgICAgICAgbGFzdF9zZXE6IGxhc3RTZXFcbiAgICAgICAgfSk7XG4gICAgICB9XG5cbiAgICAgIGlmICghb3B0cy5jb250aW51b3VzICYmIG9wdHMuYXR0YWNobWVudHMpIHtcbiAgICAgICAgLy8gY2Fubm90IGd1YXJhbnRlZSB0aGF0IHBvc3RQcm9jZXNzaW5nIHdhcyBhbHJlYWR5IGRvbmUsXG4gICAgICAgIC8vIHNvIGRvIGl0IGFnYWluXG4gICAgICAgIHBvc3RQcm9jZXNzQXR0YWNobWVudHMocmVzdWx0cykudGhlbihmaW5pc2gpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZmluaXNoKCk7XG4gICAgICB9XG4gICAgfVxuICB9O1xuXG4gIGFwaS5fY2xvc2UgPSBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICBpZiAoaWRiID09PSBudWxsKSB7XG4gICAgICByZXR1cm4gY2FsbGJhY2soZXJyb3JzLmVycm9yKGVycm9ycy5OT1RfT1BFTikpO1xuICAgIH1cblxuICAgIC8vIGh0dHBzOi8vZGV2ZWxvcGVyLm1vemlsbGEub3JnL2VuLVVTL2RvY3MvSW5kZXhlZERCL0lEQkRhdGFiYXNlI2Nsb3NlXG4gICAgLy8gXCJSZXR1cm5zIGltbWVkaWF0ZWx5IGFuZCBjbG9zZXMgdGhlIGNvbm5lY3Rpb24gaW4gYSBzZXBhcmF0ZSB0aHJlYWQuLi5cIlxuICAgIGlkYi5jbG9zZSgpO1xuICAgIGRlbGV0ZSBjYWNoZWREQnNbZGJOYW1lXTtcbiAgICBpZGIgPSBudWxsO1xuICAgIGNhbGxiYWNrKCk7XG4gIH07XG5cbiAgYXBpLl9nZXRSZXZpc2lvblRyZWUgPSBmdW5jdGlvbiAoZG9jSWQsIGNhbGxiYWNrKSB7XG4gICAgdmFyIHR4blJlc3VsdCA9IG9wZW5UcmFuc2FjdGlvblNhZmVseShpZGIsIFtET0NfU1RPUkVdLCAncmVhZG9ubHknKTtcbiAgICBpZiAodHhuUmVzdWx0LmVycm9yKSB7XG4gICAgICByZXR1cm4gY2FsbGJhY2sodHhuUmVzdWx0LmVycm9yKTtcbiAgICB9XG4gICAgdmFyIHR4biA9IHR4blJlc3VsdC50eG47XG4gICAgdmFyIHJlcSA9IHR4bi5vYmplY3RTdG9yZShET0NfU1RPUkUpLmdldChkb2NJZCk7XG4gICAgcmVxLm9uc3VjY2VzcyA9IGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgdmFyIGRvYyA9IGRlY29kZU1ldGFkYXRhKGV2ZW50LnRhcmdldC5yZXN1bHQpO1xuICAgICAgaWYgKCFkb2MpIHtcbiAgICAgICAgY2FsbGJhY2soZXJyb3JzLmVycm9yKGVycm9ycy5NSVNTSU5HX0RPQykpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY2FsbGJhY2sobnVsbCwgZG9jLnJldl90cmVlKTtcbiAgICAgIH1cbiAgICB9O1xuICB9O1xuXG4gIC8vIFRoaXMgZnVuY3Rpb24gcmVtb3ZlcyByZXZpc2lvbnMgb2YgZG9jdW1lbnQgZG9jSWRcbiAgLy8gd2hpY2ggYXJlIGxpc3RlZCBpbiByZXZzIGFuZCBzZXRzIHRoaXMgZG9jdW1lbnRcbiAgLy8gcmV2aXNpb24gdG8gdG8gcmV2X3RyZWVcbiAgYXBpLl9kb0NvbXBhY3Rpb24gPSBmdW5jdGlvbiAoZG9jSWQsIHJldnMsIGNhbGxiYWNrKSB7XG4gICAgdmFyIHN0b3JlcyA9IFtcbiAgICAgIERPQ19TVE9SRSxcbiAgICAgIEJZX1NFUV9TVE9SRSxcbiAgICAgIEFUVEFDSF9TVE9SRSxcbiAgICAgIEFUVEFDSF9BTkRfU0VRX1NUT1JFXG4gICAgXTtcbiAgICB2YXIgdHhuUmVzdWx0ID0gb3BlblRyYW5zYWN0aW9uU2FmZWx5KGlkYiwgc3RvcmVzLCAncmVhZHdyaXRlJyk7XG4gICAgaWYgKHR4blJlc3VsdC5lcnJvcikge1xuICAgICAgcmV0dXJuIGNhbGxiYWNrKHR4blJlc3VsdC5lcnJvcik7XG4gICAgfVxuICAgIHZhciB0eG4gPSB0eG5SZXN1bHQudHhuO1xuXG4gICAgdmFyIGRvY1N0b3JlID0gdHhuLm9iamVjdFN0b3JlKERPQ19TVE9SRSk7XG5cbiAgICBkb2NTdG9yZS5nZXQoZG9jSWQpLm9uc3VjY2VzcyA9IGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgdmFyIG1ldGFkYXRhID0gZGVjb2RlTWV0YWRhdGEoZXZlbnQudGFyZ2V0LnJlc3VsdCk7XG4gICAgICBtZXJnZS50cmF2ZXJzZVJldlRyZWUobWV0YWRhdGEucmV2X3RyZWUsIGZ1bmN0aW9uIChpc0xlYWYsIHBvcyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldkhhc2gsIGN0eCwgb3B0cykge1xuICAgICAgICB2YXIgcmV2ID0gcG9zICsgJy0nICsgcmV2SGFzaDtcbiAgICAgICAgaWYgKHJldnMuaW5kZXhPZihyZXYpICE9PSAtMSkge1xuICAgICAgICAgIG9wdHMuc3RhdHVzID0gJ21pc3NpbmcnO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIGNvbXBhY3RSZXZzKHJldnMsIGRvY0lkLCB0eG4pO1xuICAgICAgdmFyIHdpbm5pbmdSZXYgPSBtZXRhZGF0YS53aW5uaW5nUmV2O1xuICAgICAgdmFyIGRlbGV0ZWQgPSBtZXRhZGF0YS5kZWxldGVkO1xuICAgICAgdHhuLm9iamVjdFN0b3JlKERPQ19TVE9SRSkucHV0KFxuICAgICAgICBlbmNvZGVNZXRhZGF0YShtZXRhZGF0YSwgd2lubmluZ1JldiwgZGVsZXRlZCkpO1xuICAgIH07XG4gICAgdHhuLm9uZXJyb3IgPSBpZGJFcnJvcihjYWxsYmFjayk7XG4gICAgdHhuLm9uY29tcGxldGUgPSBmdW5jdGlvbiAoKSB7XG4gICAgICB1dGlscy5jYWxsKGNhbGxiYWNrKTtcbiAgICB9O1xuICB9O1xuXG5cbiAgYXBpLl9nZXRMb2NhbCA9IGZ1bmN0aW9uIChpZCwgY2FsbGJhY2spIHtcbiAgICB2YXIgdHhuUmVzdWx0ID0gb3BlblRyYW5zYWN0aW9uU2FmZWx5KGlkYiwgW0xPQ0FMX1NUT1JFXSwgJ3JlYWRvbmx5Jyk7XG4gICAgaWYgKHR4blJlc3VsdC5lcnJvcikge1xuICAgICAgcmV0dXJuIGNhbGxiYWNrKHR4blJlc3VsdC5lcnJvcik7XG4gICAgfVxuICAgIHZhciB0eCA9IHR4blJlc3VsdC50eG47XG4gICAgdmFyIHJlcSA9IHR4Lm9iamVjdFN0b3JlKExPQ0FMX1NUT1JFKS5nZXQoaWQpO1xuXG4gICAgcmVxLm9uZXJyb3IgPSBpZGJFcnJvcihjYWxsYmFjayk7XG4gICAgcmVxLm9uc3VjY2VzcyA9IGZ1bmN0aW9uIChlKSB7XG4gICAgICB2YXIgZG9jID0gZS50YXJnZXQucmVzdWx0O1xuICAgICAgaWYgKCFkb2MpIHtcbiAgICAgICAgY2FsbGJhY2soZXJyb3JzLmVycm9yKGVycm9ycy5NSVNTSU5HX0RPQykpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZGVsZXRlIGRvY1snX2RvY19pZF9yZXYnXTsgLy8gZm9yIGJhY2t3YXJkcyBjb21wYXRcbiAgICAgICAgY2FsbGJhY2sobnVsbCwgZG9jKTtcbiAgICAgIH1cbiAgICB9O1xuICB9O1xuXG4gIGFwaS5fcHV0TG9jYWwgPSBmdW5jdGlvbiAoZG9jLCBvcHRzLCBjYWxsYmFjaykge1xuICAgIGlmICh0eXBlb2Ygb3B0cyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgY2FsbGJhY2sgPSBvcHRzO1xuICAgICAgb3B0cyA9IHt9O1xuICAgIH1cbiAgICBkZWxldGUgZG9jLl9yZXZpc2lvbnM7IC8vIGlnbm9yZSB0aGlzLCB0cnVzdCB0aGUgcmV2XG4gICAgdmFyIG9sZFJldiA9IGRvYy5fcmV2O1xuICAgIHZhciBpZCA9IGRvYy5faWQ7XG4gICAgaWYgKCFvbGRSZXYpIHtcbiAgICAgIGRvYy5fcmV2ID0gJzAtMSc7XG4gICAgfSBlbHNlIHtcbiAgICAgIGRvYy5fcmV2ID0gJzAtJyArIChwYXJzZUludChvbGRSZXYuc3BsaXQoJy0nKVsxXSwgMTApICsgMSk7XG4gICAgfVxuXG4gICAgdmFyIHR4ID0gb3B0cy5jdHg7XG4gICAgdmFyIHJldDtcbiAgICBpZiAoIXR4KSB7XG4gICAgICB2YXIgdHhuUmVzdWx0ID0gb3BlblRyYW5zYWN0aW9uU2FmZWx5KGlkYiwgW0xPQ0FMX1NUT1JFXSwgJ3JlYWR3cml0ZScpO1xuICAgICAgaWYgKHR4blJlc3VsdC5lcnJvcikge1xuICAgICAgICByZXR1cm4gY2FsbGJhY2sodHhuUmVzdWx0LmVycm9yKTtcbiAgICAgIH1cbiAgICAgIHR4ID0gdHhuUmVzdWx0LnR4bjtcbiAgICAgIHR4Lm9uZXJyb3IgPSBpZGJFcnJvcihjYWxsYmFjayk7XG4gICAgICB0eC5vbmNvbXBsZXRlID0gZnVuY3Rpb24gKCkge1xuICAgICAgICBpZiAocmV0KSB7XG4gICAgICAgICAgY2FsbGJhY2sobnVsbCwgcmV0KTtcbiAgICAgICAgfVxuICAgICAgfTtcbiAgICB9XG5cbiAgICB2YXIgb1N0b3JlID0gdHgub2JqZWN0U3RvcmUoTE9DQUxfU1RPUkUpO1xuICAgIHZhciByZXE7XG4gICAgaWYgKG9sZFJldikge1xuICAgICAgcmVxID0gb1N0b3JlLmdldChpZCk7XG4gICAgICByZXEub25zdWNjZXNzID0gZnVuY3Rpb24gKGUpIHtcbiAgICAgICAgdmFyIG9sZERvYyA9IGUudGFyZ2V0LnJlc3VsdDtcbiAgICAgICAgaWYgKCFvbGREb2MgfHwgb2xkRG9jLl9yZXYgIT09IG9sZFJldikge1xuICAgICAgICAgIGNhbGxiYWNrKGVycm9ycy5lcnJvcihlcnJvcnMuUkVWX0NPTkZMSUNUKSk7XG4gICAgICAgIH0gZWxzZSB7IC8vIHVwZGF0ZVxuICAgICAgICAgIHZhciByZXEgPSBvU3RvcmUucHV0KGRvYyk7XG4gICAgICAgICAgcmVxLm9uc3VjY2VzcyA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHJldCA9IHtvazogdHJ1ZSwgaWQ6IGRvYy5faWQsIHJldjogZG9jLl9yZXZ9O1xuICAgICAgICAgICAgaWYgKG9wdHMuY3R4KSB7IC8vIHJldHVybiBpbW1lZGlhdGVseVxuICAgICAgICAgICAgICBjYWxsYmFjayhudWxsLCByZXQpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgIH07XG4gICAgfSBlbHNlIHsgLy8gbmV3IGRvY1xuICAgICAgcmVxID0gb1N0b3JlLmFkZChkb2MpO1xuICAgICAgcmVxLm9uZXJyb3IgPSBmdW5jdGlvbiAoZSkge1xuICAgICAgICAvLyBjb25zdHJhaW50IGVycm9yLCBhbHJlYWR5IGV4aXN0c1xuICAgICAgICBjYWxsYmFjayhlcnJvcnMuZXJyb3IoZXJyb3JzLlJFVl9DT05GTElDVCkpO1xuICAgICAgICBlLnByZXZlbnREZWZhdWx0KCk7IC8vIGF2b2lkIHRyYW5zYWN0aW9uIGFib3J0XG4gICAgICAgIGUuc3RvcFByb3BhZ2F0aW9uKCk7IC8vIGF2b2lkIHRyYW5zYWN0aW9uIG9uZXJyb3JcbiAgICAgIH07XG4gICAgICByZXEub25zdWNjZXNzID0gZnVuY3Rpb24gKCkge1xuICAgICAgICByZXQgPSB7b2s6IHRydWUsIGlkOiBkb2MuX2lkLCByZXY6IGRvYy5fcmV2fTtcbiAgICAgICAgaWYgKG9wdHMuY3R4KSB7IC8vIHJldHVybiBpbW1lZGlhdGVseVxuICAgICAgICAgIGNhbGxiYWNrKG51bGwsIHJldCk7XG4gICAgICAgIH1cbiAgICAgIH07XG4gICAgfVxuICB9O1xuXG4gIGFwaS5fcmVtb3ZlTG9jYWwgPSBmdW5jdGlvbiAoZG9jLCBjYWxsYmFjaykge1xuICAgIHZhciB0eG5SZXN1bHQgPSBvcGVuVHJhbnNhY3Rpb25TYWZlbHkoaWRiLCBbTE9DQUxfU1RPUkVdLCAncmVhZHdyaXRlJyk7XG4gICAgaWYgKHR4blJlc3VsdC5lcnJvcikge1xuICAgICAgcmV0dXJuIGNhbGxiYWNrKHR4blJlc3VsdC5lcnJvcik7XG4gICAgfVxuICAgIHZhciB0eCA9IHR4blJlc3VsdC50eG47XG4gICAgdmFyIHJldDtcbiAgICB0eC5vbmNvbXBsZXRlID0gZnVuY3Rpb24gKCkge1xuICAgICAgaWYgKHJldCkge1xuICAgICAgICBjYWxsYmFjayhudWxsLCByZXQpO1xuICAgICAgfVxuICAgIH07XG4gICAgdmFyIGlkID0gZG9jLl9pZDtcbiAgICB2YXIgb1N0b3JlID0gdHgub2JqZWN0U3RvcmUoTE9DQUxfU1RPUkUpO1xuICAgIHZhciByZXEgPSBvU3RvcmUuZ2V0KGlkKTtcblxuICAgIHJlcS5vbmVycm9yID0gaWRiRXJyb3IoY2FsbGJhY2spO1xuICAgIHJlcS5vbnN1Y2Nlc3MgPSBmdW5jdGlvbiAoZSkge1xuICAgICAgdmFyIG9sZERvYyA9IGUudGFyZ2V0LnJlc3VsdDtcbiAgICAgIGlmICghb2xkRG9jIHx8IG9sZERvYy5fcmV2ICE9PSBkb2MuX3Jldikge1xuICAgICAgICBjYWxsYmFjayhlcnJvcnMuZXJyb3IoZXJyb3JzLk1JU1NJTkdfRE9DKSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBvU3RvcmVbXCJkZWxldGVcIl0oaWQpO1xuICAgICAgICByZXQgPSB7b2s6IHRydWUsIGlkOiBpZCwgcmV2OiAnMC0wJ307XG4gICAgICB9XG4gICAgfTtcbiAgfTtcblxuICB2YXIgY2FjaGVkID0gY2FjaGVkREJzW2RiTmFtZV07XG5cbiAgaWYgKGNhY2hlZCkge1xuICAgIGlkYiA9IGNhY2hlZC5pZGI7XG4gICAgYXBpLl9tZXRhID0gY2FjaGVkLmdsb2JhbDtcbiAgICBwcm9jZXNzLm5leHRUaWNrKGZ1bmN0aW9uICgpIHtcbiAgICAgIGNhbGxiYWNrKG51bGwsIGFwaSk7XG4gICAgfSk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgdmFyIHJlcSA9IGluZGV4ZWREQi5vcGVuKGRiTmFtZSwgQURBUFRFUl9WRVJTSU9OKTtcblxuICBpZiAoISgnb3BlblJlcUxpc3QnIGluIElkYlBvdWNoKSkge1xuICAgIElkYlBvdWNoLm9wZW5SZXFMaXN0ID0ge307XG4gIH1cbiAgSWRiUG91Y2gub3BlblJlcUxpc3RbZGJOYW1lXSA9IHJlcTtcblxuICByZXEub251cGdyYWRlbmVlZGVkID0gZnVuY3Rpb24gKGUpIHtcbiAgICB2YXIgZGIgPSBlLnRhcmdldC5yZXN1bHQ7XG4gICAgaWYgKGUub2xkVmVyc2lvbiA8IDEpIHtcbiAgICAgIHJldHVybiBjcmVhdGVTY2hlbWEoZGIpOyAvLyBuZXcgZGIsIGluaXRpYWwgc2NoZW1hXG4gICAgfVxuICAgIC8vIGRvIG1pZ3JhdGlvbnNcblxuICAgIHZhciB0eG4gPSBlLmN1cnJlbnRUYXJnZXQudHJhbnNhY3Rpb247XG4gICAgLy8gdGhlc2UgbWlncmF0aW9ucyBoYXZlIHRvIGJlIGRvbmUgaW4gdGhpcyBmdW5jdGlvbiwgYmVmb3JlXG4gICAgLy8gY29udHJvbCBpcyByZXR1cm5lZCB0byB0aGUgZXZlbnQgbG9vcCwgYmVjYXVzZSBJbmRleGVkREJcblxuICAgIGlmIChlLm9sZFZlcnNpb24gPCAzKSB7XG4gICAgICBjcmVhdGVMb2NhbFN0b3JlU2NoZW1hKGRiKTsgLy8gdjIgLT4gdjNcbiAgICB9XG4gICAgaWYgKGUub2xkVmVyc2lvbiA8IDQpIHtcbiAgICAgIGFkZEF0dGFjaEFuZFNlcVN0b3JlKGRiKTsgLy8gdjMgLT4gdjRcbiAgICB9XG5cbiAgICB2YXIgbWlncmF0aW9ucyA9IFtcbiAgICAgIGFkZERlbGV0ZWRPckxvY2FsSW5kZXgsIC8vIHYxIC0+IHYyXG4gICAgICBtaWdyYXRlTG9jYWxTdG9yZSwgICAgICAvLyB2MiAtPiB2M1xuICAgICAgbWlncmF0ZUF0dHNBbmRTZXFzLCAgICAgLy8gdjMgLT4gdjRcbiAgICAgIG1pZ3JhdGVNZXRhZGF0YSAgICAgICAgIC8vIHY0IC0+IHY1XG4gICAgXTtcblxuICAgIHZhciBpID0gZS5vbGRWZXJzaW9uO1xuXG4gICAgZnVuY3Rpb24gbmV4dCgpIHtcbiAgICAgIHZhciBtaWdyYXRpb24gPSBtaWdyYXRpb25zW2kgLSAxXTtcbiAgICAgIGkrKztcbiAgICAgIGlmIChtaWdyYXRpb24pIHtcbiAgICAgICAgbWlncmF0aW9uKHR4biwgbmV4dCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgbmV4dCgpO1xuICB9O1xuXG4gIHJlcS5vbnN1Y2Nlc3MgPSBmdW5jdGlvbiAoZSkge1xuXG4gICAgaWRiID0gZS50YXJnZXQucmVzdWx0O1xuXG4gICAgaWRiLm9udmVyc2lvbmNoYW5nZSA9IGZ1bmN0aW9uICgpIHtcbiAgICAgIGlkYi5jbG9zZSgpO1xuICAgICAgZGVsZXRlIGNhY2hlZERCc1tkYk5hbWVdO1xuICAgIH07XG4gICAgaWRiLm9uYWJvcnQgPSBmdW5jdGlvbiAoKSB7XG4gICAgICBpZGIuY2xvc2UoKTtcbiAgICAgIGRlbGV0ZSBjYWNoZWREQnNbZGJOYW1lXTtcbiAgICB9O1xuXG4gICAgdmFyIHR4biA9IGlkYi50cmFuc2FjdGlvbihbXG4gICAgICAgIE1FVEFfU1RPUkUsXG4gICAgICAgIERFVEVDVF9CTE9CX1NVUFBPUlRfU1RPUkUsXG4gICAgICAgIERPQ19TVE9SRVxuICAgICAgXSwgJ3JlYWR3cml0ZScpO1xuXG4gICAgdmFyIHJlcSA9IHR4bi5vYmplY3RTdG9yZShNRVRBX1NUT1JFKS5nZXQoTUVUQV9TVE9SRSk7XG5cbiAgICB2YXIgYmxvYlN1cHBvcnQgPSBudWxsO1xuICAgIHZhciBkb2NDb3VudCA9IG51bGw7XG4gICAgdmFyIGluc3RhbmNlSWQgPSBudWxsO1xuXG4gICAgcmVxLm9uc3VjY2VzcyA9IGZ1bmN0aW9uIChlKSB7XG5cbiAgICAgIHZhciBjaGVja1NldHVwQ29tcGxldGUgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIGlmIChibG9iU3VwcG9ydCA9PT0gbnVsbCB8fCBkb2NDb3VudCA9PT0gbnVsbCB8fFxuICAgICAgICAgICAgaW5zdGFuY2VJZCA9PT0gbnVsbCkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBhcGkuX21ldGEgPSB7XG4gICAgICAgICAgICBuYW1lOiBkYk5hbWUsXG4gICAgICAgICAgICBpbnN0YW5jZUlkOiBpbnN0YW5jZUlkLFxuICAgICAgICAgICAgYmxvYlN1cHBvcnQ6IGJsb2JTdXBwb3J0LFxuICAgICAgICAgICAgZG9jQ291bnQ6IGRvY0NvdW50XG4gICAgICAgICAgfTtcblxuICAgICAgICAgIGNhY2hlZERCc1tkYk5hbWVdID0ge1xuICAgICAgICAgICAgaWRiOiBpZGIsXG4gICAgICAgICAgICBnbG9iYWw6IGFwaS5fbWV0YVxuICAgICAgICAgIH07XG4gICAgICAgICAgY2FsbGJhY2sobnVsbCwgYXBpKTtcbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgLy9cbiAgICAgIC8vIGZldGNoL3N0b3JlIHRoZSBpZFxuICAgICAgLy9cblxuICAgICAgdmFyIG1ldGEgPSBlLnRhcmdldC5yZXN1bHQgfHwge2lkOiBNRVRBX1NUT1JFfTtcbiAgICAgIGlmIChkYk5hbWUgICsgJ19pZCcgaW4gbWV0YSkge1xuICAgICAgICBpbnN0YW5jZUlkID0gbWV0YVtkYk5hbWUgKyAnX2lkJ107XG4gICAgICAgIGNoZWNrU2V0dXBDb21wbGV0ZSgpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaW5zdGFuY2VJZCA9IHV0aWxzLnV1aWQoKTtcbiAgICAgICAgbWV0YVtkYk5hbWUgKyAnX2lkJ10gPSBpbnN0YW5jZUlkO1xuICAgICAgICB0eG4ub2JqZWN0U3RvcmUoTUVUQV9TVE9SRSkucHV0KG1ldGEpLm9uc3VjY2VzcyA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICBjaGVja1NldHVwQ29tcGxldGUoKTtcbiAgICAgICAgfTtcbiAgICAgIH1cblxuICAgICAgLy9cbiAgICAgIC8vIGNoZWNrIGJsb2Igc3VwcG9ydFxuICAgICAgLy9cblxuICAgICAgaWYgKCFibG9iU3VwcG9ydFByb21pc2UpIHtcbiAgICAgICAgLy8gbWFrZSBzdXJlIGJsb2Igc3VwcG9ydCBpcyBvbmx5IGNoZWNrZWQgb25jZVxuICAgICAgICBibG9iU3VwcG9ydFByb21pc2UgPSBjaGVja0Jsb2JTdXBwb3J0KHR4biwgaWRiKTtcbiAgICAgIH1cblxuICAgICAgYmxvYlN1cHBvcnRQcm9taXNlLnRoZW4oZnVuY3Rpb24gKHZhbCkge1xuICAgICAgICBibG9iU3VwcG9ydCA9IHZhbDtcbiAgICAgICAgY2hlY2tTZXR1cENvbXBsZXRlKCk7XG4gICAgICB9KTtcblxuICAgICAgLy9cbiAgICAgIC8vIGNvdW50IGRvY3NcbiAgICAgIC8vXG5cbiAgICAgIHZhciBpbmRleCA9IHR4bi5vYmplY3RTdG9yZShET0NfU1RPUkUpLmluZGV4KCdkZWxldGVkT3JMb2NhbCcpO1xuICAgICAgaW5kZXguY291bnQoSURCS2V5UmFuZ2Uub25seSgnMCcpKS5vbnN1Y2Nlc3MgPSBmdW5jdGlvbiAoZSkge1xuICAgICAgICBkb2NDb3VudCA9IGUudGFyZ2V0LnJlc3VsdDtcbiAgICAgICAgY2hlY2tTZXR1cENvbXBsZXRlKCk7XG4gICAgICB9O1xuXG4gICAgfTtcbiAgfTtcblxuICByZXEub25lcnJvciA9IGlkYkVycm9yKGNhbGxiYWNrKTtcblxufVxuXG5JZGJQb3VjaC52YWxpZCA9IGZ1bmN0aW9uICgpIHtcbiAgLy8gSXNzdWUgIzI1MzMsIHdlIGZpbmFsbHkgZ2F2ZSB1cCBvbiBkb2luZyBidWdcbiAgLy8gZGV0ZWN0aW9uIGluc3RlYWQgb2YgYnJvd3NlciBzbmlmZmluZy4gU2FmYXJpIGJyb3VnaHQgdXNcbiAgLy8gdG8gb3VyIGtuZWVzLlxuICB2YXIgaXNTYWZhcmkgPSB0eXBlb2Ygb3BlbkRhdGFiYXNlICE9PSAndW5kZWZpbmVkJyAmJlxuICAgIC8oU2FmYXJpfGlQaG9uZXxpUGFkfGlQb2QpLy50ZXN0KG5hdmlnYXRvci51c2VyQWdlbnQpICYmXG4gICAgIS9DaHJvbWUvLnRlc3QobmF2aWdhdG9yLnVzZXJBZ2VudCk7XG5cbiAgLy8gc29tZSBvdXRkYXRlZCBpbXBsZW1lbnRhdGlvbnMgb2YgSURCIHRoYXQgYXBwZWFyIG9uIFNhbXN1bmdcbiAgLy8gYW5kIEhUQyBBbmRyb2lkIGRldmljZXMgPDQuNCBhcmUgbWlzc2luZyBJREJLZXlSYW5nZVxuICByZXR1cm4gIWlzU2FmYXJpICYmIHR5cGVvZiBpbmRleGVkREIgIT09ICd1bmRlZmluZWQnICYmXG4gICAgdHlwZW9mIElEQktleVJhbmdlICE9PSAndW5kZWZpbmVkJztcbn07XG5cbmZ1bmN0aW9uIGRlc3Ryb3kobmFtZSwgb3B0cywgY2FsbGJhY2spIHtcbiAgaWYgKCEoJ29wZW5SZXFMaXN0JyBpbiBJZGJQb3VjaCkpIHtcbiAgICBJZGJQb3VjaC5vcGVuUmVxTGlzdCA9IHt9O1xuICB9XG4gIElkYlBvdWNoLkNoYW5nZXMucmVtb3ZlQWxsTGlzdGVuZXJzKG5hbWUpO1xuXG4gIC8vQ2xvc2Ugb3BlbiByZXF1ZXN0IGZvciBcIm5hbWVcIiBkYXRhYmFzZSB0byBmaXggaWUgZGVsYXkuXG4gIGlmIChJZGJQb3VjaC5vcGVuUmVxTGlzdFtuYW1lXSAmJiBJZGJQb3VjaC5vcGVuUmVxTGlzdFtuYW1lXS5yZXN1bHQpIHtcbiAgICBJZGJQb3VjaC5vcGVuUmVxTGlzdFtuYW1lXS5yZXN1bHQuY2xvc2UoKTtcbiAgICBkZWxldGUgY2FjaGVkREJzW25hbWVdO1xuICB9XG4gIHZhciByZXEgPSBpbmRleGVkREIuZGVsZXRlRGF0YWJhc2UobmFtZSk7XG5cbiAgcmVxLm9uc3VjY2VzcyA9IGZ1bmN0aW9uICgpIHtcbiAgICAvL1JlbW92ZSBvcGVuIHJlcXVlc3QgZnJvbSB0aGUgbGlzdC5cbiAgICBpZiAoSWRiUG91Y2gub3BlblJlcUxpc3RbbmFtZV0pIHtcbiAgICAgIElkYlBvdWNoLm9wZW5SZXFMaXN0W25hbWVdID0gbnVsbDtcbiAgICB9XG4gICAgaWYgKHV0aWxzLmhhc0xvY2FsU3RvcmFnZSgpICYmIChuYW1lIGluIGxvY2FsU3RvcmFnZSkpIHtcbiAgICAgIGRlbGV0ZSBsb2NhbFN0b3JhZ2VbbmFtZV07XG4gICAgfVxuICAgIGNhbGxiYWNrKG51bGwsIHsgJ29rJzogdHJ1ZSB9KTtcbiAgfTtcblxuICByZXEub25lcnJvciA9IGlkYkVycm9yKGNhbGxiYWNrKTtcbn1cblxuSWRiUG91Y2guZGVzdHJveSA9IHV0aWxzLnRvUHJvbWlzZShmdW5jdGlvbiAobmFtZSwgb3B0cywgY2FsbGJhY2spIHtcbiAgdGFza1F1ZXVlLnF1ZXVlLnB1c2goe1xuICAgIGFjdGlvbjogZnVuY3Rpb24gKHRoaXNDYWxsYmFjaykge1xuICAgICAgZGVzdHJveShuYW1lLCBvcHRzLCB0aGlzQ2FsbGJhY2spO1xuICAgIH0sXG4gICAgY2FsbGJhY2s6IGNhbGxiYWNrXG4gIH0pO1xuICBhcHBseU5leHQoKTtcbn0pO1xuXG5JZGJQb3VjaC5DaGFuZ2VzID0gbmV3IHV0aWxzLkNoYW5nZXMoKTtcblxubW9kdWxlLmV4cG9ydHMgPSBJZGJQb3VjaDtcbiIsIm1vZHVsZS5leHBvcnRzID0gWydpZGInLCAnd2Vic3FsJ107IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuLi8uLi91dGlscycpO1xudmFyIGVycm9ycyA9IHJlcXVpcmUoJy4uLy4uL2RlcHMvZXJyb3JzJyk7XG5cbnZhciB3ZWJzcWxVdGlscyA9IHJlcXVpcmUoJy4vd2Vic3FsLXV0aWxzJyk7XG52YXIgd2Vic3FsQ29uc3RhbnRzID0gcmVxdWlyZSgnLi93ZWJzcWwtY29uc3RhbnRzJyk7XG5cbnZhciBET0NfU1RPUkUgPSB3ZWJzcWxDb25zdGFudHMuRE9DX1NUT1JFO1xudmFyIEJZX1NFUV9TVE9SRSA9IHdlYnNxbENvbnN0YW50cy5CWV9TRVFfU1RPUkU7XG52YXIgQVRUQUNIX1NUT1JFID0gd2Vic3FsQ29uc3RhbnRzLkFUVEFDSF9TVE9SRTtcbnZhciBBVFRBQ0hfQU5EX1NFUV9TVE9SRSA9IHdlYnNxbENvbnN0YW50cy5BVFRBQ0hfQU5EX1NFUV9TVE9SRTtcblxudmFyIHNlbGVjdCA9IHdlYnNxbFV0aWxzLnNlbGVjdDtcbnZhciBzdHJpbmdpZnlEb2MgPSB3ZWJzcWxVdGlscy5zdHJpbmdpZnlEb2M7XG52YXIgY29tcGFjdFJldnMgPSB3ZWJzcWxVdGlscy5jb21wYWN0UmV2cztcbnZhciB1bmtub3duRXJyb3IgPSB3ZWJzcWxVdGlscy51bmtub3duRXJyb3I7XG5cbmZ1bmN0aW9uIHdlYnNxbEJ1bGtEb2NzKHJlcSwgb3B0cywgYXBpLCBkYiwgQ2hhbmdlcywgY2FsbGJhY2spIHtcbiAgdmFyIG5ld0VkaXRzID0gb3B0cy5uZXdfZWRpdHM7XG4gIHZhciB1c2VyRG9jcyA9IHJlcS5kb2NzO1xuXG4gIC8vIFBhcnNlIHRoZSBkb2NzLCBnaXZlIHRoZW0gYSBzZXF1ZW5jZSBudW1iZXIgZm9yIHRoZSByZXN1bHRcbiAgdmFyIGRvY0luZm9zID0gdXNlckRvY3MubWFwKGZ1bmN0aW9uIChkb2MpIHtcbiAgICBpZiAoZG9jLl9pZCAmJiB1dGlscy5pc0xvY2FsSWQoZG9jLl9pZCkpIHtcbiAgICAgIHJldHVybiBkb2M7XG4gICAgfVxuICAgIHZhciBuZXdEb2MgPSB1dGlscy5wYXJzZURvYyhkb2MsIG5ld0VkaXRzKTtcbiAgICByZXR1cm4gbmV3RG9jO1xuICB9KTtcblxuICB2YXIgZG9jSW5mb0Vycm9ycyA9IGRvY0luZm9zLmZpbHRlcihmdW5jdGlvbiAoZG9jSW5mbykge1xuICAgIHJldHVybiBkb2NJbmZvLmVycm9yO1xuICB9KTtcbiAgaWYgKGRvY0luZm9FcnJvcnMubGVuZ3RoKSB7XG4gICAgcmV0dXJuIGNhbGxiYWNrKGRvY0luZm9FcnJvcnNbMF0pO1xuICB9XG5cbiAgdmFyIHR4O1xuICB2YXIgcmVzdWx0cyA9IG5ldyBBcnJheShkb2NJbmZvcy5sZW5ndGgpO1xuICB2YXIgZmV0Y2hlZERvY3MgPSBuZXcgdXRpbHMuTWFwKCk7XG5cbiAgdmFyIHByZWNvbmRpdGlvbkVycm9yZWQ7XG4gIGZ1bmN0aW9uIGNvbXBsZXRlKCkge1xuICAgIGlmIChwcmVjb25kaXRpb25FcnJvcmVkKSB7XG4gICAgICByZXR1cm4gY2FsbGJhY2socHJlY29uZGl0aW9uRXJyb3JlZCk7XG4gICAgfVxuICAgIENoYW5nZXMubm90aWZ5KGFwaS5fbmFtZSk7XG4gICAgYXBpLl9kb2NDb3VudCA9IC0xOyAvLyBpbnZhbGlkYXRlXG4gICAgY2FsbGJhY2sobnVsbCwgcmVzdWx0cyk7XG4gIH1cblxuICBmdW5jdGlvbiB2ZXJpZnlBdHRhY2htZW50KGRpZ2VzdCwgY2FsbGJhY2spIHtcbiAgICB2YXIgc3FsID0gJ1NFTEVDVCBjb3VudCgqKSBhcyBjbnQgRlJPTSAnICsgQVRUQUNIX1NUT1JFICtcbiAgICAgICcgV0hFUkUgZGlnZXN0PT8nO1xuICAgIHR4LmV4ZWN1dGVTcWwoc3FsLCBbZGlnZXN0XSwgZnVuY3Rpb24gKHR4LCByZXN1bHQpIHtcbiAgICAgIGlmIChyZXN1bHQucm93cy5pdGVtKDApLmNudCA9PT0gMCkge1xuICAgICAgICB2YXIgZXJyID0gZXJyb3JzLmVycm9yKGVycm9ycy5NSVNTSU5HX1NUVUIsXG4gICAgICAgICAgJ3Vua25vd24gc3R1YiBhdHRhY2htZW50IHdpdGggZGlnZXN0ICcgK1xuICAgICAgICAgIGRpZ2VzdCk7XG4gICAgICAgIGNhbGxiYWNrKGVycik7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjYWxsYmFjaygpO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgZnVuY3Rpb24gdmVyaWZ5QXR0YWNobWVudHMoZmluaXNoKSB7XG4gICAgdmFyIGRpZ2VzdHMgPSBbXTtcbiAgICBkb2NJbmZvcy5mb3JFYWNoKGZ1bmN0aW9uIChkb2NJbmZvKSB7XG4gICAgICBpZiAoZG9jSW5mby5kYXRhICYmIGRvY0luZm8uZGF0YS5fYXR0YWNobWVudHMpIHtcbiAgICAgICAgT2JqZWN0LmtleXMoZG9jSW5mby5kYXRhLl9hdHRhY2htZW50cykuZm9yRWFjaChmdW5jdGlvbiAoZmlsZW5hbWUpIHtcbiAgICAgICAgICB2YXIgYXR0ID0gZG9jSW5mby5kYXRhLl9hdHRhY2htZW50c1tmaWxlbmFtZV07XG4gICAgICAgICAgaWYgKGF0dC5zdHViKSB7XG4gICAgICAgICAgICBkaWdlc3RzLnB1c2goYXR0LmRpZ2VzdCk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICBpZiAoIWRpZ2VzdHMubGVuZ3RoKSB7XG4gICAgICByZXR1cm4gZmluaXNoKCk7XG4gICAgfVxuICAgIHZhciBudW1Eb25lID0gMDtcbiAgICB2YXIgZXJyO1xuXG4gICAgZnVuY3Rpb24gY2hlY2tEb25lKCkge1xuICAgICAgaWYgKCsrbnVtRG9uZSA9PT0gZGlnZXN0cy5sZW5ndGgpIHtcbiAgICAgICAgZmluaXNoKGVycik7XG4gICAgICB9XG4gICAgfVxuICAgIGRpZ2VzdHMuZm9yRWFjaChmdW5jdGlvbiAoZGlnZXN0KSB7XG4gICAgICB2ZXJpZnlBdHRhY2htZW50KGRpZ2VzdCwgZnVuY3Rpb24gKGF0dEVycikge1xuICAgICAgICBpZiAoYXR0RXJyICYmICFlcnIpIHtcbiAgICAgICAgICBlcnIgPSBhdHRFcnI7XG4gICAgICAgIH1cbiAgICAgICAgY2hlY2tEb25lKCk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHdyaXRlRG9jKGRvY0luZm8sIHdpbm5pbmdSZXYsIHdpbm5pbmdSZXZJc0RlbGV0ZWQsIG5ld1JldklzRGVsZXRlZCxcbiAgICAgICAgICAgICAgICAgICAgaXNVcGRhdGUsIGRlbHRhLCByZXN1bHRzSWR4LCBjYWxsYmFjaykge1xuXG4gICAgZnVuY3Rpb24gZmluaXNoKCkge1xuICAgICAgdmFyIGRhdGEgPSBkb2NJbmZvLmRhdGE7XG4gICAgICB2YXIgZGVsZXRlZEludCA9IG5ld1JldklzRGVsZXRlZCA/IDEgOiAwO1xuXG4gICAgICB2YXIgaWQgPSBkYXRhLl9pZDtcbiAgICAgIHZhciByZXYgPSBkYXRhLl9yZXY7XG4gICAgICB2YXIganNvbiA9IHN0cmluZ2lmeURvYyhkYXRhKTtcbiAgICAgIHZhciBzcWwgPSAnSU5TRVJUIElOVE8gJyArIEJZX1NFUV9TVE9SRSArXG4gICAgICAgICcgKGRvY19pZCwgcmV2LCBqc29uLCBkZWxldGVkKSBWQUxVRVMgKD8sID8sID8sID8pOyc7XG4gICAgICB2YXIgc3FsQXJncyA9IFtpZCwgcmV2LCBqc29uLCBkZWxldGVkSW50XTtcblxuICAgICAgLy8gbWFwIHNlcXMgdG8gYXR0YWNobWVudCBkaWdlc3RzLCB3aGljaFxuICAgICAgLy8gd2Ugd2lsbCBuZWVkIGxhdGVyIGR1cmluZyBjb21wYWN0aW9uXG4gICAgICBmdW5jdGlvbiBpbnNlcnRBdHRhY2htZW50TWFwcGluZ3Moc2VxLCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgYXR0c0FkZGVkID0gMDtcbiAgICAgICAgdmFyIGF0dHNUb0FkZCA9IE9iamVjdC5rZXlzKGRhdGEuX2F0dGFjaG1lbnRzIHx8IHt9KTtcblxuICAgICAgICBpZiAoIWF0dHNUb0FkZC5sZW5ndGgpIHtcbiAgICAgICAgICByZXR1cm4gY2FsbGJhY2soKTtcbiAgICAgICAgfVxuICAgICAgICBmdW5jdGlvbiBjaGVja0RvbmUoKSB7XG4gICAgICAgICAgaWYgKCsrYXR0c0FkZGVkID09PSBhdHRzVG9BZGQubGVuZ3RoKSB7XG4gICAgICAgICAgICBjYWxsYmFjaygpO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4gZmFsc2U7IC8vIGFjayBoYW5kbGluZyBhIGNvbnN0cmFpbnQgZXJyb3JcbiAgICAgICAgfVxuICAgICAgICBmdW5jdGlvbiBhZGQoYXR0KSB7XG4gICAgICAgICAgdmFyIHNxbCA9ICdJTlNFUlQgSU5UTyAnICsgQVRUQUNIX0FORF9TRVFfU1RPUkUgK1xuICAgICAgICAgICAgJyAoZGlnZXN0LCBzZXEpIFZBTFVFUyAoPyw/KSc7XG4gICAgICAgICAgdmFyIHNxbEFyZ3MgPSBbZGF0YS5fYXR0YWNobWVudHNbYXR0XS5kaWdlc3QsIHNlcV07XG4gICAgICAgICAgdHguZXhlY3V0ZVNxbChzcWwsIHNxbEFyZ3MsIGNoZWNrRG9uZSwgY2hlY2tEb25lKTtcbiAgICAgICAgICAvLyBzZWNvbmQgY2FsbGJhY2sgaXMgZm9yIGEgY29uc3RhaW50IGVycm9yLCB3aGljaCB3ZSBpZ25vcmVcbiAgICAgICAgICAvLyBiZWNhdXNlIHRoaXMgZG9jaWQvcmV2IGhhcyBhbHJlYWR5IGJlZW4gYXNzb2NpYXRlZCB3aXRoXG4gICAgICAgICAgLy8gdGhlIGRpZ2VzdCAoZS5nLiB3aGVuIG5ld19lZGl0cyA9PSBmYWxzZSlcbiAgICAgICAgfVxuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGF0dHNUb0FkZC5sZW5ndGg7IGkrKykge1xuICAgICAgICAgIGFkZChhdHRzVG9BZGRbaV0pOyAvLyBkbyBpbiBwYXJhbGxlbFxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHR4LmV4ZWN1dGVTcWwoc3FsLCBzcWxBcmdzLCBmdW5jdGlvbiAodHgsIHJlc3VsdCkge1xuICAgICAgICB2YXIgc2VxID0gcmVzdWx0Lmluc2VydElkO1xuICAgICAgICBpbnNlcnRBdHRhY2htZW50TWFwcGluZ3Moc2VxLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgZGF0YVdyaXR0ZW4odHgsIHNlcSk7XG4gICAgICAgIH0pO1xuICAgICAgfSwgZnVuY3Rpb24gKCkge1xuICAgICAgICAvLyBjb25zdHJhaW50IGVycm9yLCByZWNvdmVyIGJ5IHVwZGF0aW5nIGluc3RlYWQgKHNlZSAjMTYzOClcbiAgICAgICAgdmFyIGZldGNoU3FsID0gc2VsZWN0KCdzZXEnLCBCWV9TRVFfU1RPUkUsIG51bGwsXG4gICAgICAgICAgJ2RvY19pZD0/IEFORCByZXY9PycpO1xuICAgICAgICB0eC5leGVjdXRlU3FsKGZldGNoU3FsLCBbaWQsIHJldl0sIGZ1bmN0aW9uICh0eCwgcmVzKSB7XG4gICAgICAgICAgdmFyIHNlcSA9IHJlcy5yb3dzLml0ZW0oMCkuc2VxO1xuICAgICAgICAgIHZhciBzcWwgPSAnVVBEQVRFICcgKyBCWV9TRVFfU1RPUkUgK1xuICAgICAgICAgICAgJyBTRVQganNvbj0/LCBkZWxldGVkPT8gV0hFUkUgZG9jX2lkPT8gQU5EIHJldj0/Oyc7XG4gICAgICAgICAgdmFyIHNxbEFyZ3MgPSBbanNvbiwgZGVsZXRlZEludCwgaWQsIHJldl07XG4gICAgICAgICAgdHguZXhlY3V0ZVNxbChzcWwsIHNxbEFyZ3MsIGZ1bmN0aW9uICh0eCkge1xuICAgICAgICAgICAgaW5zZXJ0QXR0YWNobWVudE1hcHBpbmdzKHNlcSwgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICBkYXRhV3JpdHRlbih0eCwgc2VxKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIGZhbHNlOyAvLyBhY2sgdGhhdCB3ZSd2ZSBoYW5kbGVkIHRoZSBlcnJvclxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gY29sbGVjdFJlc3VsdHMoYXR0YWNobWVudEVycikge1xuICAgICAgaWYgKCFlcnIpIHtcbiAgICAgICAgaWYgKGF0dGFjaG1lbnRFcnIpIHtcbiAgICAgICAgICBlcnIgPSBhdHRhY2htZW50RXJyO1xuICAgICAgICAgIGNhbGxiYWNrKGVycik7XG4gICAgICAgIH0gZWxzZSBpZiAocmVjdiA9PT0gYXR0YWNobWVudHMubGVuZ3RoKSB7XG4gICAgICAgICAgZmluaXNoKCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICB2YXIgZXJyID0gbnVsbDtcbiAgICB2YXIgcmVjdiA9IDA7XG5cbiAgICBkb2NJbmZvLmRhdGEuX2lkID0gZG9jSW5mby5tZXRhZGF0YS5pZDtcbiAgICBkb2NJbmZvLmRhdGEuX3JldiA9IGRvY0luZm8ubWV0YWRhdGEucmV2O1xuICAgIHZhciBhdHRhY2htZW50cyA9IE9iamVjdC5rZXlzKGRvY0luZm8uZGF0YS5fYXR0YWNobWVudHMgfHwge30pO1xuXG5cbiAgICBpZiAobmV3UmV2SXNEZWxldGVkKSB7XG4gICAgICBkb2NJbmZvLmRhdGEuX2RlbGV0ZWQgPSB0cnVlO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGF0dGFjaG1lbnRTYXZlZChlcnIpIHtcbiAgICAgIHJlY3YrKztcbiAgICAgIGNvbGxlY3RSZXN1bHRzKGVycik7XG4gICAgfVxuXG4gICAgYXR0YWNobWVudHMuZm9yRWFjaChmdW5jdGlvbiAoa2V5KSB7XG4gICAgICB2YXIgYXR0ID0gZG9jSW5mby5kYXRhLl9hdHRhY2htZW50c1trZXldO1xuICAgICAgaWYgKCFhdHQuc3R1Yikge1xuICAgICAgICB2YXIgZGF0YSA9IGF0dC5kYXRhO1xuICAgICAgICBkZWxldGUgYXR0LmRhdGE7XG4gICAgICAgIHZhciBkaWdlc3QgPSBhdHQuZGlnZXN0O1xuICAgICAgICBzYXZlQXR0YWNobWVudChkaWdlc3QsIGRhdGEsIGF0dGFjaG1lbnRTYXZlZCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZWN2Kys7XG4gICAgICAgIGNvbGxlY3RSZXN1bHRzKCk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBpZiAoIWF0dGFjaG1lbnRzLmxlbmd0aCkge1xuICAgICAgZmluaXNoKCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gYXV0b0NvbXBhY3QoKSB7XG4gICAgICBpZiAoIWlzVXBkYXRlIHx8ICFhcGkuYXV0b19jb21wYWN0aW9uKSB7XG4gICAgICAgIHJldHVybjsgLy8gbm90aGluZyB0byBkb1xuICAgICAgfVxuICAgICAgdmFyIGlkID0gZG9jSW5mby5tZXRhZGF0YS5pZDtcbiAgICAgIHZhciByZXZzVG9EZWxldGUgPSB1dGlscy5jb21wYWN0VHJlZShkb2NJbmZvLm1ldGFkYXRhKTtcbiAgICAgIGNvbXBhY3RSZXZzKHJldnNUb0RlbGV0ZSwgaWQsIHR4KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBkYXRhV3JpdHRlbih0eCwgc2VxKSB7XG4gICAgICBhdXRvQ29tcGFjdCgpO1xuICAgICAgZG9jSW5mby5tZXRhZGF0YS5zZXEgPSBzZXE7XG4gICAgICBkZWxldGUgZG9jSW5mby5tZXRhZGF0YS5yZXY7XG5cbiAgICAgIHZhciBzcWwgPSBpc1VwZGF0ZSA/XG4gICAgICAnVVBEQVRFICcgKyBET0NfU1RPUkUgK1xuICAgICAgJyBTRVQganNvbj0/LCBtYXhfc2VxPT8sIHdpbm5pbmdzZXE9JyArXG4gICAgICAnKFNFTEVDVCBzZXEgRlJPTSAnICsgQllfU0VRX1NUT1JFICtcbiAgICAgICcgV0hFUkUgZG9jX2lkPScgKyBET0NfU1RPUkUgKyAnLmlkIEFORCByZXY9PykgV0hFUkUgaWQ9PydcbiAgICAgICAgOiAnSU5TRVJUIElOVE8gJyArIERPQ19TVE9SRSArXG4gICAgICAnIChpZCwgd2lubmluZ3NlcSwgbWF4X3NlcSwganNvbikgVkFMVUVTICg/LD8sPyw/KTsnO1xuICAgICAgdmFyIG1ldGFkYXRhU3RyID0gdXRpbHMuc2FmZUpzb25TdHJpbmdpZnkoZG9jSW5mby5tZXRhZGF0YSk7XG4gICAgICB2YXIgaWQgPSBkb2NJbmZvLm1ldGFkYXRhLmlkO1xuICAgICAgdmFyIHBhcmFtcyA9IGlzVXBkYXRlID9cbiAgICAgICAgW21ldGFkYXRhU3RyLCBzZXEsIHdpbm5pbmdSZXYsIGlkXSA6XG4gICAgICAgIFtpZCwgc2VxLCBzZXEsIG1ldGFkYXRhU3RyXTtcbiAgICAgIHR4LmV4ZWN1dGVTcWwoc3FsLCBwYXJhbXMsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgcmVzdWx0c1tyZXN1bHRzSWR4XSA9IHtcbiAgICAgICAgICBvazogdHJ1ZSxcbiAgICAgICAgICBpZDogZG9jSW5mby5tZXRhZGF0YS5pZCxcbiAgICAgICAgICByZXY6IHdpbm5pbmdSZXZcbiAgICAgICAgfTtcbiAgICAgICAgZmV0Y2hlZERvY3Muc2V0KGlkLCBkb2NJbmZvLm1ldGFkYXRhKTtcbiAgICAgICAgY2FsbGJhY2soKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIHByb2Nlc3NEb2NzKCkge1xuICAgIHV0aWxzLnByb2Nlc3NEb2NzKGRvY0luZm9zLCBhcGksIGZldGNoZWREb2NzLFxuICAgICAgdHgsIHJlc3VsdHMsIHdyaXRlRG9jLCBvcHRzKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGZldGNoRXhpc3RpbmdEb2NzKGNhbGxiYWNrKSB7XG4gICAgaWYgKCFkb2NJbmZvcy5sZW5ndGgpIHtcbiAgICAgIHJldHVybiBjYWxsYmFjaygpO1xuICAgIH1cblxuICAgIHZhciBudW1GZXRjaGVkID0gMDtcblxuICAgIGZ1bmN0aW9uIGNoZWNrRG9uZSgpIHtcbiAgICAgIGlmICgrK251bUZldGNoZWQgPT09IGRvY0luZm9zLmxlbmd0aCkge1xuICAgICAgICBjYWxsYmFjaygpO1xuICAgICAgfVxuICAgIH1cblxuICAgIGRvY0luZm9zLmZvckVhY2goZnVuY3Rpb24gKGRvY0luZm8pIHtcbiAgICAgIGlmIChkb2NJbmZvLl9pZCAmJiB1dGlscy5pc0xvY2FsSWQoZG9jSW5mby5faWQpKSB7XG4gICAgICAgIHJldHVybiBjaGVja0RvbmUoKTsgLy8gc2tpcCBsb2NhbCBkb2NzXG4gICAgICB9XG4gICAgICB2YXIgaWQgPSBkb2NJbmZvLm1ldGFkYXRhLmlkO1xuICAgICAgdHguZXhlY3V0ZVNxbCgnU0VMRUNUIGpzb24gRlJPTSAnICsgRE9DX1NUT1JFICtcbiAgICAgICcgV0hFUkUgaWQgPSA/JywgW2lkXSwgZnVuY3Rpb24gKHR4LCByZXN1bHQpIHtcbiAgICAgICAgaWYgKHJlc3VsdC5yb3dzLmxlbmd0aCkge1xuICAgICAgICAgIHZhciBtZXRhZGF0YSA9IHV0aWxzLnNhZmVKc29uUGFyc2UocmVzdWx0LnJvd3MuaXRlbSgwKS5qc29uKTtcbiAgICAgICAgICBmZXRjaGVkRG9jcy5zZXQoaWQsIG1ldGFkYXRhKTtcbiAgICAgICAgfVxuICAgICAgICBjaGVja0RvbmUoKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgZnVuY3Rpb24gc2F2ZUF0dGFjaG1lbnQoZGlnZXN0LCBkYXRhLCBjYWxsYmFjaykge1xuICAgIHZhciBzcWwgPSAnU0VMRUNUIGRpZ2VzdCBGUk9NICcgKyBBVFRBQ0hfU1RPUkUgKyAnIFdIRVJFIGRpZ2VzdD0/JztcbiAgICB0eC5leGVjdXRlU3FsKHNxbCwgW2RpZ2VzdF0sIGZ1bmN0aW9uICh0eCwgcmVzdWx0KSB7XG4gICAgICBpZiAocmVzdWx0LnJvd3MubGVuZ3RoKSB7IC8vIGF0dGFjaG1lbnQgYWxyZWFkeSBleGlzdHNcbiAgICAgICAgcmV0dXJuIGNhbGxiYWNrKCk7XG4gICAgICB9XG4gICAgICAvLyB3ZSBjb3VsZCBqdXN0IGluc2VydCBiZWZvcmUgc2VsZWN0aW5nIGFuZCBjYXRjaCB0aGUgZXJyb3IsXG4gICAgICAvLyBidXQgbXkgaHVuY2ggaXMgdGhhdCBpdCdzIGNoZWFwZXIgbm90IHRvIHNlcmlhbGl6ZSB0aGUgYmxvYlxuICAgICAgLy8gZnJvbSBKUyB0byBDIGlmIHdlIGRvbid0IGhhdmUgdG8gKFRPRE86IGNvbmZpcm0gdGhpcylcbiAgICAgIHNxbCA9ICdJTlNFUlQgSU5UTyAnICsgQVRUQUNIX1NUT1JFICtcbiAgICAgICcgKGRpZ2VzdCwgYm9keSwgZXNjYXBlZCkgVkFMVUVTICg/LD8sMSknO1xuICAgICAgdHguZXhlY3V0ZVNxbChzcWwsIFtkaWdlc3QsIHdlYnNxbFV0aWxzLmVzY2FwZUJsb2IoZGF0YSldLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgIGNhbGxiYWNrKCk7XG4gICAgICB9LCBmdW5jdGlvbiAoKSB7XG4gICAgICAgIC8vIGlnbm9yZSBjb25zdGFpbnQgZXJyb3JzLCBtZWFucyBpdCBhbHJlYWR5IGV4aXN0c1xuICAgICAgICBjYWxsYmFjaygpO1xuICAgICAgICByZXR1cm4gZmFsc2U7IC8vIGFjayB3ZSBoYW5kbGVkIHRoZSBlcnJvclxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICB1dGlscy5wcmVwcm9jZXNzQXR0YWNobWVudHMoZG9jSW5mb3MsICdiaW5hcnknLCBmdW5jdGlvbiAoZXJyKSB7XG4gICAgaWYgKGVycikge1xuICAgICAgcmV0dXJuIGNhbGxiYWNrKGVycik7XG4gICAgfVxuICAgIGRiLnRyYW5zYWN0aW9uKGZ1bmN0aW9uICh0eG4pIHtcbiAgICAgIHR4ID0gdHhuO1xuICAgICAgdmVyaWZ5QXR0YWNobWVudHMoZnVuY3Rpb24gKGVycikge1xuICAgICAgICBpZiAoZXJyKSB7XG4gICAgICAgICAgcHJlY29uZGl0aW9uRXJyb3JlZCA9IGVycjtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBmZXRjaEV4aXN0aW5nRG9jcyhwcm9jZXNzRG9jcyk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0sIHVua25vd25FcnJvcihjYWxsYmFjayksIGNvbXBsZXRlKTtcbiAgfSk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gd2Vic3FsQnVsa0RvY3M7XG4iLCIndXNlIHN0cmljdCc7XG5cbmZ1bmN0aW9uIHF1b3RlKHN0cikge1xuICByZXR1cm4gXCInXCIgKyBzdHIgKyBcIidcIjtcbn1cblxuZXhwb3J0cy5BREFQVEVSX1ZFUlNJT04gPSA3OyAvLyB1c2VkIHRvIG1hbmFnZSBtaWdyYXRpb25zXG5cbi8vIFRoZSBvYmplY3Qgc3RvcmVzIGNyZWF0ZWQgZm9yIGVhY2ggZGF0YWJhc2Vcbi8vIERPQ19TVE9SRSBzdG9yZXMgdGhlIGRvY3VtZW50IG1ldGEgZGF0YSwgaXRzIHJldmlzaW9uIGhpc3RvcnkgYW5kIHN0YXRlXG5leHBvcnRzLkRPQ19TVE9SRSA9IHF1b3RlKCdkb2N1bWVudC1zdG9yZScpO1xuLy8gQllfU0VRX1NUT1JFIHN0b3JlcyBhIHBhcnRpY3VsYXIgdmVyc2lvbiBvZiBhIGRvY3VtZW50LCBrZXllZCBieSBpdHNcbi8vIHNlcXVlbmNlIGlkXG5leHBvcnRzLkJZX1NFUV9TVE9SRSA9IHF1b3RlKCdieS1zZXF1ZW5jZScpO1xuLy8gV2hlcmUgd2Ugc3RvcmUgYXR0YWNobWVudHNcbmV4cG9ydHMuQVRUQUNIX1NUT1JFID0gcXVvdGUoJ2F0dGFjaC1zdG9yZScpO1xuZXhwb3J0cy5MT0NBTF9TVE9SRSA9IHF1b3RlKCdsb2NhbC1zdG9yZScpO1xuZXhwb3J0cy5NRVRBX1NUT1JFID0gcXVvdGUoJ21ldGFkYXRhLXN0b3JlJyk7XG4vLyB3aGVyZSB3ZSBzdG9yZSBtYW55LXRvLW1hbnkgcmVsYXRpb25zIGJldHdlZW4gYXR0YWNobWVudFxuLy8gZGlnZXN0cyBhbmQgc2Vxc1xuZXhwb3J0cy5BVFRBQ0hfQU5EX1NFUV9TVE9SRSA9IHF1b3RlKCdhdHRhY2gtc2VxLXN0b3JlJyk7XG5cbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIHV0aWxzID0gcmVxdWlyZSgnLi4vLi4vdXRpbHMnKTtcbnZhciBlcnJvcnMgPSByZXF1aXJlKCcuLi8uLi9kZXBzL2Vycm9ycycpO1xuXG52YXIgd2Vic3FsQ29uc3RhbnRzID0gcmVxdWlyZSgnLi93ZWJzcWwtY29uc3RhbnRzJyk7XG5cbnZhciBCWV9TRVFfU1RPUkUgPSB3ZWJzcWxDb25zdGFudHMuQllfU0VRX1NUT1JFO1xudmFyIEFUVEFDSF9TVE9SRSA9IHdlYnNxbENvbnN0YW50cy5BVFRBQ0hfU1RPUkU7XG52YXIgQVRUQUNIX0FORF9TRVFfU1RPUkUgPSB3ZWJzcWxDb25zdGFudHMuQVRUQUNIX0FORF9TRVFfU1RPUkU7XG5cbi8vIGVzY2FwZUJsb2IgYW5kIHVuZXNjYXBlQmxvYiBhcmUgd29ya2Fyb3VuZHMgZm9yIGEgd2Vic3FsIGJ1Zzpcbi8vIGh0dHBzOi8vY29kZS5nb29nbGUuY29tL3AvY2hyb21pdW0vaXNzdWVzL2RldGFpbD9pZD00MjI2OTBcbi8vIGh0dHBzOi8vYnVncy53ZWJraXQub3JnL3Nob3dfYnVnLmNnaT9pZD0xMzc2Mzdcbi8vIFRoZSBnb2FsIGlzIHRvIG5ldmVyIGFjdHVhbGx5IGluc2VydCB0aGUgXFx1MDAwMCBjaGFyYWN0ZXJcbi8vIGluIHRoZSBkYXRhYmFzZS5cbmZ1bmN0aW9uIGVzY2FwZUJsb2Ioc3RyKSB7XG4gIHJldHVybiBzdHJcbiAgICAucmVwbGFjZSgvXFx1MDAwMi9nLCAnXFx1MDAwMlxcdTAwMDInKVxuICAgIC5yZXBsYWNlKC9cXHUwMDAxL2csICdcXHUwMDAxXFx1MDAwMicpXG4gICAgLnJlcGxhY2UoL1xcdTAwMDAvZywgJ1xcdTAwMDFcXHUwMDAxJyk7XG59XG5cbmZ1bmN0aW9uIHVuZXNjYXBlQmxvYihzdHIpIHtcbiAgcmV0dXJuIHN0clxuICAgIC5yZXBsYWNlKC9cXHUwMDAxXFx1MDAwMS9nLCAnXFx1MDAwMCcpXG4gICAgLnJlcGxhY2UoL1xcdTAwMDFcXHUwMDAyL2csICdcXHUwMDAxJylcbiAgICAucmVwbGFjZSgvXFx1MDAwMlxcdTAwMDIvZywgJ1xcdTAwMDInKTtcbn1cblxuZnVuY3Rpb24gc3RyaW5naWZ5RG9jKGRvYykge1xuICAvLyBkb24ndCBib3RoZXIgc3RvcmluZyB0aGUgaWQvcmV2LiBpdCB1c2VzIGxvdHMgb2Ygc3BhY2UsXG4gIC8vIGluIHBlcnNpc3RlbnQgbWFwL3JlZHVjZSBlc3BlY2lhbGx5XG4gIGRlbGV0ZSBkb2MuX2lkO1xuICBkZWxldGUgZG9jLl9yZXY7XG4gIHJldHVybiBKU09OLnN0cmluZ2lmeShkb2MpO1xufVxuXG5mdW5jdGlvbiB1bnN0cmluZ2lmeURvYyhkb2MsIGlkLCByZXYpIHtcbiAgZG9jID0gSlNPTi5wYXJzZShkb2MpO1xuICBkb2MuX2lkID0gaWQ7XG4gIGRvYy5fcmV2ID0gcmV2O1xuICByZXR1cm4gZG9jO1xufVxuXG4vLyBxdWVzdGlvbiBtYXJrIGdyb3VwcyBJTiBxdWVyaWVzLCBlLmcuIDMgLT4gJyg/LD8sPyknXG5mdW5jdGlvbiBxTWFya3MobnVtKSB7XG4gIHZhciBzID0gJygnO1xuICB3aGlsZSAobnVtLS0pIHtcbiAgICBzICs9ICc/JztcbiAgICBpZiAobnVtKSB7XG4gICAgICBzICs9ICcsJztcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHMgKyAnKSc7XG59XG5cbmZ1bmN0aW9uIHNlbGVjdChzZWxlY3RvciwgdGFibGUsIGpvaW5lciwgd2hlcmUsIG9yZGVyQnkpIHtcbiAgcmV0dXJuICdTRUxFQ1QgJyArIHNlbGVjdG9yICsgJyBGUk9NICcgK1xuICAgICh0eXBlb2YgdGFibGUgPT09ICdzdHJpbmcnID8gdGFibGUgOiB0YWJsZS5qb2luKCcgSk9JTiAnKSkgK1xuICAgIChqb2luZXIgPyAoJyBPTiAnICsgam9pbmVyKSA6ICcnKSArXG4gICAgKHdoZXJlID8gKCcgV0hFUkUgJyArXG4gICAgKHR5cGVvZiB3aGVyZSA9PT0gJ3N0cmluZycgPyB3aGVyZSA6IHdoZXJlLmpvaW4oJyBBTkQgJykpKSA6ICcnKSArXG4gICAgKG9yZGVyQnkgPyAoJyBPUkRFUiBCWSAnICsgb3JkZXJCeSkgOiAnJyk7XG59XG5cbmZ1bmN0aW9uIGNvbXBhY3RSZXZzKHJldnMsIGRvY0lkLCB0eCkge1xuXG4gIGlmICghcmV2cy5sZW5ndGgpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICB2YXIgbnVtRG9uZSA9IDA7XG4gIHZhciBzZXFzID0gW107XG5cbiAgZnVuY3Rpb24gY2hlY2tEb25lKCkge1xuICAgIGlmICgrK251bURvbmUgPT09IHJldnMubGVuZ3RoKSB7IC8vIGRvbmVcbiAgICAgIGRlbGV0ZU9ycGhhbnMoKTtcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBkZWxldGVPcnBoYW5zKCkge1xuICAgIC8vIGZpbmQgb3JwaGFuZWQgYXR0YWNobWVudCBkaWdlc3RzXG5cbiAgICBpZiAoIXNlcXMubGVuZ3RoKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdmFyIHNxbCA9ICdTRUxFQ1QgRElTVElOQ1QgZGlnZXN0IEFTIGRpZ2VzdCBGUk9NICcgK1xuICAgICAgQVRUQUNIX0FORF9TRVFfU1RPUkUgKyAnIFdIRVJFIHNlcSBJTiAnICsgcU1hcmtzKHNlcXMubGVuZ3RoKTtcblxuICAgIHR4LmV4ZWN1dGVTcWwoc3FsLCBzZXFzLCBmdW5jdGlvbiAodHgsIHJlcykge1xuXG4gICAgICB2YXIgZGlnZXN0c1RvQ2hlY2sgPSBbXTtcbiAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcmVzLnJvd3MubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgZGlnZXN0c1RvQ2hlY2sucHVzaChyZXMucm93cy5pdGVtKGkpLmRpZ2VzdCk7XG4gICAgICB9XG4gICAgICBpZiAoIWRpZ2VzdHNUb0NoZWNrLmxlbmd0aCkge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIHZhciBzcWwgPSAnREVMRVRFIEZST00gJyArIEFUVEFDSF9BTkRfU0VRX1NUT1JFICtcbiAgICAgICAgJyBXSEVSRSBzZXEgSU4gKCcgK1xuICAgICAgICBzZXFzLm1hcChmdW5jdGlvbiAoKSB7IHJldHVybiAnPyc7IH0pLmpvaW4oJywnKSArXG4gICAgICAgICcpJztcbiAgICAgIHR4LmV4ZWN1dGVTcWwoc3FsLCBzZXFzLCBmdW5jdGlvbiAodHgpIHtcblxuICAgICAgICB2YXIgc3FsID0gJ1NFTEVDVCBkaWdlc3QgRlJPTSAnICsgQVRUQUNIX0FORF9TRVFfU1RPUkUgK1xuICAgICAgICAgICcgV0hFUkUgZGlnZXN0IElOICgnICtcbiAgICAgICAgICBkaWdlc3RzVG9DaGVjay5tYXAoZnVuY3Rpb24gKCkgeyByZXR1cm4gJz8nOyB9KS5qb2luKCcsJykgK1xuICAgICAgICAgICcpJztcbiAgICAgICAgdHguZXhlY3V0ZVNxbChzcWwsIGRpZ2VzdHNUb0NoZWNrLCBmdW5jdGlvbiAodHgsIHJlcykge1xuICAgICAgICAgIHZhciBub25PcnBoYW5lZERpZ2VzdHMgPSBuZXcgdXRpbHMuU2V0KCk7XG4gICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCByZXMucm93cy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgbm9uT3JwaGFuZWREaWdlc3RzLmFkZChyZXMucm93cy5pdGVtKGkpLmRpZ2VzdCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGRpZ2VzdHNUb0NoZWNrLmZvckVhY2goZnVuY3Rpb24gKGRpZ2VzdCkge1xuICAgICAgICAgICAgaWYgKG5vbk9ycGhhbmVkRGlnZXN0cy5oYXMoZGlnZXN0KSkge1xuICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0eC5leGVjdXRlU3FsKFxuICAgICAgICAgICAgICAnREVMRVRFIEZST00gJyArIEFUVEFDSF9BTkRfU0VRX1NUT1JFICsgJyBXSEVSRSBkaWdlc3Q9PycsXG4gICAgICAgICAgICAgIFtkaWdlc3RdKTtcbiAgICAgICAgICAgIHR4LmV4ZWN1dGVTcWwoXG4gICAgICAgICAgICAgICdERUxFVEUgRlJPTSAnICsgQVRUQUNIX1NUT1JFICsgJyBXSEVSRSBkaWdlc3Q9PycsIFtkaWdlc3RdKTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIC8vIHVwZGF0ZSBieS1zZXEgYW5kIGF0dGFjaCBzdG9yZXMgaW4gcGFyYWxsZWxcbiAgcmV2cy5mb3JFYWNoKGZ1bmN0aW9uIChyZXYpIHtcbiAgICB2YXIgc3FsID0gJ1NFTEVDVCBzZXEgRlJPTSAnICsgQllfU0VRX1NUT1JFICtcbiAgICAgICcgV0hFUkUgZG9jX2lkPT8gQU5EIHJldj0/JztcblxuICAgIHR4LmV4ZWN1dGVTcWwoc3FsLCBbZG9jSWQsIHJldl0sIGZ1bmN0aW9uICh0eCwgcmVzKSB7XG4gICAgICBpZiAoIXJlcy5yb3dzLmxlbmd0aCkgeyAvLyBhbHJlYWR5IGRlbGV0ZWRcbiAgICAgICAgcmV0dXJuIGNoZWNrRG9uZSgpO1xuICAgICAgfVxuICAgICAgdmFyIHNlcSA9IHJlcy5yb3dzLml0ZW0oMCkuc2VxO1xuICAgICAgc2Vxcy5wdXNoKHNlcSk7XG5cbiAgICAgIHR4LmV4ZWN1dGVTcWwoXG4gICAgICAgICdERUxFVEUgRlJPTSAnICsgQllfU0VRX1NUT1JFICsgJyBXSEVSRSBzZXE9PycsIFtzZXFdLCBjaGVja0RvbmUpO1xuICAgIH0pO1xuICB9KTtcbn1cblxuZnVuY3Rpb24gdW5rbm93bkVycm9yKGNhbGxiYWNrKSB7XG4gIHJldHVybiBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICAvLyBldmVudCBtYXkgYWN0dWFsbHkgYmUgYSBTUUxFcnJvciBvYmplY3QsIHNvIHJlcG9ydCBpcyBhcyBzdWNoXG4gICAgdmFyIGVycm9yTmFtZU1hdGNoID0gZXZlbnQgJiYgZXZlbnQuY29uc3RydWN0b3IudG9TdHJpbmcoKVxuICAgICAgICAubWF0Y2goL2Z1bmN0aW9uIChbXlxcKF0rKS8pO1xuICAgIHZhciBlcnJvck5hbWUgPSAoZXJyb3JOYW1lTWF0Y2ggJiYgZXJyb3JOYW1lTWF0Y2hbMV0pIHx8IGV2ZW50LnR5cGU7XG4gICAgdmFyIGVycm9yUmVhc29uID0gZXZlbnQudGFyZ2V0IHx8IGV2ZW50Lm1lc3NhZ2U7XG4gICAgY2FsbGJhY2soZXJyb3JzLmVycm9yKGVycm9ycy5XU1FfRVJST1IsIGVycm9yUmVhc29uLCBlcnJvck5hbWUpKTtcbiAgfTtcbn1cblxuZnVuY3Rpb24gZ2V0U2l6ZShvcHRzKSB7XG4gIGlmICgnc2l6ZScgaW4gb3B0cykge1xuICAgIC8vIHRyaWdnZXJzIGltbWVkaWF0ZSBwb3B1cCBpbiBpT1MsIGZpeGVzICMyMzQ3XG4gICAgLy8gZS5nLiA1MDAwMDAxIGFza3MgZm9yIDUgTUIsIDEwMDAwMDAxIGFza3MgZm9yIDEwIE1CLFxuICAgIHJldHVybiBvcHRzLnNpemUgKiAxMDAwMDAwO1xuICB9XG4gIC8vIEluIGlPUywgZG9lc24ndCBtYXR0ZXIgYXMgbG9uZyBhcyBpdCdzIDw9IDUwMDAwMDAuXG4gIC8vIEV4Y2VwdCB0aGF0IGlmIHlvdSByZXF1ZXN0IHRvbyBtdWNoLCBvdXIgdGVzdHMgZmFpbFxuICAvLyBiZWNhdXNlIG9mIHRoZSBuYXRpdmUgXCJkbyB5b3UgYWNjZXB0P1wiIHBvcHVwLlxuICAvLyBJbiBBbmRyb2lkIDw9NC4zLCB0aGlzIHZhbHVlIGlzIGFjdHVhbGx5IHVzZWQgYXMgYW5cbiAgLy8gaG9uZXN0LXRvLWdvZCBjZWlsaW5nIGZvciBkYXRhLCBzbyB3ZSBuZWVkIHRvXG4gIC8vIHNldCBpdCB0byBhIGRlY2VudGx5IGhpZ2ggbnVtYmVyLlxuICB2YXIgaXNBbmRyb2lkID0gL0FuZHJvaWQvLnRlc3Qod2luZG93Lm5hdmlnYXRvci51c2VyQWdlbnQpO1xuICByZXR1cm4gaXNBbmRyb2lkID8gNTAwMDAwMCA6IDE7IC8vIGluIFBoYW50b21KUywgaWYgeW91IHVzZSAwIGl0IHdpbGwgY3Jhc2hcbn1cblxuZnVuY3Rpb24gY3JlYXRlT3BlbkRCRnVuY3Rpb24oKSB7XG4gIGlmICh0eXBlb2Ygc3FsaXRlUGx1Z2luICE9PSAndW5kZWZpbmVkJykge1xuICAgIC8vIFRoZSBTUUxpdGUgUGx1Z2luIHN0YXJ0ZWQgZGV2aWF0aW5nIHByZXR0eSBoZWF2aWx5IGZyb20gdGhlXG4gICAgLy8gc3RhbmRhcmQgb3BlbkRhdGFiYXNlKCkgZnVuY3Rpb24sIGFzIHRoZXkgc3RhcnRlZCBhZGRpbmcgbW9yZSBmZWF0dXJlcy5cbiAgICAvLyBJdCdzIGJldHRlciB0byBqdXN0IHVzZSB0aGVpciBcIm5ld1wiIGZvcm1hdCBhbmQgcGFzcyBpbiBhIGJpZyBvbCdcbiAgICAvLyBvcHRpb25zIG9iamVjdC5cbiAgICByZXR1cm4gc3FsaXRlUGx1Z2luLm9wZW5EYXRhYmFzZS5iaW5kKHNxbGl0ZVBsdWdpbik7XG4gIH1cblxuICBpZiAodHlwZW9mIG9wZW5EYXRhYmFzZSAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICByZXR1cm4gZnVuY3Rpb24gb3BlbkRCKG9wdHMpIHtcbiAgICAgIC8vIFRyYWRpdGlvbmFsIFdlYlNRTCBBUElcbiAgICAgIHJldHVybiBvcGVuRGF0YWJhc2Uob3B0cy5uYW1lLCBvcHRzLnZlcnNpb24sIG9wdHMuZGVzY3JpcHRpb24sIG9wdHMuc2l6ZSk7XG4gICAgfTtcbiAgfVxufVxuXG52YXIgY2FjaGVkRGF0YWJhc2VzID0ge307XG5cbmZ1bmN0aW9uIG9wZW5EQihvcHRzKSB7XG5cbiAgdmFyIG9wZW5EQkZ1bmN0aW9uID0gY3JlYXRlT3BlbkRCRnVuY3Rpb24oKTtcblxuICB2YXIgZGIgPSBjYWNoZWREYXRhYmFzZXNbb3B0cy5uYW1lXTtcbiAgaWYgKCFkYikge1xuICAgIGRiID0gY2FjaGVkRGF0YWJhc2VzW29wdHMubmFtZV0gPSBvcGVuREJGdW5jdGlvbihvcHRzKTtcbiAgICBkYi5fc3FsaXRlUGx1Z2luID0gdHlwZW9mIHNxbGl0ZVBsdWdpbiAhPT0gJ3VuZGVmaW5lZCc7XG4gIH1cbiAgcmV0dXJuIGRiO1xufVxuXG5mdW5jdGlvbiB2YWxpZCgpIHtcbiAgLy8gU1FMaXRlUGx1Z2luIGxlYWtzIHRoaXMgZ2xvYmFsIG9iamVjdCwgd2hpY2ggd2UgY2FuIHVzZVxuICAvLyB0byBkZXRlY3QgaWYgaXQncyBpbnN0YWxsZWQgb3Igbm90LiBUaGUgYmVuZWZpdCBpcyB0aGF0IGl0J3NcbiAgLy8gZGVjbGFyZWQgaW1tZWRpYXRlbHksIGJlZm9yZSB0aGUgJ2RldmljZXJlYWR5JyBldmVudCBoYXMgZmlyZWQuXG4gIHJldHVybiB0eXBlb2Ygb3BlbkRhdGFiYXNlICE9PSAndW5kZWZpbmVkJyB8fFxuICAgIHR5cGVvZiBTUUxpdGVQbHVnaW4gIT09ICd1bmRlZmluZWQnO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgZXNjYXBlQmxvYjogZXNjYXBlQmxvYixcbiAgdW5lc2NhcGVCbG9iOiB1bmVzY2FwZUJsb2IsXG4gIHN0cmluZ2lmeURvYzogc3RyaW5naWZ5RG9jLFxuICB1bnN0cmluZ2lmeURvYzogdW5zdHJpbmdpZnlEb2MsXG4gIHFNYXJrczogcU1hcmtzLFxuICBzZWxlY3Q6IHNlbGVjdCxcbiAgY29tcGFjdFJldnM6IGNvbXBhY3RSZXZzLFxuICB1bmtub3duRXJyb3I6IHVua25vd25FcnJvcixcbiAgZ2V0U2l6ZTogZ2V0U2l6ZSxcbiAgb3BlbkRCOiBvcGVuREIsXG4gIHZhbGlkOiB2YWxpZFxufTsiLCIndXNlIHN0cmljdCc7XG5cbnZhciB1dGlscyA9IHJlcXVpcmUoJy4uLy4uL3V0aWxzJyk7XG52YXIgbWVyZ2UgPSByZXF1aXJlKCcuLi8uLi9tZXJnZScpO1xudmFyIGVycm9ycyA9IHJlcXVpcmUoJy4uLy4uL2RlcHMvZXJyb3JzJyk7XG52YXIgcGFyc2VIZXhTdHJpbmcgPSByZXF1aXJlKCcuLi8uLi9kZXBzL3BhcnNlLWhleCcpO1xuXG52YXIgd2Vic3FsQ29uc3RhbnRzID0gcmVxdWlyZSgnLi93ZWJzcWwtY29uc3RhbnRzJyk7XG52YXIgd2Vic3FsVXRpbHMgPSByZXF1aXJlKCcuL3dlYnNxbC11dGlscycpO1xudmFyIHdlYnNxbEJ1bGtEb2NzID0gcmVxdWlyZSgnLi93ZWJzcWwtYnVsay1kb2NzJyk7XG5cbnZhciBBREFQVEVSX1ZFUlNJT04gPSB3ZWJzcWxDb25zdGFudHMuQURBUFRFUl9WRVJTSU9OO1xudmFyIERPQ19TVE9SRSA9IHdlYnNxbENvbnN0YW50cy5ET0NfU1RPUkU7XG52YXIgQllfU0VRX1NUT1JFID0gd2Vic3FsQ29uc3RhbnRzLkJZX1NFUV9TVE9SRTtcbnZhciBBVFRBQ0hfU1RPUkUgPSB3ZWJzcWxDb25zdGFudHMuQVRUQUNIX1NUT1JFO1xudmFyIExPQ0FMX1NUT1JFID0gd2Vic3FsQ29uc3RhbnRzLkxPQ0FMX1NUT1JFO1xudmFyIE1FVEFfU1RPUkUgPSB3ZWJzcWxDb25zdGFudHMuTUVUQV9TVE9SRTtcbnZhciBBVFRBQ0hfQU5EX1NFUV9TVE9SRSA9IHdlYnNxbENvbnN0YW50cy5BVFRBQ0hfQU5EX1NFUV9TVE9SRTtcblxudmFyIHFNYXJrcyA9IHdlYnNxbFV0aWxzLnFNYXJrcztcbnZhciBzdHJpbmdpZnlEb2MgPSB3ZWJzcWxVdGlscy5zdHJpbmdpZnlEb2M7XG52YXIgdW5zdHJpbmdpZnlEb2MgPSB3ZWJzcWxVdGlscy51bnN0cmluZ2lmeURvYztcbnZhciBzZWxlY3QgPSB3ZWJzcWxVdGlscy5zZWxlY3Q7XG52YXIgY29tcGFjdFJldnMgPSB3ZWJzcWxVdGlscy5jb21wYWN0UmV2cztcbnZhciB1bmtub3duRXJyb3IgPSB3ZWJzcWxVdGlscy51bmtub3duRXJyb3I7XG52YXIgZ2V0U2l6ZSA9IHdlYnNxbFV0aWxzLmdldFNpemU7XG52YXIgb3BlbkRCID0gd2Vic3FsVXRpbHMub3BlbkRCO1xuXG5mdW5jdGlvbiBmZXRjaEF0dGFjaG1lbnRzSWZOZWNlc3NhcnkoZG9jLCBvcHRzLCBhcGksIHR4biwgY2IpIHtcbiAgdmFyIGF0dGFjaG1lbnRzID0gT2JqZWN0LmtleXMoZG9jLl9hdHRhY2htZW50cyB8fCB7fSk7XG4gIGlmICghYXR0YWNobWVudHMubGVuZ3RoKSB7XG4gICAgcmV0dXJuIGNiICYmIGNiKCk7XG4gIH1cbiAgdmFyIG51bURvbmUgPSAwO1xuXG4gIGZ1bmN0aW9uIGNoZWNrRG9uZSgpIHtcbiAgICBpZiAoKytudW1Eb25lID09PSBhdHRhY2htZW50cy5sZW5ndGggJiYgY2IpIHtcbiAgICAgIGNiKCk7XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gZmV0Y2hBdHRhY2htZW50KGRvYywgYXR0KSB7XG4gICAgdmFyIGF0dE9iaiA9IGRvYy5fYXR0YWNobWVudHNbYXR0XTtcbiAgICB2YXIgYXR0T3B0cyA9IHtlbmNvZGU6IHRydWUsIGN0eDogdHhufTtcbiAgICBhcGkuX2dldEF0dGFjaG1lbnQoYXR0T2JqLCBhdHRPcHRzLCBmdW5jdGlvbiAoXywgYmFzZTY0KSB7XG4gICAgICBkb2MuX2F0dGFjaG1lbnRzW2F0dF0gPSB1dGlscy5leHRlbmQoXG4gICAgICAgIHV0aWxzLnBpY2soYXR0T2JqLCBbJ2RpZ2VzdCcsICdjb250ZW50X3R5cGUnXSksXG4gICAgICAgIHsgZGF0YTogYmFzZTY0IH1cbiAgICAgICk7XG4gICAgICBjaGVja0RvbmUoKTtcbiAgICB9KTtcbiAgfVxuXG4gIGF0dGFjaG1lbnRzLmZvckVhY2goZnVuY3Rpb24gKGF0dCkge1xuICAgIGlmIChvcHRzLmF0dGFjaG1lbnRzICYmIG9wdHMuaW5jbHVkZV9kb2NzKSB7XG4gICAgICBmZXRjaEF0dGFjaG1lbnQoZG9jLCBhdHQpO1xuICAgIH0gZWxzZSB7XG4gICAgICBkb2MuX2F0dGFjaG1lbnRzW2F0dF0uc3R1YiA9IHRydWU7XG4gICAgICBjaGVja0RvbmUoKTtcbiAgICB9XG4gIH0pO1xufVxuXG52YXIgUE9VQ0hfVkVSU0lPTiA9IDE7XG5cbi8vIHRoZXNlIGluZGV4ZXMgY292ZXIgdGhlIGdyb3VuZCBmb3IgbW9zdCBhbGxEb2NzIHF1ZXJpZXNcbnZhciBCWV9TRVFfU1RPUkVfREVMRVRFRF9JTkRFWF9TUUwgPVxuICAnQ1JFQVRFIElOREVYIElGIE5PVCBFWElTVFMgXFwnYnktc2VxLWRlbGV0ZWQtaWR4XFwnIE9OICcgK1xuICBCWV9TRVFfU1RPUkUgKyAnIChzZXEsIGRlbGV0ZWQpJztcbnZhciBCWV9TRVFfU1RPUkVfRE9DX0lEX1JFVl9JTkRFWF9TUUwgPVxuICAnQ1JFQVRFIFVOSVFVRSBJTkRFWCBJRiBOT1QgRVhJU1RTIFxcJ2J5LXNlcS1kb2MtaWQtcmV2XFwnIE9OICcgK1xuICAgIEJZX1NFUV9TVE9SRSArICcgKGRvY19pZCwgcmV2KSc7XG52YXIgRE9DX1NUT1JFX1dJTk5JTkdTRVFfSU5ERVhfU1FMID1cbiAgJ0NSRUFURSBJTkRFWCBJRiBOT1QgRVhJU1RTIFxcJ2RvYy13aW5uaW5nc2VxLWlkeFxcJyBPTiAnICtcbiAgRE9DX1NUT1JFICsgJyAod2lubmluZ3NlcSknO1xudmFyIEFUVEFDSF9BTkRfU0VRX1NUT1JFX1NFUV9JTkRFWF9TUUwgPVxuICAnQ1JFQVRFIElOREVYIElGIE5PVCBFWElTVFMgXFwnYXR0YWNoLXNlcS1zZXEtaWR4XFwnIE9OICcgK1xuICAgIEFUVEFDSF9BTkRfU0VRX1NUT1JFICsgJyAoc2VxKSc7XG52YXIgQVRUQUNIX0FORF9TRVFfU1RPUkVfQVRUQUNIX0lOREVYX1NRTCA9XG4gICdDUkVBVEUgVU5JUVVFIElOREVYIElGIE5PVCBFWElTVFMgXFwnYXR0YWNoLXNlcS1kaWdlc3QtaWR4XFwnIE9OICcgK1xuICAgIEFUVEFDSF9BTkRfU0VRX1NUT1JFICsgJyAoZGlnZXN0LCBzZXEpJztcblxudmFyIERPQ19TVE9SRV9BTkRfQllfU0VRX0pPSU5FUiA9IEJZX1NFUV9TVE9SRSArXG4gICcuc2VxID0gJyArIERPQ19TVE9SRSArICcud2lubmluZ3NlcSc7XG5cbnZhciBTRUxFQ1RfRE9DUyA9IEJZX1NFUV9TVE9SRSArICcuc2VxIEFTIHNlcSwgJyArXG4gIEJZX1NFUV9TVE9SRSArICcuZGVsZXRlZCBBUyBkZWxldGVkLCAnICtcbiAgQllfU0VRX1NUT1JFICsgJy5qc29uIEFTIGRhdGEsICcgK1xuICBCWV9TRVFfU1RPUkUgKyAnLnJldiBBUyByZXYsICcgK1xuICBET0NfU1RPUkUgKyAnLmpzb24gQVMgbWV0YWRhdGEnO1xuXG5mdW5jdGlvbiBXZWJTcWxQb3VjaChvcHRzLCBjYWxsYmFjaykge1xuICB2YXIgYXBpID0gdGhpcztcbiAgdmFyIGluc3RhbmNlSWQgPSBudWxsO1xuICB2YXIgc2l6ZSA9IGdldFNpemUob3B0cyk7XG4gIHZhciBpZFJlcXVlc3RzID0gW107XG4gIHZhciBlbmNvZGluZztcblxuICBhcGkuX2RvY0NvdW50ID0gLTE7IC8vIGNhY2hlIHNxbGl0ZSBjb3VudCgqKSBmb3IgcGVyZm9ybWFuY2VcbiAgYXBpLl9uYW1lID0gb3B0cy5uYW1lO1xuXG4gIHZhciBkYiA9IG9wZW5EQih7XG4gICAgbmFtZTogYXBpLl9uYW1lLFxuICAgIHZlcnNpb246IFBPVUNIX1ZFUlNJT04sXG4gICAgZGVzY3JpcHRpb246IGFwaS5fbmFtZSxcbiAgICBzaXplOiBzaXplLFxuICAgIGxvY2F0aW9uOiBvcHRzLmxvY2F0aW9uLFxuICAgIGNyZWF0ZUZyb21Mb2NhdGlvbjogb3B0cy5jcmVhdGVGcm9tTG9jYXRpb25cbiAgfSk7XG4gIGlmICghZGIpIHtcbiAgICByZXR1cm4gY2FsbGJhY2soZXJyb3JzLmVycm9yKGVycm9ycy5VTktOT1dOX0VSUk9SKSk7XG4gIH0gZWxzZSBpZiAodHlwZW9mIGRiLnJlYWRUcmFuc2FjdGlvbiAhPT0gJ2Z1bmN0aW9uJykge1xuICAgIC8vIGRvZXNuJ3QgZXhpc3QgaW4gc3FsaXRlIHBsdWdpblxuICAgIGRiLnJlYWRUcmFuc2FjdGlvbiA9IGRiLnRyYW5zYWN0aW9uO1xuICB9XG5cbiAgZnVuY3Rpb24gZGJDcmVhdGVkKCkge1xuICAgIC8vIG5vdGUgdGhlIGRiIG5hbWUgaW4gY2FzZSB0aGUgYnJvd3NlciB1cGdyYWRlcyB0byBpZGJcbiAgICBpZiAodXRpbHMuaGFzTG9jYWxTdG9yYWdlKCkpIHtcbiAgICAgIHdpbmRvdy5sb2NhbFN0b3JhZ2VbJ19wb3VjaF9fd2Vic3FsZGJfJyArIGFwaS5fbmFtZV0gPSB0cnVlO1xuICAgIH1cbiAgICBjYWxsYmFjayhudWxsLCBhcGkpO1xuICB9XG5cbiAgLy8gSW4gdGhpcyBtaWdyYXRpb24sIHdlIGFkZGVkIHRoZSAnZGVsZXRlZCcgYW5kICdsb2NhbCcgY29sdW1ucyB0byB0aGVcbiAgLy8gYnktc2VxIGFuZCBkb2Mgc3RvcmUgdGFibGVzLlxuICAvLyBUbyBwcmVzZXJ2ZSBleGlzdGluZyB1c2VyIGRhdGEsIHdlIHJlLXByb2Nlc3MgYWxsIHRoZSBleGlzdGluZyBKU09OXG4gIC8vIGFuZCBhZGQgdGhlc2UgdmFsdWVzLlxuICAvLyBDYWxsZWQgbWlncmF0aW9uMiBiZWNhdXNlIGl0IGNvcnJlc3BvbmRzIHRvIGFkYXB0ZXIgdmVyc2lvbiAoZGJfdmVyc2lvbikgIzJcbiAgZnVuY3Rpb24gcnVuTWlncmF0aW9uMih0eCwgY2FsbGJhY2spIHtcbiAgICAvLyBpbmRleCB1c2VkIGZvciB0aGUgam9pbiBpbiB0aGUgYWxsRG9jcyBxdWVyeVxuICAgIHR4LmV4ZWN1dGVTcWwoRE9DX1NUT1JFX1dJTk5JTkdTRVFfSU5ERVhfU1FMKTtcblxuICAgIHR4LmV4ZWN1dGVTcWwoJ0FMVEVSIFRBQkxFICcgKyBCWV9TRVFfU1RPUkUgK1xuICAgICAgJyBBREQgQ09MVU1OIGRlbGV0ZWQgVElOWUlOVCgxKSBERUZBVUxUIDAnLCBbXSwgZnVuY3Rpb24gKCkge1xuICAgICAgdHguZXhlY3V0ZVNxbChCWV9TRVFfU1RPUkVfREVMRVRFRF9JTkRFWF9TUUwpO1xuICAgICAgdHguZXhlY3V0ZVNxbCgnQUxURVIgVEFCTEUgJyArIERPQ19TVE9SRSArXG4gICAgICAgICcgQUREIENPTFVNTiBsb2NhbCBUSU5ZSU5UKDEpIERFRkFVTFQgMCcsIFtdLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHR4LmV4ZWN1dGVTcWwoJ0NSRUFURSBJTkRFWCBJRiBOT1QgRVhJU1RTIFxcJ2RvYy1zdG9yZS1sb2NhbC1pZHhcXCcgT04gJyArXG4gICAgICAgICAgRE9DX1NUT1JFICsgJyAobG9jYWwsIGlkKScpO1xuXG4gICAgICAgIHZhciBzcWwgPSAnU0VMRUNUICcgKyBET0NfU1RPUkUgKyAnLndpbm5pbmdzZXEgQVMgc2VxLCAnICsgRE9DX1NUT1JFICtcbiAgICAgICAgICAnLmpzb24gQVMgbWV0YWRhdGEgRlJPTSAnICsgQllfU0VRX1NUT1JFICsgJyBKT0lOICcgKyBET0NfU1RPUkUgK1xuICAgICAgICAgICcgT04gJyArIEJZX1NFUV9TVE9SRSArICcuc2VxID0gJyArIERPQ19TVE9SRSArICcud2lubmluZ3NlcSc7XG5cbiAgICAgICAgdHguZXhlY3V0ZVNxbChzcWwsIFtdLCBmdW5jdGlvbiAodHgsIHJlc3VsdCkge1xuXG4gICAgICAgICAgdmFyIGRlbGV0ZWQgPSBbXTtcbiAgICAgICAgICB2YXIgbG9jYWwgPSBbXTtcblxuICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcmVzdWx0LnJvd3MubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIHZhciBpdGVtID0gcmVzdWx0LnJvd3MuaXRlbShpKTtcbiAgICAgICAgICAgIHZhciBzZXEgPSBpdGVtLnNlcTtcbiAgICAgICAgICAgIHZhciBtZXRhZGF0YSA9IEpTT04ucGFyc2UoaXRlbS5tZXRhZGF0YSk7XG4gICAgICAgICAgICBpZiAodXRpbHMuaXNEZWxldGVkKG1ldGFkYXRhKSkge1xuICAgICAgICAgICAgICBkZWxldGVkLnB1c2goc2VxKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICh1dGlscy5pc0xvY2FsSWQobWV0YWRhdGEuaWQpKSB7XG4gICAgICAgICAgICAgIGxvY2FsLnB1c2gobWV0YWRhdGEuaWQpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICB0eC5leGVjdXRlU3FsKCdVUERBVEUgJyArIERPQ19TVE9SRSArICdTRVQgbG9jYWwgPSAxIFdIRVJFIGlkIElOICcgK1xuICAgICAgICAgICAgcU1hcmtzKGxvY2FsLmxlbmd0aCksIGxvY2FsLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB0eC5leGVjdXRlU3FsKCdVUERBVEUgJyArIEJZX1NFUV9TVE9SRSArXG4gICAgICAgICAgICAgICcgU0VUIGRlbGV0ZWQgPSAxIFdIRVJFIHNlcSBJTiAnICtcbiAgICAgICAgICAgICAgcU1hcmtzKGRlbGV0ZWQubGVuZ3RoKSwgZGVsZXRlZCwgY2FsbGJhY2spO1xuICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgLy8gaW4gdGhpcyBtaWdyYXRpb24sIHdlIG1ha2UgYWxsIHRoZSBsb2NhbCBkb2NzIHVudmVyc2lvbmVkXG4gIGZ1bmN0aW9uIHJ1bk1pZ3JhdGlvbjModHgsIGNhbGxiYWNrKSB7XG4gICAgdmFyIGxvY2FsID0gJ0NSRUFURSBUQUJMRSBJRiBOT1QgRVhJU1RTICcgKyBMT0NBTF9TVE9SRSArXG4gICAgICAnIChpZCBVTklRVUUsIHJldiwganNvbiknO1xuICAgIHR4LmV4ZWN1dGVTcWwobG9jYWwsIFtdLCBmdW5jdGlvbiAoKSB7XG4gICAgICB2YXIgc3FsID0gJ1NFTEVDVCAnICsgRE9DX1NUT1JFICsgJy5pZCBBUyBpZCwgJyArXG4gICAgICAgIEJZX1NFUV9TVE9SRSArICcuanNvbiBBUyBkYXRhICcgK1xuICAgICAgICAnRlJPTSAnICsgQllfU0VRX1NUT1JFICsgJyBKT0lOICcgK1xuICAgICAgICBET0NfU1RPUkUgKyAnIE9OICcgKyBCWV9TRVFfU1RPUkUgKyAnLnNlcSA9ICcgK1xuICAgICAgICBET0NfU1RPUkUgKyAnLndpbm5pbmdzZXEgV0hFUkUgbG9jYWwgPSAxJztcbiAgICAgIHR4LmV4ZWN1dGVTcWwoc3FsLCBbXSwgZnVuY3Rpb24gKHR4LCByZXMpIHtcbiAgICAgICAgdmFyIHJvd3MgPSBbXTtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCByZXMucm93cy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgIHJvd3MucHVzaChyZXMucm93cy5pdGVtKGkpKTtcbiAgICAgICAgfVxuICAgICAgICBmdW5jdGlvbiBkb05leHQoKSB7XG4gICAgICAgICAgaWYgKCFyb3dzLmxlbmd0aCkge1xuICAgICAgICAgICAgcmV0dXJuIGNhbGxiYWNrKHR4KTtcbiAgICAgICAgICB9XG4gICAgICAgICAgdmFyIHJvdyA9IHJvd3Muc2hpZnQoKTtcbiAgICAgICAgICB2YXIgcmV2ID0gSlNPTi5wYXJzZShyb3cuZGF0YSkuX3JldjtcbiAgICAgICAgICB0eC5leGVjdXRlU3FsKCdJTlNFUlQgSU5UTyAnICsgTE9DQUxfU1RPUkUgK1xuICAgICAgICAgICAgICAnIChpZCwgcmV2LCBqc29uKSBWQUxVRVMgKD8sPyw/KScsXG4gICAgICAgICAgICAgIFtyb3cuaWQsIHJldiwgcm93LmRhdGFdLCBmdW5jdGlvbiAodHgpIHtcbiAgICAgICAgICAgIHR4LmV4ZWN1dGVTcWwoJ0RFTEVURSBGUk9NICcgKyBET0NfU1RPUkUgKyAnIFdIRVJFIGlkPT8nLFxuICAgICAgICAgICAgICAgIFtyb3cuaWRdLCBmdW5jdGlvbiAodHgpIHtcbiAgICAgICAgICAgICAgdHguZXhlY3V0ZVNxbCgnREVMRVRFIEZST00gJyArIEJZX1NFUV9TVE9SRSArICcgV0hFUkUgc2VxPT8nLFxuICAgICAgICAgICAgICAgICAgW3Jvdy5zZXFdLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgZG9OZXh0KCk7XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgZG9OZXh0KCk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIC8vIGluIHRoaXMgbWlncmF0aW9uLCB3ZSByZW1vdmUgZG9jX2lkX3JldiBhbmQganVzdCB1c2UgcmV2XG4gIGZ1bmN0aW9uIHJ1bk1pZ3JhdGlvbjQodHgsIGNhbGxiYWNrKSB7XG5cbiAgICBmdW5jdGlvbiB1cGRhdGVSb3dzKHJvd3MpIHtcbiAgICAgIGZ1bmN0aW9uIGRvTmV4dCgpIHtcbiAgICAgICAgaWYgKCFyb3dzLmxlbmd0aCkge1xuICAgICAgICAgIHJldHVybiBjYWxsYmFjayh0eCk7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHJvdyA9IHJvd3Muc2hpZnQoKTtcbiAgICAgICAgdmFyIGRvY19pZF9yZXYgPSBwYXJzZUhleFN0cmluZyhyb3cuaGV4LCBlbmNvZGluZyk7XG4gICAgICAgIHZhciBpZHggPSBkb2NfaWRfcmV2Lmxhc3RJbmRleE9mKCc6OicpO1xuICAgICAgICB2YXIgZG9jX2lkID0gZG9jX2lkX3Jldi5zdWJzdHJpbmcoMCwgaWR4KTtcbiAgICAgICAgdmFyIHJldiA9IGRvY19pZF9yZXYuc3Vic3RyaW5nKGlkeCArIDIpO1xuICAgICAgICB2YXIgc3FsID0gJ1VQREFURSAnICsgQllfU0VRX1NUT1JFICtcbiAgICAgICAgICAnIFNFVCBkb2NfaWQ9PywgcmV2PT8gV0hFUkUgZG9jX2lkX3Jldj0/JztcbiAgICAgICAgdHguZXhlY3V0ZVNxbChzcWwsIFtkb2NfaWQsIHJldiwgZG9jX2lkX3Jldl0sIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICBkb05leHQoKTtcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgICBkb05leHQoKTtcbiAgICB9XG5cbiAgICB2YXIgc3FsID0gJ0FMVEVSIFRBQkxFICcgKyBCWV9TRVFfU1RPUkUgKyAnIEFERCBDT0xVTU4gZG9jX2lkJztcbiAgICB0eC5leGVjdXRlU3FsKHNxbCwgW10sIGZ1bmN0aW9uICh0eCkge1xuICAgICAgdmFyIHNxbCA9ICdBTFRFUiBUQUJMRSAnICsgQllfU0VRX1NUT1JFICsgJyBBREQgQ09MVU1OIHJldic7XG4gICAgICB0eC5leGVjdXRlU3FsKHNxbCwgW10sIGZ1bmN0aW9uICh0eCkge1xuICAgICAgICB0eC5leGVjdXRlU3FsKEJZX1NFUV9TVE9SRV9ET0NfSURfUkVWX0lOREVYX1NRTCwgW10sIGZ1bmN0aW9uICh0eCkge1xuICAgICAgICAgIHZhciBzcWwgPSAnU0VMRUNUIGhleChkb2NfaWRfcmV2KSBhcyBoZXggRlJPTSAnICsgQllfU0VRX1NUT1JFO1xuICAgICAgICAgIHR4LmV4ZWN1dGVTcWwoc3FsLCBbXSwgZnVuY3Rpb24gKHR4LCByZXMpIHtcbiAgICAgICAgICAgIHZhciByb3dzID0gW107XG4gICAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHJlcy5yb3dzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICAgIHJvd3MucHVzaChyZXMucm93cy5pdGVtKGkpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHVwZGF0ZVJvd3Mocm93cyk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICAvLyBpbiB0aGlzIG1pZ3JhdGlvbiwgd2UgYWRkIHRoZSBhdHRhY2hfYW5kX3NlcSB0YWJsZVxuICAvLyBmb3IgaXNzdWUgIzI4MThcbiAgZnVuY3Rpb24gcnVuTWlncmF0aW9uNSh0eCwgY2FsbGJhY2spIHtcblxuICAgIGZ1bmN0aW9uIG1pZ3JhdGVBdHRzQW5kU2Vxcyh0eCkge1xuICAgICAgLy8gbmVlZCB0byBhY3R1YWxseSBwb3B1bGF0ZSB0aGUgdGFibGUuIHRoaXMgaXMgdGhlIGV4cGVuc2l2ZSBwYXJ0LFxuICAgICAgLy8gc28gYXMgYW4gb3B0aW1pemF0aW9uLCBjaGVjayBmaXJzdCB0aGF0IHRoaXMgZGF0YWJhc2UgZXZlblxuICAgICAgLy8gY29udGFpbnMgYXR0YWNobWVudHNcbiAgICAgIHZhciBzcWwgPSAnU0VMRUNUIENPVU5UKCopIEFTIGNudCBGUk9NICcgKyBBVFRBQ0hfU1RPUkU7XG4gICAgICB0eC5leGVjdXRlU3FsKHNxbCwgW10sIGZ1bmN0aW9uICh0eCwgcmVzKSB7XG4gICAgICAgIHZhciBjb3VudCA9IHJlcy5yb3dzLml0ZW0oMCkuY250O1xuICAgICAgICBpZiAoIWNvdW50KSB7XG4gICAgICAgICAgcmV0dXJuIGNhbGxiYWNrKHR4KTtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBvZmZzZXQgPSAwO1xuICAgICAgICB2YXIgcGFnZVNpemUgPSAxMDtcbiAgICAgICAgZnVuY3Rpb24gbmV4dFBhZ2UoKSB7XG4gICAgICAgICAgdmFyIHNxbCA9IHNlbGVjdChcbiAgICAgICAgICAgIFNFTEVDVF9ET0NTICsgJywgJyArIERPQ19TVE9SRSArICcuaWQgQVMgaWQnLFxuICAgICAgICAgICAgW0RPQ19TVE9SRSwgQllfU0VRX1NUT1JFXSxcbiAgICAgICAgICAgIERPQ19TVE9SRV9BTkRfQllfU0VRX0pPSU5FUixcbiAgICAgICAgICAgIG51bGwsXG4gICAgICAgICAgICBET0NfU1RPUkUgKyAnLmlkICdcbiAgICAgICAgICApO1xuICAgICAgICAgIHNxbCArPSAnIExJTUlUICcgKyBwYWdlU2l6ZSArICcgT0ZGU0VUICcgKyBvZmZzZXQ7XG4gICAgICAgICAgb2Zmc2V0ICs9IHBhZ2VTaXplO1xuICAgICAgICAgIHR4LmV4ZWN1dGVTcWwoc3FsLCBbXSwgZnVuY3Rpb24gKHR4LCByZXMpIHtcbiAgICAgICAgICAgIGlmICghcmVzLnJvd3MubGVuZ3RoKSB7XG4gICAgICAgICAgICAgIHJldHVybiBjYWxsYmFjayh0eCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB2YXIgZGlnZXN0U2VxcyA9IHt9O1xuICAgICAgICAgICAgZnVuY3Rpb24gYWRkRGlnZXN0U2VxKGRpZ2VzdCwgc2VxKSB7XG4gICAgICAgICAgICAgIC8vIHVuaXEgZGlnZXN0L3NlcSBwYWlycywganVzdCBpbiBjYXNlIHRoZXJlIGFyZSBkdXBzXG4gICAgICAgICAgICAgIHZhciBzZXFzID0gZGlnZXN0U2Vxc1tkaWdlc3RdID0gKGRpZ2VzdFNlcXNbZGlnZXN0XSB8fCBbXSk7XG4gICAgICAgICAgICAgIGlmIChzZXFzLmluZGV4T2Yoc2VxKSA9PT0gLTEpIHtcbiAgICAgICAgICAgICAgICBzZXFzLnB1c2goc2VxKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCByZXMucm93cy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgICB2YXIgcm93ID0gcmVzLnJvd3MuaXRlbShpKTtcbiAgICAgICAgICAgICAgdmFyIGRvYyA9IHVuc3RyaW5naWZ5RG9jKHJvdy5kYXRhLCByb3cuaWQsIHJvdy5yZXYpO1xuICAgICAgICAgICAgICB2YXIgYXR0cyA9IE9iamVjdC5rZXlzKGRvYy5fYXR0YWNobWVudHMgfHwge30pO1xuICAgICAgICAgICAgICBmb3IgKHZhciBqID0gMDsgaiA8IGF0dHMubGVuZ3RoOyBqKyspIHtcbiAgICAgICAgICAgICAgICB2YXIgYXR0ID0gZG9jLl9hdHRhY2htZW50c1thdHRzW2pdXTtcbiAgICAgICAgICAgICAgICBhZGREaWdlc3RTZXEoYXR0LmRpZ2VzdCwgcm93LnNlcSk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHZhciBkaWdlc3RTZXFQYWlycyA9IFtdO1xuICAgICAgICAgICAgT2JqZWN0LmtleXMoZGlnZXN0U2VxcykuZm9yRWFjaChmdW5jdGlvbiAoZGlnZXN0KSB7XG4gICAgICAgICAgICAgIHZhciBzZXFzID0gZGlnZXN0U2Vxc1tkaWdlc3RdO1xuICAgICAgICAgICAgICBzZXFzLmZvckVhY2goZnVuY3Rpb24gKHNlcSkge1xuICAgICAgICAgICAgICAgIGRpZ2VzdFNlcVBhaXJzLnB1c2goW2RpZ2VzdCwgc2VxXSk7XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBpZiAoIWRpZ2VzdFNlcVBhaXJzLmxlbmd0aCkge1xuICAgICAgICAgICAgICByZXR1cm4gbmV4dFBhZ2UoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHZhciBudW1Eb25lID0gMDtcbiAgICAgICAgICAgIGRpZ2VzdFNlcVBhaXJzLmZvckVhY2goZnVuY3Rpb24gKHBhaXIpIHtcbiAgICAgICAgICAgICAgdmFyIHNxbCA9ICdJTlNFUlQgSU5UTyAnICsgQVRUQUNIX0FORF9TRVFfU1RPUkUgK1xuICAgICAgICAgICAgICAgICcgKGRpZ2VzdCwgc2VxKSBWQUxVRVMgKD8sPyknO1xuICAgICAgICAgICAgICB0eC5leGVjdXRlU3FsKHNxbCwgcGFpciwgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIGlmICgrK251bURvbmUgPT09IGRpZ2VzdFNlcVBhaXJzLmxlbmd0aCkge1xuICAgICAgICAgICAgICAgICAgbmV4dFBhZ2UoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgbmV4dFBhZ2UoKTtcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIHZhciBhdHRhY2hBbmRSZXYgPSAnQ1JFQVRFIFRBQkxFIElGIE5PVCBFWElTVFMgJyArXG4gICAgICBBVFRBQ0hfQU5EX1NFUV9TVE9SRSArICcgKGRpZ2VzdCwgc2VxIElOVEVHRVIpJztcbiAgICB0eC5leGVjdXRlU3FsKGF0dGFjaEFuZFJldiwgW10sIGZ1bmN0aW9uICh0eCkge1xuICAgICAgdHguZXhlY3V0ZVNxbChcbiAgICAgICAgQVRUQUNIX0FORF9TRVFfU1RPUkVfQVRUQUNIX0lOREVYX1NRTCwgW10sIGZ1bmN0aW9uICh0eCkge1xuICAgICAgICAgIHR4LmV4ZWN1dGVTcWwoXG4gICAgICAgICAgICBBVFRBQ0hfQU5EX1NFUV9TVE9SRV9TRVFfSU5ERVhfU1FMLCBbXSxcbiAgICAgICAgICAgIG1pZ3JhdGVBdHRzQW5kU2Vxcyk7XG4gICAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgLy8gaW4gdGhpcyBtaWdyYXRpb24sIHdlIHVzZSBlc2NhcGVCbG9iKCkgYW5kIHVuZXNjYXBlQmxvYigpXG4gIC8vIGluc3RlYWQgb2YgcmVhZGluZyBvdXQgdGhlIGJpbmFyeSBhcyBIRVgsIHdoaWNoIGlzIHNsb3dcbiAgZnVuY3Rpb24gcnVuTWlncmF0aW9uNih0eCwgY2FsbGJhY2spIHtcbiAgICB2YXIgc3FsID0gJ0FMVEVSIFRBQkxFICcgKyBBVFRBQ0hfU1RPUkUgK1xuICAgICAgJyBBREQgQ09MVU1OIGVzY2FwZWQgVElOWUlOVCgxKSBERUZBVUxUIDAnO1xuICAgIHR4LmV4ZWN1dGVTcWwoc3FsLCBbXSwgY2FsbGJhY2spO1xuICB9XG5cbiAgLy8gaXNzdWUgIzMxMzYsIGluIHRoaXMgbWlncmF0aW9uIHdlIG5lZWQgYSBcImxhdGVzdCBzZXFcIiBhcyB3ZWxsXG4gIC8vIGFzIHRoZSBcIndpbm5pbmcgc2VxXCIgaW4gdGhlIGRvYyBzdG9yZVxuICBmdW5jdGlvbiBydW5NaWdyYXRpb243KHR4LCBjYWxsYmFjaykge1xuICAgIHZhciBzcWwgPSAnQUxURVIgVEFCTEUgJyArIERPQ19TVE9SRSArXG4gICAgICAnIEFERCBDT0xVTU4gbWF4X3NlcSBJTlRFR0VSJztcbiAgICB0eC5leGVjdXRlU3FsKHNxbCwgW10sIGZ1bmN0aW9uICh0eCkge1xuICAgICAgdmFyIHNxbCA9ICdVUERBVEUgJyArIERPQ19TVE9SRSArICcgU0VUIG1heF9zZXE9KFNFTEVDVCBNQVgoc2VxKSBGUk9NICcgK1xuICAgICAgICBCWV9TRVFfU1RPUkUgKyAnIFdIRVJFIGRvY19pZD1pZCknO1xuICAgICAgdHguZXhlY3V0ZVNxbChzcWwsIFtdLCBmdW5jdGlvbiAodHgpIHtcbiAgICAgICAgLy8gYWRkIHVuaXF1ZSBpbmRleCBhZnRlciBmaWxsaW5nLCBlbHNlIHdlJ2xsIGdldCBhIGNvbnN0cmFpbnRcbiAgICAgICAgLy8gZXJyb3Igd2hlbiB3ZSBkbyB0aGUgQUxURVIgVEFCTEVcbiAgICAgICAgdmFyIHNxbCA9XG4gICAgICAgICAgJ0NSRUFURSBVTklRVUUgSU5ERVggSUYgTk9UIEVYSVNUUyBcXCdkb2MtbWF4LXNlcS1pZHhcXCcgT04gJyArXG4gICAgICAgICAgRE9DX1NUT1JFICsgJyAobWF4X3NlcSknO1xuICAgICAgICB0eC5leGVjdXRlU3FsKHNxbCwgW10sIGNhbGxiYWNrKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgZnVuY3Rpb24gY2hlY2tFbmNvZGluZyh0eCwgY2IpIHtcbiAgICAvLyBVVEYtOCBvbiBjaHJvbWUvYW5kcm9pZCwgVVRGLTE2IG9uIHNhZmFyaSA8IDcuMVxuICAgIHR4LmV4ZWN1dGVTcWwoJ1NFTEVDVCBIRVgoXCJhXCIpIEFTIGhleCcsIFtdLCBmdW5jdGlvbiAodHgsIHJlcykge1xuICAgICAgICB2YXIgaGV4ID0gcmVzLnJvd3MuaXRlbSgwKS5oZXg7XG4gICAgICAgIGVuY29kaW5nID0gaGV4Lmxlbmd0aCA9PT0gMiA/ICdVVEYtOCcgOiAnVVRGLTE2JztcbiAgICAgICAgY2IoKTtcbiAgICAgIH1cbiAgICApO1xuICB9XG5cbiAgZnVuY3Rpb24gb25HZXRJbnN0YW5jZUlkKCkge1xuICAgIHdoaWxlIChpZFJlcXVlc3RzLmxlbmd0aCA+IDApIHtcbiAgICAgIHZhciBpZENhbGxiYWNrID0gaWRSZXF1ZXN0cy5wb3AoKTtcbiAgICAgIGlkQ2FsbGJhY2sobnVsbCwgaW5zdGFuY2VJZCk7XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gb25HZXRWZXJzaW9uKHR4LCBkYlZlcnNpb24pIHtcbiAgICBpZiAoZGJWZXJzaW9uID09PSAwKSB7XG4gICAgICAvLyBpbml0aWFsIHNjaGVtYVxuXG4gICAgICB2YXIgbWV0YSA9ICdDUkVBVEUgVEFCTEUgSUYgTk9UIEVYSVNUUyAnICsgTUVUQV9TVE9SRSArXG4gICAgICAgICcgKGRiaWQsIGRiX3ZlcnNpb24gSU5URUdFUiknO1xuICAgICAgdmFyIGF0dGFjaCA9ICdDUkVBVEUgVEFCTEUgSUYgTk9UIEVYSVNUUyAnICsgQVRUQUNIX1NUT1JFICtcbiAgICAgICAgJyAoZGlnZXN0IFVOSVFVRSwgZXNjYXBlZCBUSU5ZSU5UKDEpLCBib2R5IEJMT0IpJztcbiAgICAgIHZhciBhdHRhY2hBbmRSZXYgPSAnQ1JFQVRFIFRBQkxFIElGIE5PVCBFWElTVFMgJyArXG4gICAgICAgIEFUVEFDSF9BTkRfU0VRX1NUT1JFICsgJyAoZGlnZXN0LCBzZXEgSU5URUdFUiknO1xuICAgICAgLy8gVE9ETzogbWlncmF0ZSB3aW5uaW5nc2VxIHRvIElOVEVHRVJcbiAgICAgIHZhciBkb2MgPSAnQ1JFQVRFIFRBQkxFIElGIE5PVCBFWElTVFMgJyArIERPQ19TVE9SRSArXG4gICAgICAgICcgKGlkIHVuaXF1ZSwganNvbiwgd2lubmluZ3NlcSwgbWF4X3NlcSBJTlRFR0VSIFVOSVFVRSknO1xuICAgICAgdmFyIHNlcSA9ICdDUkVBVEUgVEFCTEUgSUYgTk9UIEVYSVNUUyAnICsgQllfU0VRX1NUT1JFICtcbiAgICAgICAgJyAoc2VxIElOVEVHRVIgTk9UIE5VTEwgUFJJTUFSWSBLRVkgQVVUT0lOQ1JFTUVOVCwgJyArXG4gICAgICAgICdqc29uLCBkZWxldGVkIFRJTllJTlQoMSksIGRvY19pZCwgcmV2KSc7XG4gICAgICB2YXIgbG9jYWwgPSAnQ1JFQVRFIFRBQkxFIElGIE5PVCBFWElTVFMgJyArIExPQ0FMX1NUT1JFICtcbiAgICAgICAgJyAoaWQgVU5JUVVFLCByZXYsIGpzb24pJztcblxuICAgICAgLy8gY3JlYXRlc1xuICAgICAgdHguZXhlY3V0ZVNxbChhdHRhY2gpO1xuICAgICAgdHguZXhlY3V0ZVNxbChsb2NhbCk7XG4gICAgICB0eC5leGVjdXRlU3FsKGF0dGFjaEFuZFJldiwgW10sIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdHguZXhlY3V0ZVNxbChBVFRBQ0hfQU5EX1NFUV9TVE9SRV9TRVFfSU5ERVhfU1FMKTtcbiAgICAgICAgdHguZXhlY3V0ZVNxbChBVFRBQ0hfQU5EX1NFUV9TVE9SRV9BVFRBQ0hfSU5ERVhfU1FMKTtcbiAgICAgIH0pO1xuICAgICAgdHguZXhlY3V0ZVNxbChkb2MsIFtdLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHR4LmV4ZWN1dGVTcWwoRE9DX1NUT1JFX1dJTk5JTkdTRVFfSU5ERVhfU1FMKTtcbiAgICAgICAgdHguZXhlY3V0ZVNxbChzZXEsIFtdLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgdHguZXhlY3V0ZVNxbChCWV9TRVFfU1RPUkVfREVMRVRFRF9JTkRFWF9TUUwpO1xuICAgICAgICAgIHR4LmV4ZWN1dGVTcWwoQllfU0VRX1NUT1JFX0RPQ19JRF9SRVZfSU5ERVhfU1FMKTtcbiAgICAgICAgICB0eC5leGVjdXRlU3FsKG1ldGEsIFtdLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAvLyBtYXJrIHRoZSBkYiB2ZXJzaW9uLCBhbmQgbmV3IGRiaWRcbiAgICAgICAgICAgIHZhciBpbml0U2VxID0gJ0lOU0VSVCBJTlRPICcgKyBNRVRBX1NUT1JFICtcbiAgICAgICAgICAgICAgJyAoZGJfdmVyc2lvbiwgZGJpZCkgVkFMVUVTICg/LD8pJztcbiAgICAgICAgICAgIGluc3RhbmNlSWQgPSB1dGlscy51dWlkKCk7XG4gICAgICAgICAgICB2YXIgaW5pdFNlcUFyZ3MgPSBbQURBUFRFUl9WRVJTSU9OLCBpbnN0YW5jZUlkXTtcbiAgICAgICAgICAgIHR4LmV4ZWN1dGVTcWwoaW5pdFNlcSwgaW5pdFNlcUFyZ3MsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgb25HZXRJbnN0YW5jZUlkKCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9IGVsc2UgeyAvLyB2ZXJzaW9uID4gMFxuXG4gICAgICB2YXIgc2V0dXBEb25lID0gZnVuY3Rpb24gKCkge1xuICAgICAgICB2YXIgbWlncmF0ZWQgPSBkYlZlcnNpb24gPCBBREFQVEVSX1ZFUlNJT047XG4gICAgICAgIGlmIChtaWdyYXRlZCkge1xuICAgICAgICAgIC8vIHVwZGF0ZSB0aGUgZGIgdmVyc2lvbiB3aXRoaW4gdGhpcyB0cmFuc2FjdGlvblxuICAgICAgICAgIHR4LmV4ZWN1dGVTcWwoJ1VQREFURSAnICsgTUVUQV9TVE9SRSArICcgU0VUIGRiX3ZlcnNpb24gPSAnICtcbiAgICAgICAgICAgIEFEQVBURVJfVkVSU0lPTik7XG4gICAgICAgIH1cbiAgICAgICAgLy8gbm90aWZ5IGRiLmlkKCkgY2FsbGVyc1xuICAgICAgICB2YXIgc3FsID0gJ1NFTEVDVCBkYmlkIEZST00gJyArIE1FVEFfU1RPUkU7XG4gICAgICAgIHR4LmV4ZWN1dGVTcWwoc3FsLCBbXSwgZnVuY3Rpb24gKHR4LCByZXN1bHQpIHtcbiAgICAgICAgICBpbnN0YW5jZUlkID0gcmVzdWx0LnJvd3MuaXRlbSgwKS5kYmlkO1xuICAgICAgICAgIG9uR2V0SW5zdGFuY2VJZCgpO1xuICAgICAgICB9KTtcbiAgICAgIH07XG5cbiAgICAgIC8vIHdvdWxkIGxvdmUgdG8gdXNlIHByb21pc2VzIGhlcmUsIGJ1dCB0aGVuIHdlYnNxbFxuICAgICAgLy8gZW5kcyB0aGUgdHJhbnNhY3Rpb24gZWFybHlcbiAgICAgIHZhciB0YXNrcyA9IFtcbiAgICAgICAgcnVuTWlncmF0aW9uMixcbiAgICAgICAgcnVuTWlncmF0aW9uMyxcbiAgICAgICAgcnVuTWlncmF0aW9uNCxcbiAgICAgICAgcnVuTWlncmF0aW9uNSxcbiAgICAgICAgcnVuTWlncmF0aW9uNixcbiAgICAgICAgcnVuTWlncmF0aW9uNyxcbiAgICAgICAgc2V0dXBEb25lXG4gICAgICBdO1xuXG4gICAgICAvLyBydW4gZWFjaCBtaWdyYXRpb24gc2VxdWVudGlhbGx5XG4gICAgICB2YXIgaSA9IGRiVmVyc2lvbjtcbiAgICAgIHZhciBuZXh0TWlncmF0aW9uID0gZnVuY3Rpb24gKHR4KSB7XG4gICAgICAgIHRhc2tzW2kgLSAxXSh0eCwgbmV4dE1pZ3JhdGlvbik7XG4gICAgICAgIGkrKztcbiAgICAgIH07XG4gICAgICBuZXh0TWlncmF0aW9uKHR4KTtcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBzZXR1cCgpIHtcbiAgICBkYi50cmFuc2FjdGlvbihmdW5jdGlvbiAodHgpIHtcbiAgICAgIC8vIGZpcnN0IGNoZWNrIHRoZSBlbmNvZGluZ1xuICAgICAgY2hlY2tFbmNvZGluZyh0eCwgZnVuY3Rpb24gKCkge1xuICAgICAgICAvLyB0aGVuIGdldCB0aGUgdmVyc2lvblxuICAgICAgICBmZXRjaFZlcnNpb24odHgpO1xuICAgICAgfSk7XG4gICAgfSwgdW5rbm93bkVycm9yKGNhbGxiYWNrKSwgZGJDcmVhdGVkKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGZldGNoVmVyc2lvbih0eCkge1xuICAgIHZhciBzcWwgPSAnU0VMRUNUIHNxbCBGUk9NIHNxbGl0ZV9tYXN0ZXIgV0hFUkUgdGJsX25hbWUgPSAnICsgTUVUQV9TVE9SRTtcbiAgICB0eC5leGVjdXRlU3FsKHNxbCwgW10sIGZ1bmN0aW9uICh0eCwgcmVzdWx0KSB7XG4gICAgICBpZiAoIXJlc3VsdC5yb3dzLmxlbmd0aCkge1xuICAgICAgICAvLyBkYXRhYmFzZSBoYXNuJ3QgZXZlbiBiZWVuIGNyZWF0ZWQgeWV0ICh2ZXJzaW9uIDApXG4gICAgICAgIG9uR2V0VmVyc2lvbih0eCwgMCk7XG4gICAgICB9IGVsc2UgaWYgKCEvZGJfdmVyc2lvbi8udGVzdChyZXN1bHQucm93cy5pdGVtKDApLnNxbCkpIHtcbiAgICAgICAgLy8gdGFibGUgd2FzIGNyZWF0ZWQsIGJ1dCB3aXRob3V0IHRoZSBuZXcgZGJfdmVyc2lvbiBjb2x1bW4sXG4gICAgICAgIC8vIHNvIGFkZCBpdC5cbiAgICAgICAgdHguZXhlY3V0ZVNxbCgnQUxURVIgVEFCTEUgJyArIE1FVEFfU1RPUkUgK1xuICAgICAgICAgICcgQUREIENPTFVNTiBkYl92ZXJzaW9uIElOVEVHRVInLCBbXSwgZnVuY3Rpb24gKCkge1xuICAgICAgICAgIC8vIGJlZm9yZSB2ZXJzaW9uIDIsIHRoaXMgY29sdW1uIGRpZG4ndCBldmVuIGV4aXN0XG4gICAgICAgICAgb25HZXRWZXJzaW9uKHR4LCAxKTtcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2UgeyAvLyBjb2x1bW4gZXhpc3RzLCB3ZSBjYW4gc2FmZWx5IGdldCBpdFxuICAgICAgICB0eC5leGVjdXRlU3FsKCdTRUxFQ1QgZGJfdmVyc2lvbiBGUk9NICcgKyBNRVRBX1NUT1JFLFxuICAgICAgICAgIFtdLCBmdW5jdGlvbiAodHgsIHJlc3VsdCkge1xuICAgICAgICAgIHZhciBkYlZlcnNpb24gPSByZXN1bHQucm93cy5pdGVtKDApLmRiX3ZlcnNpb247XG4gICAgICAgICAgb25HZXRWZXJzaW9uKHR4LCBkYlZlcnNpb24pO1xuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIGlmICh1dGlscy5pc0NvcmRvdmEoKSkge1xuICAgIC8vdG8gd2FpdCB1bnRpbCBjdXN0b20gYXBpIGlzIG1hZGUgaW4gcG91Y2guYWRhcHRlcnMgYmVmb3JlIGRvaW5nIHNldHVwXG4gICAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoYXBpLl9uYW1lICsgJ19wb3VjaCcsIGZ1bmN0aW9uIGNvcmRvdmFfaW5pdCgpIHtcbiAgICAgIHdpbmRvdy5yZW1vdmVFdmVudExpc3RlbmVyKGFwaS5fbmFtZSArICdfcG91Y2gnLCBjb3Jkb3ZhX2luaXQsIGZhbHNlKTtcbiAgICAgIHNldHVwKCk7XG4gICAgfSwgZmFsc2UpO1xuICB9IGVsc2Uge1xuICAgIHNldHVwKCk7XG4gIH1cblxuICBhcGkudHlwZSA9IGZ1bmN0aW9uICgpIHtcbiAgICByZXR1cm4gJ3dlYnNxbCc7XG4gIH07XG5cbiAgYXBpLl9pZCA9IHV0aWxzLnRvUHJvbWlzZShmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICBjYWxsYmFjayhudWxsLCBpbnN0YW5jZUlkKTtcbiAgfSk7XG5cbiAgYXBpLl9pbmZvID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgZGIucmVhZFRyYW5zYWN0aW9uKGZ1bmN0aW9uICh0eCkge1xuICAgICAgY291bnREb2NzKHR4LCBmdW5jdGlvbiAoZG9jQ291bnQpIHtcbiAgICAgICAgdmFyIHNxbCA9ICdTRUxFQ1QgTUFYKHNlcSkgQVMgc2VxIEZST00gJyArIEJZX1NFUV9TVE9SRTtcbiAgICAgICAgdHguZXhlY3V0ZVNxbChzcWwsIFtdLCBmdW5jdGlvbiAodHgsIHJlcykge1xuICAgICAgICAgIHZhciB1cGRhdGVTZXEgPSByZXMucm93cy5pdGVtKDApLnNlcSB8fCAwO1xuICAgICAgICAgIGNhbGxiYWNrKG51bGwsIHtcbiAgICAgICAgICAgIGRvY19jb3VudDogZG9jQ291bnQsXG4gICAgICAgICAgICB1cGRhdGVfc2VxOiB1cGRhdGVTZXEsXG4gICAgICAgICAgICAvLyBmb3IgZGVidWdnaW5nXG4gICAgICAgICAgICBzcWxpdGVfcGx1Z2luOiBkYi5fc3FsaXRlUGx1Z2luLFxuICAgICAgICAgICAgd2Vic3FsX2VuY29kaW5nOiBlbmNvZGluZ1xuICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH0sIHVua25vd25FcnJvcihjYWxsYmFjaykpO1xuICB9O1xuXG4gIGFwaS5fYnVsa0RvY3MgPSBmdW5jdGlvbiAocmVxLCBvcHRzLCBjYWxsYmFjaykge1xuICAgIHdlYnNxbEJ1bGtEb2NzKHJlcSwgb3B0cywgYXBpLCBkYiwgV2ViU3FsUG91Y2guQ2hhbmdlcywgY2FsbGJhY2spO1xuICB9O1xuXG4gIGFwaS5fZ2V0ID0gZnVuY3Rpb24gKGlkLCBvcHRzLCBjYWxsYmFjaykge1xuICAgIG9wdHMgPSB1dGlscy5jbG9uZShvcHRzKTtcbiAgICB2YXIgZG9jO1xuICAgIHZhciBtZXRhZGF0YTtcbiAgICB2YXIgZXJyO1xuICAgIGlmICghb3B0cy5jdHgpIHtcbiAgICAgIGRiLnJlYWRUcmFuc2FjdGlvbihmdW5jdGlvbiAodHhuKSB7XG4gICAgICAgIG9wdHMuY3R4ID0gdHhuO1xuICAgICAgICBhcGkuX2dldChpZCwgb3B0cywgY2FsbGJhY2spO1xuICAgICAgfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHZhciB0eCA9IG9wdHMuY3R4O1xuXG4gICAgZnVuY3Rpb24gZmluaXNoKCkge1xuICAgICAgY2FsbGJhY2soZXJyLCB7ZG9jOiBkb2MsIG1ldGFkYXRhOiBtZXRhZGF0YSwgY3R4OiB0eH0pO1xuICAgIH1cblxuICAgIHZhciBzcWw7XG4gICAgdmFyIHNxbEFyZ3M7XG4gICAgaWYgKG9wdHMucmV2KSB7XG4gICAgICBzcWwgPSBzZWxlY3QoXG4gICAgICAgIFNFTEVDVF9ET0NTLFxuICAgICAgICBbRE9DX1NUT1JFLCBCWV9TRVFfU1RPUkVdLFxuICAgICAgICBET0NfU1RPUkUgKyAnLmlkPScgKyBCWV9TRVFfU1RPUkUgKyAnLmRvY19pZCcsXG4gICAgICAgIFtCWV9TRVFfU1RPUkUgKyAnLmRvY19pZD0/JywgQllfU0VRX1NUT1JFICsgJy5yZXY9PyddKTtcbiAgICAgIHNxbEFyZ3MgPSBbaWQsIG9wdHMucmV2XTtcbiAgICB9IGVsc2Uge1xuICAgICAgc3FsID0gc2VsZWN0KFxuICAgICAgICBTRUxFQ1RfRE9DUyxcbiAgICAgICAgW0RPQ19TVE9SRSwgQllfU0VRX1NUT1JFXSxcbiAgICAgICAgRE9DX1NUT1JFX0FORF9CWV9TRVFfSk9JTkVSLFxuICAgICAgICBET0NfU1RPUkUgKyAnLmlkPT8nKTtcbiAgICAgIHNxbEFyZ3MgPSBbaWRdO1xuICAgIH1cbiAgICB0eC5leGVjdXRlU3FsKHNxbCwgc3FsQXJncywgZnVuY3Rpb24gKGEsIHJlc3VsdHMpIHtcbiAgICAgIGlmICghcmVzdWx0cy5yb3dzLmxlbmd0aCkge1xuICAgICAgICBlcnIgPSBlcnJvcnMuZXJyb3IoZXJyb3JzLk1JU1NJTkdfRE9DLCAnbWlzc2luZycpO1xuICAgICAgICByZXR1cm4gZmluaXNoKCk7XG4gICAgICB9XG4gICAgICB2YXIgaXRlbSA9IHJlc3VsdHMucm93cy5pdGVtKDApO1xuICAgICAgbWV0YWRhdGEgPSB1dGlscy5zYWZlSnNvblBhcnNlKGl0ZW0ubWV0YWRhdGEpO1xuICAgICAgaWYgKGl0ZW0uZGVsZXRlZCAmJiAhb3B0cy5yZXYpIHtcbiAgICAgICAgZXJyID0gZXJyb3JzLmVycm9yKGVycm9ycy5NSVNTSU5HX0RPQywgJ2RlbGV0ZWQnKTtcbiAgICAgICAgcmV0dXJuIGZpbmlzaCgpO1xuICAgICAgfVxuICAgICAgZG9jID0gdW5zdHJpbmdpZnlEb2MoaXRlbS5kYXRhLCBtZXRhZGF0YS5pZCwgaXRlbS5yZXYpO1xuICAgICAgZmluaXNoKCk7XG4gICAgfSk7XG4gIH07XG5cbiAgZnVuY3Rpb24gY291bnREb2NzKHR4LCBjYWxsYmFjaykge1xuXG4gICAgaWYgKGFwaS5fZG9jQ291bnQgIT09IC0xKSB7XG4gICAgICByZXR1cm4gY2FsbGJhY2soYXBpLl9kb2NDb3VudCk7XG4gICAgfVxuXG4gICAgLy8gY291bnQgdGhlIHRvdGFsIHJvd3NcbiAgICB2YXIgc3FsID0gc2VsZWN0KFxuICAgICAgJ0NPVU5UKCcgKyBET0NfU1RPUkUgKyAnLmlkKSBBUyBcXCdudW1cXCcnLFxuICAgICAgW0RPQ19TVE9SRSwgQllfU0VRX1NUT1JFXSxcbiAgICAgIERPQ19TVE9SRV9BTkRfQllfU0VRX0pPSU5FUixcbiAgICAgIEJZX1NFUV9TVE9SRSArICcuZGVsZXRlZD0wJyk7XG5cbiAgICB0eC5leGVjdXRlU3FsKHNxbCwgW10sIGZ1bmN0aW9uICh0eCwgcmVzdWx0KSB7XG4gICAgICBhcGkuX2RvY0NvdW50ID0gcmVzdWx0LnJvd3MuaXRlbSgwKS5udW07XG4gICAgICBjYWxsYmFjayhhcGkuX2RvY0NvdW50KTtcbiAgICB9KTtcbiAgfVxuXG4gIGFwaS5fYWxsRG9jcyA9IGZ1bmN0aW9uIChvcHRzLCBjYWxsYmFjaykge1xuICAgIHZhciByZXN1bHRzID0gW107XG4gICAgdmFyIHRvdGFsUm93cztcblxuICAgIHZhciBzdGFydCA9ICdzdGFydGtleScgaW4gb3B0cyA/IG9wdHMuc3RhcnRrZXkgOiBmYWxzZTtcbiAgICB2YXIgZW5kID0gJ2VuZGtleScgaW4gb3B0cyA/IG9wdHMuZW5ka2V5IDogZmFsc2U7XG4gICAgdmFyIGtleSA9ICdrZXknIGluIG9wdHMgPyBvcHRzLmtleSA6IGZhbHNlO1xuICAgIHZhciBkZXNjZW5kaW5nID0gJ2Rlc2NlbmRpbmcnIGluIG9wdHMgPyBvcHRzLmRlc2NlbmRpbmcgOiBmYWxzZTtcbiAgICB2YXIgbGltaXQgPSAnbGltaXQnIGluIG9wdHMgPyBvcHRzLmxpbWl0IDogLTE7XG4gICAgdmFyIG9mZnNldCA9ICdza2lwJyBpbiBvcHRzID8gb3B0cy5za2lwIDogMDtcbiAgICB2YXIgaW5jbHVzaXZlRW5kID0gb3B0cy5pbmNsdXNpdmVfZW5kICE9PSBmYWxzZTtcblxuICAgIHZhciBzcWxBcmdzID0gW107XG4gICAgdmFyIGNyaXRlcmlhID0gW107XG5cbiAgICBpZiAoa2V5ICE9PSBmYWxzZSkge1xuICAgICAgY3JpdGVyaWEucHVzaChET0NfU1RPUkUgKyAnLmlkID0gPycpO1xuICAgICAgc3FsQXJncy5wdXNoKGtleSk7XG4gICAgfSBlbHNlIGlmIChzdGFydCAhPT0gZmFsc2UgfHwgZW5kICE9PSBmYWxzZSkge1xuICAgICAgaWYgKHN0YXJ0ICE9PSBmYWxzZSkge1xuICAgICAgICBjcml0ZXJpYS5wdXNoKERPQ19TVE9SRSArICcuaWQgJyArIChkZXNjZW5kaW5nID8gJzw9JyA6ICc+PScpICsgJyA/Jyk7XG4gICAgICAgIHNxbEFyZ3MucHVzaChzdGFydCk7XG4gICAgICB9XG4gICAgICBpZiAoZW5kICE9PSBmYWxzZSkge1xuICAgICAgICB2YXIgY29tcGFyYXRvciA9IGRlc2NlbmRpbmcgPyAnPicgOiAnPCc7XG4gICAgICAgIGlmIChpbmNsdXNpdmVFbmQpIHtcbiAgICAgICAgICBjb21wYXJhdG9yICs9ICc9JztcbiAgICAgICAgfVxuICAgICAgICBjcml0ZXJpYS5wdXNoKERPQ19TVE9SRSArICcuaWQgJyArIGNvbXBhcmF0b3IgKyAnID8nKTtcbiAgICAgICAgc3FsQXJncy5wdXNoKGVuZCk7XG4gICAgICB9XG4gICAgICBpZiAoa2V5ICE9PSBmYWxzZSkge1xuICAgICAgICBjcml0ZXJpYS5wdXNoKERPQ19TVE9SRSArICcuaWQgPSA/Jyk7XG4gICAgICAgIHNxbEFyZ3MucHVzaChrZXkpO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChvcHRzLmRlbGV0ZWQgIT09ICdvaycpIHtcbiAgICAgIC8vIHJlcG9ydCBkZWxldGVkIGlmIGtleXMgYXJlIHNwZWNpZmllZFxuICAgICAgY3JpdGVyaWEucHVzaChCWV9TRVFfU1RPUkUgKyAnLmRlbGV0ZWQgPSAwJyk7XG4gICAgfVxuXG4gICAgZGIucmVhZFRyYW5zYWN0aW9uKGZ1bmN0aW9uICh0eCkge1xuXG4gICAgICAvLyBmaXJzdCBjb3VudCB1cCB0aGUgdG90YWwgcm93c1xuICAgICAgY291bnREb2NzKHR4LCBmdW5jdGlvbiAoY291bnQpIHtcbiAgICAgICAgdG90YWxSb3dzID0gY291bnQ7XG5cbiAgICAgICAgaWYgKGxpbWl0ID09PSAwKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gdGhlbiBhY3R1YWxseSBmZXRjaCB0aGUgZG9jdW1lbnRzXG4gICAgICAgIHZhciBzcWwgPSBzZWxlY3QoXG4gICAgICAgICAgU0VMRUNUX0RPQ1MsXG4gICAgICAgICAgW0RPQ19TVE9SRSwgQllfU0VRX1NUT1JFXSxcbiAgICAgICAgICBET0NfU1RPUkVfQU5EX0JZX1NFUV9KT0lORVIsXG4gICAgICAgICAgY3JpdGVyaWEsXG4gICAgICAgICAgRE9DX1NUT1JFICsgJy5pZCAnICsgKGRlc2NlbmRpbmcgPyAnREVTQycgOiAnQVNDJylcbiAgICAgICAgICApO1xuICAgICAgICBzcWwgKz0gJyBMSU1JVCAnICsgbGltaXQgKyAnIE9GRlNFVCAnICsgb2Zmc2V0O1xuXG4gICAgICAgIHR4LmV4ZWN1dGVTcWwoc3FsLCBzcWxBcmdzLCBmdW5jdGlvbiAodHgsIHJlc3VsdCkge1xuICAgICAgICAgIGZvciAodmFyIGkgPSAwLCBsID0gcmVzdWx0LnJvd3MubGVuZ3RoOyBpIDwgbDsgaSsrKSB7XG4gICAgICAgICAgICB2YXIgaXRlbSA9IHJlc3VsdC5yb3dzLml0ZW0oaSk7XG4gICAgICAgICAgICB2YXIgbWV0YWRhdGEgPSB1dGlscy5zYWZlSnNvblBhcnNlKGl0ZW0ubWV0YWRhdGEpO1xuICAgICAgICAgICAgdmFyIGlkID0gbWV0YWRhdGEuaWQ7XG4gICAgICAgICAgICB2YXIgZGF0YSA9IHVuc3RyaW5naWZ5RG9jKGl0ZW0uZGF0YSwgaWQsIGl0ZW0ucmV2KTtcbiAgICAgICAgICAgIHZhciB3aW5uaW5nUmV2ID0gZGF0YS5fcmV2O1xuICAgICAgICAgICAgdmFyIGRvYyA9IHtcbiAgICAgICAgICAgICAgaWQ6IGlkLFxuICAgICAgICAgICAgICBrZXk6IGlkLFxuICAgICAgICAgICAgICB2YWx1ZToge3Jldjogd2lubmluZ1Jldn1cbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICBpZiAob3B0cy5pbmNsdWRlX2RvY3MpIHtcbiAgICAgICAgICAgICAgZG9jLmRvYyA9IGRhdGE7XG4gICAgICAgICAgICAgIGRvYy5kb2MuX3JldiA9IHdpbm5pbmdSZXY7XG4gICAgICAgICAgICAgIGlmIChvcHRzLmNvbmZsaWN0cykge1xuICAgICAgICAgICAgICAgIGRvYy5kb2MuX2NvbmZsaWN0cyA9IG1lcmdlLmNvbGxlY3RDb25mbGljdHMobWV0YWRhdGEpO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIGZldGNoQXR0YWNobWVudHNJZk5lY2Vzc2FyeShkb2MuZG9jLCBvcHRzLCBhcGksIHR4KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChpdGVtLmRlbGV0ZWQpIHtcbiAgICAgICAgICAgICAgaWYgKG9wdHMuZGVsZXRlZCA9PT0gJ29rJykge1xuICAgICAgICAgICAgICAgIGRvYy52YWx1ZS5kZWxldGVkID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICBkb2MuZG9jID0gbnVsbDtcbiAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmVzdWx0cy5wdXNoKGRvYyk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH0sIHVua25vd25FcnJvcihjYWxsYmFjayksIGZ1bmN0aW9uICgpIHtcbiAgICAgIGNhbGxiYWNrKG51bGwsIHtcbiAgICAgICAgdG90YWxfcm93czogdG90YWxSb3dzLFxuICAgICAgICBvZmZzZXQ6IG9wdHMuc2tpcCxcbiAgICAgICAgcm93czogcmVzdWx0c1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH07XG5cbiAgYXBpLl9jaGFuZ2VzID0gZnVuY3Rpb24gKG9wdHMpIHtcbiAgICBvcHRzID0gdXRpbHMuY2xvbmUob3B0cyk7XG5cbiAgICBpZiAob3B0cy5jb250aW51b3VzKSB7XG4gICAgICB2YXIgaWQgPSBhcGkuX25hbWUgKyAnOicgKyB1dGlscy51dWlkKCk7XG4gICAgICBXZWJTcWxQb3VjaC5DaGFuZ2VzLmFkZExpc3RlbmVyKGFwaS5fbmFtZSwgaWQsIGFwaSwgb3B0cyk7XG4gICAgICBXZWJTcWxQb3VjaC5DaGFuZ2VzLm5vdGlmeShhcGkuX25hbWUpO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgY2FuY2VsOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgV2ViU3FsUG91Y2guQ2hhbmdlcy5yZW1vdmVMaXN0ZW5lcihhcGkuX25hbWUsIGlkKTtcbiAgICAgICAgfVxuICAgICAgfTtcbiAgICB9XG5cbiAgICB2YXIgZGVzY2VuZGluZyA9IG9wdHMuZGVzY2VuZGluZztcblxuICAgIC8vIElnbm9yZSB0aGUgYHNpbmNlYCBwYXJhbWV0ZXIgd2hlbiBgZGVzY2VuZGluZ2AgaXMgdHJ1ZVxuICAgIG9wdHMuc2luY2UgPSBvcHRzLnNpbmNlICYmICFkZXNjZW5kaW5nID8gb3B0cy5zaW5jZSA6IDA7XG5cbiAgICB2YXIgbGltaXQgPSAnbGltaXQnIGluIG9wdHMgPyBvcHRzLmxpbWl0IDogLTE7XG4gICAgaWYgKGxpbWl0ID09PSAwKSB7XG4gICAgICBsaW1pdCA9IDE7IC8vIHBlciBDb3VjaERCIF9jaGFuZ2VzIHNwZWNcbiAgICB9XG5cbiAgICB2YXIgcmV0dXJuRG9jcztcbiAgICBpZiAoJ3JldHVybkRvY3MnIGluIG9wdHMpIHtcbiAgICAgIHJldHVybkRvY3MgPSBvcHRzLnJldHVybkRvY3M7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybkRvY3MgPSB0cnVlO1xuICAgIH1cbiAgICB2YXIgcmVzdWx0cyA9IFtdO1xuICAgIHZhciBudW1SZXN1bHRzID0gMDtcblxuICAgIGZ1bmN0aW9uIGZldGNoQ2hhbmdlcygpIHtcblxuICAgICAgdmFyIHNlbGVjdFN0bXQgPVxuICAgICAgICBET0NfU1RPUkUgKyAnLmpzb24gQVMgbWV0YWRhdGEsICcgK1xuICAgICAgICBET0NfU1RPUkUgKyAnLm1heF9zZXEgQVMgbWF4U2VxLCAnICtcbiAgICAgICAgQllfU0VRX1NUT1JFICsgJy5qc29uIEFTIHdpbm5pbmdEb2MsICcgK1xuICAgICAgICBCWV9TRVFfU1RPUkUgKyAnLnJldiBBUyB3aW5uaW5nUmV2ICc7XG5cbiAgICAgIHZhciBmcm9tID0gRE9DX1NUT1JFICsgJyBKT0lOICcgKyBCWV9TRVFfU1RPUkU7XG5cbiAgICAgIHZhciBqb2luZXIgPSBET0NfU1RPUkUgKyAnLmlkPScgKyBCWV9TRVFfU1RPUkUgKyAnLmRvY19pZCcgK1xuICAgICAgICAnIEFORCAnICsgRE9DX1NUT1JFICsgJy53aW5uaW5nc2VxPScgKyBCWV9TRVFfU1RPUkUgKyAnLnNlcSc7XG5cbiAgICAgIHZhciBjcml0ZXJpYSA9IFsnbWF4U2VxID4gPyddO1xuICAgICAgdmFyIHNxbEFyZ3MgPSBbb3B0cy5zaW5jZV07XG5cbiAgICAgIGlmIChvcHRzLmRvY19pZHMpIHtcbiAgICAgICAgY3JpdGVyaWEucHVzaChET0NfU1RPUkUgKyAnLmlkIElOICcgKyBxTWFya3Mob3B0cy5kb2NfaWRzLmxlbmd0aCkpO1xuICAgICAgICBzcWxBcmdzID0gc3FsQXJncy5jb25jYXQob3B0cy5kb2NfaWRzKTtcbiAgICAgIH1cblxuICAgICAgdmFyIG9yZGVyQnkgPSAnbWF4U2VxICcgKyAoZGVzY2VuZGluZyA/ICdERVNDJyA6ICdBU0MnKTtcblxuICAgICAgdmFyIHNxbCA9IHNlbGVjdChzZWxlY3RTdG10LCBmcm9tLCBqb2luZXIsIGNyaXRlcmlhLCBvcmRlckJ5KTtcblxuICAgICAgdmFyIGZpbHRlciA9IHV0aWxzLmZpbHRlckNoYW5nZShvcHRzKTtcbiAgICAgIGlmICghb3B0cy52aWV3ICYmICFvcHRzLmZpbHRlcikge1xuICAgICAgICAvLyB3ZSBjYW4ganVzdCBsaW1pdCBpbiB0aGUgcXVlcnlcbiAgICAgICAgc3FsICs9ICcgTElNSVQgJyArIGxpbWl0O1xuICAgICAgfVxuXG4gICAgICB2YXIgbGFzdFNlcSA9IG9wdHMuc2luY2UgfHwgMDtcbiAgICAgIGRiLnJlYWRUcmFuc2FjdGlvbihmdW5jdGlvbiAodHgpIHtcbiAgICAgICAgdHguZXhlY3V0ZVNxbChzcWwsIHNxbEFyZ3MsIGZ1bmN0aW9uICh0eCwgcmVzdWx0KSB7XG4gICAgICAgICAgZnVuY3Rpb24gcmVwb3J0Q2hhbmdlKGNoYW5nZSkge1xuICAgICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgb3B0cy5vbkNoYW5nZShjaGFuZ2UpO1xuICAgICAgICAgICAgfTtcbiAgICAgICAgICB9XG4gICAgICAgICAgZm9yICh2YXIgaSA9IDAsIGwgPSByZXN1bHQucm93cy5sZW5ndGg7IGkgPCBsOyBpKyspIHtcbiAgICAgICAgICAgIHZhciBpdGVtID0gcmVzdWx0LnJvd3MuaXRlbShpKTtcbiAgICAgICAgICAgIHZhciBtZXRhZGF0YSA9IHV0aWxzLnNhZmVKc29uUGFyc2UoaXRlbS5tZXRhZGF0YSk7XG4gICAgICAgICAgICBsYXN0U2VxID0gaXRlbS5tYXhTZXE7XG5cbiAgICAgICAgICAgIHZhciBkb2MgPSB1bnN0cmluZ2lmeURvYyhpdGVtLndpbm5pbmdEb2MsIG1ldGFkYXRhLmlkLFxuICAgICAgICAgICAgICBpdGVtLndpbm5pbmdSZXYpO1xuICAgICAgICAgICAgdmFyIGNoYW5nZSA9IG9wdHMucHJvY2Vzc0NoYW5nZShkb2MsIG1ldGFkYXRhLCBvcHRzKTtcbiAgICAgICAgICAgIGNoYW5nZS5zZXEgPSBpdGVtLm1heFNlcTtcbiAgICAgICAgICAgIGlmIChmaWx0ZXIoY2hhbmdlKSkge1xuICAgICAgICAgICAgICBudW1SZXN1bHRzKys7XG4gICAgICAgICAgICAgIGlmIChyZXR1cm5Eb2NzKSB7XG4gICAgICAgICAgICAgICAgcmVzdWx0cy5wdXNoKGNoYW5nZSk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgLy8gcHJvY2VzcyB0aGUgYXR0YWNobWVudCBpbW1lZGlhdGVseVxuICAgICAgICAgICAgICAvLyBmb3IgdGhlIGJlbmVmaXQgb2YgbGl2ZSBsaXN0ZW5lcnNcbiAgICAgICAgICAgICAgaWYgKG9wdHMuYXR0YWNobWVudHMgJiYgb3B0cy5pbmNsdWRlX2RvY3MpIHtcbiAgICAgICAgICAgICAgICBmZXRjaEF0dGFjaG1lbnRzSWZOZWNlc3NhcnkoZG9jLCBvcHRzLCBhcGksIHR4LFxuICAgICAgICAgICAgICAgICAgcmVwb3J0Q2hhbmdlKGNoYW5nZSkpO1xuICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHJlcG9ydENoYW5nZShjaGFuZ2UpKCk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChudW1SZXN1bHRzID09PSBsaW1pdCkge1xuICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfSwgdW5rbm93bkVycm9yKG9wdHMuY29tcGxldGUpLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgIGlmICghb3B0cy5jb250aW51b3VzKSB7XG4gICAgICAgICAgb3B0cy5jb21wbGV0ZShudWxsLCB7XG4gICAgICAgICAgICByZXN1bHRzOiByZXN1bHRzLFxuICAgICAgICAgICAgbGFzdF9zZXE6IGxhc3RTZXFcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgZmV0Y2hDaGFuZ2VzKCk7XG4gIH07XG5cbiAgYXBpLl9jbG9zZSA9IGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgIC8vV2ViU1FMIGRhdGFiYXNlcyBkbyBub3QgbmVlZCB0byBiZSBjbG9zZWRcbiAgICBjYWxsYmFjaygpO1xuICB9O1xuXG4gIGFwaS5fZ2V0QXR0YWNobWVudCA9IGZ1bmN0aW9uIChhdHRhY2htZW50LCBvcHRzLCBjYWxsYmFjaykge1xuICAgIHZhciByZXM7XG4gICAgdmFyIHR4ID0gb3B0cy5jdHg7XG4gICAgdmFyIGRpZ2VzdCA9IGF0dGFjaG1lbnQuZGlnZXN0O1xuICAgIHZhciB0eXBlID0gYXR0YWNobWVudC5jb250ZW50X3R5cGU7XG4gICAgdmFyIHNxbCA9ICdTRUxFQ1QgZXNjYXBlZCwgJyArXG4gICAgICAnQ0FTRSBXSEVOIGVzY2FwZWQgPSAxIFRIRU4gYm9keSBFTFNFIEhFWChib2R5KSBFTkQgQVMgYm9keSBGUk9NICcgK1xuICAgICAgQVRUQUNIX1NUT1JFICsgJyBXSEVSRSBkaWdlc3Q9Pyc7XG4gICAgdHguZXhlY3V0ZVNxbChzcWwsIFtkaWdlc3RdLCBmdW5jdGlvbiAodHgsIHJlc3VsdCkge1xuICAgICAgLy8gd2Vic3FsIGhhcyBhIGJ1ZyB3aGVyZSBcXHUwMDAwIGNhdXNlcyBlYXJseSB0cnVuY2F0aW9uIGluIHN0cmluZ3NcbiAgICAgIC8vIGFuZCBibG9icy4gdG8gd29yayBhcm91bmQgdGhpcywgd2UgdXNlZCB0byB1c2UgdGhlIGhleCgpIGZ1bmN0aW9uLFxuICAgICAgLy8gYnV0IHRoYXQncyBub3QgcGVyZm9ybWFudC4gYWZ0ZXIgbWlncmF0aW9uIDYsIHdlIHJlbW92ZSBcXHUwMDAwXG4gICAgICAvLyBhbmQgYWRkIGl0IGJhY2sgaW4gYWZ0ZXJ3YXJkc1xuICAgICAgdmFyIGl0ZW0gPSByZXN1bHQucm93cy5pdGVtKDApO1xuICAgICAgdmFyIGRhdGEgPSBpdGVtLmVzY2FwZWQgPyB3ZWJzcWxVdGlscy51bmVzY2FwZUJsb2IoaXRlbS5ib2R5KSA6XG4gICAgICAgIHBhcnNlSGV4U3RyaW5nKGl0ZW0uYm9keSwgZW5jb2RpbmcpO1xuICAgICAgaWYgKG9wdHMuZW5jb2RlKSB7XG4gICAgICAgIHJlcyA9IGJ0b2EoZGF0YSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBkYXRhID0gdXRpbHMuZml4QmluYXJ5KGRhdGEpO1xuICAgICAgICByZXMgPSB1dGlscy5jcmVhdGVCbG9iKFtkYXRhXSwge3R5cGU6IHR5cGV9KTtcbiAgICAgIH1cbiAgICAgIGNhbGxiYWNrKG51bGwsIHJlcyk7XG4gICAgfSk7XG4gIH07XG5cbiAgYXBpLl9nZXRSZXZpc2lvblRyZWUgPSBmdW5jdGlvbiAoZG9jSWQsIGNhbGxiYWNrKSB7XG4gICAgZGIucmVhZFRyYW5zYWN0aW9uKGZ1bmN0aW9uICh0eCkge1xuICAgICAgdmFyIHNxbCA9ICdTRUxFQ1QganNvbiBBUyBtZXRhZGF0YSBGUk9NICcgKyBET0NfU1RPUkUgKyAnIFdIRVJFIGlkID0gPyc7XG4gICAgICB0eC5leGVjdXRlU3FsKHNxbCwgW2RvY0lkXSwgZnVuY3Rpb24gKHR4LCByZXN1bHQpIHtcbiAgICAgICAgaWYgKCFyZXN1bHQucm93cy5sZW5ndGgpIHtcbiAgICAgICAgICBjYWxsYmFjayhlcnJvcnMuZXJyb3IoZXJyb3JzLk1JU1NJTkdfRE9DKSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdmFyIGRhdGEgPSB1dGlscy5zYWZlSnNvblBhcnNlKHJlc3VsdC5yb3dzLml0ZW0oMCkubWV0YWRhdGEpO1xuICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRhdGEucmV2X3RyZWUpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfTtcblxuICBhcGkuX2RvQ29tcGFjdGlvbiA9IGZ1bmN0aW9uIChkb2NJZCwgcmV2cywgY2FsbGJhY2spIHtcbiAgICBpZiAoIXJldnMubGVuZ3RoKSB7XG4gICAgICByZXR1cm4gY2FsbGJhY2soKTtcbiAgICB9XG4gICAgZGIudHJhbnNhY3Rpb24oZnVuY3Rpb24gKHR4KSB7XG5cbiAgICAgIC8vIHVwZGF0ZSBkb2Mgc3RvcmVcbiAgICAgIHZhciBzcWwgPSAnU0VMRUNUIGpzb24gQVMgbWV0YWRhdGEgRlJPTSAnICsgRE9DX1NUT1JFICsgJyBXSEVSRSBpZCA9ID8nO1xuICAgICAgdHguZXhlY3V0ZVNxbChzcWwsIFtkb2NJZF0sIGZ1bmN0aW9uICh0eCwgcmVzdWx0KSB7XG4gICAgICAgIHZhciBtZXRhZGF0YSA9IHV0aWxzLnNhZmVKc29uUGFyc2UocmVzdWx0LnJvd3MuaXRlbSgwKS5tZXRhZGF0YSk7XG4gICAgICAgIG1lcmdlLnRyYXZlcnNlUmV2VHJlZShtZXRhZGF0YS5yZXZfdHJlZSwgZnVuY3Rpb24gKGlzTGVhZiwgcG9zLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXZIYXNoLCBjdHgsIG9wdHMpIHtcbiAgICAgICAgICB2YXIgcmV2ID0gcG9zICsgJy0nICsgcmV2SGFzaDtcbiAgICAgICAgICBpZiAocmV2cy5pbmRleE9mKHJldikgIT09IC0xKSB7XG4gICAgICAgICAgICBvcHRzLnN0YXR1cyA9ICdtaXNzaW5nJztcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHZhciBzcWwgPSAnVVBEQVRFICcgKyBET0NfU1RPUkUgKyAnIFNFVCBqc29uID0gPyBXSEVSRSBpZCA9ID8nO1xuICAgICAgICB0eC5leGVjdXRlU3FsKHNxbCwgW3V0aWxzLnNhZmVKc29uU3RyaW5naWZ5KG1ldGFkYXRhKSwgZG9jSWRdKTtcbiAgICAgIH0pO1xuXG4gICAgICBjb21wYWN0UmV2cyhyZXZzLCBkb2NJZCwgdHgpO1xuICAgIH0sIHVua25vd25FcnJvcihjYWxsYmFjayksIGZ1bmN0aW9uICgpIHtcbiAgICAgIGNhbGxiYWNrKCk7XG4gICAgfSk7XG4gIH07XG5cbiAgYXBpLl9nZXRMb2NhbCA9IGZ1bmN0aW9uIChpZCwgY2FsbGJhY2spIHtcbiAgICBkYi5yZWFkVHJhbnNhY3Rpb24oZnVuY3Rpb24gKHR4KSB7XG4gICAgICB2YXIgc3FsID0gJ1NFTEVDVCBqc29uLCByZXYgRlJPTSAnICsgTE9DQUxfU1RPUkUgKyAnIFdIRVJFIGlkPT8nO1xuICAgICAgdHguZXhlY3V0ZVNxbChzcWwsIFtpZF0sIGZ1bmN0aW9uICh0eCwgcmVzKSB7XG4gICAgICAgIGlmIChyZXMucm93cy5sZW5ndGgpIHtcbiAgICAgICAgICB2YXIgaXRlbSA9IHJlcy5yb3dzLml0ZW0oMCk7XG4gICAgICAgICAgdmFyIGRvYyA9IHVuc3RyaW5naWZ5RG9jKGl0ZW0uanNvbiwgaWQsIGl0ZW0ucmV2KTtcbiAgICAgICAgICBjYWxsYmFjayhudWxsLCBkb2MpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNhbGxiYWNrKGVycm9ycy5lcnJvcihlcnJvcnMuTUlTU0lOR19ET0MpKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG4gIH07XG5cbiAgYXBpLl9wdXRMb2NhbCA9IGZ1bmN0aW9uIChkb2MsIG9wdHMsIGNhbGxiYWNrKSB7XG4gICAgaWYgKHR5cGVvZiBvcHRzID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICBjYWxsYmFjayA9IG9wdHM7XG4gICAgICBvcHRzID0ge307XG4gICAgfVxuICAgIGRlbGV0ZSBkb2MuX3JldmlzaW9uczsgLy8gaWdub3JlIHRoaXMsIHRydXN0IHRoZSByZXZcbiAgICB2YXIgb2xkUmV2ID0gZG9jLl9yZXY7XG4gICAgdmFyIGlkID0gZG9jLl9pZDtcbiAgICB2YXIgbmV3UmV2O1xuICAgIGlmICghb2xkUmV2KSB7XG4gICAgICBuZXdSZXYgPSBkb2MuX3JldiA9ICcwLTEnO1xuICAgIH0gZWxzZSB7XG4gICAgICBuZXdSZXYgPSBkb2MuX3JldiA9ICcwLScgKyAocGFyc2VJbnQob2xkUmV2LnNwbGl0KCctJylbMV0sIDEwKSArIDEpO1xuICAgIH1cbiAgICB2YXIganNvbiA9IHN0cmluZ2lmeURvYyhkb2MpO1xuXG4gICAgdmFyIHJldDtcbiAgICBmdW5jdGlvbiBwdXRMb2NhbCh0eCkge1xuICAgICAgdmFyIHNxbDtcbiAgICAgIHZhciB2YWx1ZXM7XG4gICAgICBpZiAob2xkUmV2KSB7XG4gICAgICAgIHNxbCA9ICdVUERBVEUgJyArIExPQ0FMX1NUT1JFICsgJyBTRVQgcmV2PT8sIGpzb249PyAnICtcbiAgICAgICAgICAnV0hFUkUgaWQ9PyBBTkQgcmV2PT8nO1xuICAgICAgICB2YWx1ZXMgPSBbbmV3UmV2LCBqc29uLCBpZCwgb2xkUmV2XTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHNxbCA9ICdJTlNFUlQgSU5UTyAnICsgTE9DQUxfU1RPUkUgKyAnIChpZCwgcmV2LCBqc29uKSBWQUxVRVMgKD8sPyw/KSc7XG4gICAgICAgIHZhbHVlcyA9IFtpZCwgbmV3UmV2LCBqc29uXTtcbiAgICAgIH1cbiAgICAgIHR4LmV4ZWN1dGVTcWwoc3FsLCB2YWx1ZXMsIGZ1bmN0aW9uICh0eCwgcmVzKSB7XG4gICAgICAgIGlmIChyZXMucm93c0FmZmVjdGVkKSB7XG4gICAgICAgICAgcmV0ID0ge29rOiB0cnVlLCBpZDogaWQsIHJldjogbmV3UmV2fTtcbiAgICAgICAgICBpZiAob3B0cy5jdHgpIHsgLy8gcmV0dXJuIGltbWVkaWF0ZWx5XG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCByZXQpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjYWxsYmFjayhlcnJvcnMuZXJyb3IoZXJyb3JzLlJFVl9DT05GTElDVCkpO1xuICAgICAgICB9XG4gICAgICB9LCBmdW5jdGlvbiAoKSB7XG4gICAgICAgIGNhbGxiYWNrKGVycm9ycy5lcnJvcihlcnJvcnMuUkVWX0NPTkZMSUNUKSk7XG4gICAgICAgIHJldHVybiBmYWxzZTsgLy8gYWNrIHRoYXQgd2UgaGFuZGxlZCB0aGUgZXJyb3JcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGlmIChvcHRzLmN0eCkge1xuICAgICAgcHV0TG9jYWwob3B0cy5jdHgpO1xuICAgIH0gZWxzZSB7XG4gICAgICBkYi50cmFuc2FjdGlvbihmdW5jdGlvbiAodHgpIHtcbiAgICAgICAgcHV0TG9jYWwodHgpO1xuICAgICAgfSwgdW5rbm93bkVycm9yKGNhbGxiYWNrKSwgZnVuY3Rpb24gKCkge1xuICAgICAgICBpZiAocmV0KSB7XG4gICAgICAgICAgY2FsbGJhY2sobnVsbCwgcmV0KTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuICB9O1xuXG4gIGFwaS5fcmVtb3ZlTG9jYWwgPSBmdW5jdGlvbiAoZG9jLCBjYWxsYmFjaykge1xuICAgIHZhciByZXQ7XG4gICAgZGIudHJhbnNhY3Rpb24oZnVuY3Rpb24gKHR4KSB7XG4gICAgICB2YXIgc3FsID0gJ0RFTEVURSBGUk9NICcgKyBMT0NBTF9TVE9SRSArICcgV0hFUkUgaWQ9PyBBTkQgcmV2PT8nO1xuICAgICAgdmFyIHBhcmFtcyA9IFtkb2MuX2lkLCBkb2MuX3Jldl07XG4gICAgICB0eC5leGVjdXRlU3FsKHNxbCwgcGFyYW1zLCBmdW5jdGlvbiAodHgsIHJlcykge1xuICAgICAgICBpZiAoIXJlcy5yb3dzQWZmZWN0ZWQpIHtcbiAgICAgICAgICByZXR1cm4gY2FsbGJhY2soZXJyb3JzLmVycm9yKGVycm9ycy5NSVNTSU5HX0RPQykpO1xuICAgICAgICB9XG4gICAgICAgIHJldCA9IHtvazogdHJ1ZSwgaWQ6IGRvYy5faWQsIHJldjogJzAtMCd9O1xuICAgICAgfSk7XG4gICAgfSwgdW5rbm93bkVycm9yKGNhbGxiYWNrKSwgZnVuY3Rpb24gKCkge1xuICAgICAgaWYgKHJldCkge1xuICAgICAgICBjYWxsYmFjayhudWxsLCByZXQpO1xuICAgICAgfVxuICAgIH0pO1xuICB9O1xufVxuXG5XZWJTcWxQb3VjaC52YWxpZCA9IHdlYnNxbFV0aWxzLnZhbGlkO1xuXG5XZWJTcWxQb3VjaC5kZXN0cm95ID0gdXRpbHMudG9Qcm9taXNlKGZ1bmN0aW9uIChuYW1lLCBvcHRzLCBjYWxsYmFjaykge1xuICBXZWJTcWxQb3VjaC5DaGFuZ2VzLnJlbW92ZUFsbExpc3RlbmVycyhuYW1lKTtcbiAgdmFyIHNpemUgPSBnZXRTaXplKG9wdHMpO1xuICB2YXIgZGIgPSBvcGVuREIoe1xuICAgIG5hbWU6IG5hbWUsXG4gICAgdmVyc2lvbjogUE9VQ0hfVkVSU0lPTixcbiAgICBkZXNjcmlwdGlvbjogbmFtZSxcbiAgICBzaXplOiBzaXplLFxuICAgIGxvY2F0aW9uOiBvcHRzLmxvY2F0aW9uLFxuICAgIGNyZWF0ZUZyb21Mb2NhdGlvbjogb3B0cy5jcmVhdGVGcm9tTG9jYXRpb25cbiAgfSk7XG4gIGRiLnRyYW5zYWN0aW9uKGZ1bmN0aW9uICh0eCkge1xuICAgIHZhciBzdG9yZXMgPSBbRE9DX1NUT1JFLCBCWV9TRVFfU1RPUkUsIEFUVEFDSF9TVE9SRSwgTUVUQV9TVE9SRSxcbiAgICAgIExPQ0FMX1NUT1JFLCBBVFRBQ0hfQU5EX1NFUV9TVE9SRV07XG4gICAgc3RvcmVzLmZvckVhY2goZnVuY3Rpb24gKHN0b3JlKSB7XG4gICAgICB0eC5leGVjdXRlU3FsKCdEUk9QIFRBQkxFIElGIEVYSVNUUyAnICsgc3RvcmUsIFtdKTtcbiAgICB9KTtcbiAgfSwgdW5rbm93bkVycm9yKGNhbGxiYWNrKSwgZnVuY3Rpb24gKCkge1xuICAgIGlmICh1dGlscy5oYXNMb2NhbFN0b3JhZ2UoKSkge1xuICAgICAgZGVsZXRlIHdpbmRvdy5sb2NhbFN0b3JhZ2VbJ19wb3VjaF9fd2Vic3FsZGJfJyArIG5hbWVdO1xuICAgICAgZGVsZXRlIHdpbmRvdy5sb2NhbFN0b3JhZ2VbbmFtZV07XG4gICAgfVxuICAgIGNhbGxiYWNrKG51bGwsIHsnb2snOiB0cnVlfSk7XG4gIH0pO1xufSk7XG5cbldlYlNxbFBvdWNoLkNoYW5nZXMgPSBuZXcgdXRpbHMuQ2hhbmdlcygpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFdlYlNxbFBvdWNoO1xuIiwiJ3VzZSBzdHJpY3QnO1xudmFyIHV0aWxzID0gcmVxdWlyZSgnLi91dGlscycpO1xudmFyIG1lcmdlID0gcmVxdWlyZSgnLi9tZXJnZScpO1xudmFyIGVycm9ycyA9IHJlcXVpcmUoJy4vZGVwcy9lcnJvcnMnKTtcbnZhciBFRSA9IHJlcXVpcmUoJ2V2ZW50cycpLkV2ZW50RW1pdHRlcjtcbnZhciBldmFsRmlsdGVyID0gcmVxdWlyZSgnLi9ldmFsRmlsdGVyJyk7XG52YXIgZXZhbFZpZXcgPSByZXF1aXJlKCcuL2V2YWxWaWV3Jyk7XG5tb2R1bGUuZXhwb3J0cyA9IENoYW5nZXM7XG51dGlscy5pbmhlcml0cyhDaGFuZ2VzLCBFRSk7XG5cbmZ1bmN0aW9uIENoYW5nZXMoZGIsIG9wdHMsIGNhbGxiYWNrKSB7XG4gIEVFLmNhbGwodGhpcyk7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgdGhpcy5kYiA9IGRiO1xuICBvcHRzID0gb3B0cyA/IHV0aWxzLmNsb25lKG9wdHMpIDoge307XG4gIHZhciBvbGRDb21wbGV0ZSA9IGNhbGxiYWNrIHx8IG9wdHMuY29tcGxldGUgfHwgZnVuY3Rpb24gKCkge307XG4gIHZhciBjb21wbGV0ZSA9IG9wdHMuY29tcGxldGUgPSB1dGlscy5vbmNlKGZ1bmN0aW9uIChlcnIsIHJlc3ApIHtcbiAgICBpZiAoZXJyKSB7XG4gICAgICBzZWxmLmVtaXQoJ2Vycm9yJywgZXJyKTtcbiAgICB9IGVsc2Uge1xuICAgICAgc2VsZi5lbWl0KCdjb21wbGV0ZScsIHJlc3ApO1xuICAgIH1cbiAgICBzZWxmLnJlbW92ZUFsbExpc3RlbmVycygpO1xuICAgIGRiLnJlbW92ZUxpc3RlbmVyKCdkZXN0cm95ZWQnLCBvbkRlc3Ryb3kpO1xuICB9KTtcbiAgaWYgKG9sZENvbXBsZXRlKSB7XG4gICAgc2VsZi5vbignY29tcGxldGUnLCBmdW5jdGlvbiAocmVzcCkge1xuICAgICAgb2xkQ29tcGxldGUobnVsbCwgcmVzcCk7XG4gICAgfSk7XG4gICAgc2VsZi5vbignZXJyb3InLCBmdW5jdGlvbiAoZXJyKSB7XG4gICAgICBvbGRDb21wbGV0ZShlcnIpO1xuICAgIH0pO1xuICB9XG4gIHZhciBvbGRPbkNoYW5nZSA9IG9wdHMub25DaGFuZ2U7XG4gIGlmIChvbGRPbkNoYW5nZSkge1xuICAgIHNlbGYub24oJ2NoYW5nZScsIG9sZE9uQ2hhbmdlKTtcbiAgfVxuICBmdW5jdGlvbiBvbkRlc3Ryb3koKSB7XG4gICAgc2VsZi5jYW5jZWwoKTtcbiAgfVxuICBkYi5vbmNlKCdkZXN0cm95ZWQnLCBvbkRlc3Ryb3kpO1xuXG4gIG9wdHMub25DaGFuZ2UgPSBmdW5jdGlvbiAoY2hhbmdlKSB7XG4gICAgaWYgKG9wdHMuaXNDYW5jZWxsZWQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgc2VsZi5lbWl0KCdjaGFuZ2UnLCBjaGFuZ2UpO1xuICAgIGlmIChzZWxmLnN0YXJ0U2VxICYmIHNlbGYuc3RhcnRTZXEgPD0gY2hhbmdlLnNlcSkge1xuICAgICAgc2VsZi5lbWl0KCd1cHRvZGF0ZScpO1xuICAgICAgc2VsZi5zdGFydFNlcSA9IGZhbHNlO1xuICAgIH1cbiAgICBpZiAoY2hhbmdlLmRlbGV0ZWQpIHtcbiAgICAgIHNlbGYuZW1pdCgnZGVsZXRlJywgY2hhbmdlKTtcbiAgICB9IGVsc2UgaWYgKGNoYW5nZS5jaGFuZ2VzLmxlbmd0aCA9PT0gMSAmJlxuICAgICAgY2hhbmdlLmNoYW5nZXNbMF0ucmV2LnNsaWNlKDAsIDIpID09PSAnMS0nKSB7XG4gICAgICBzZWxmLmVtaXQoJ2NyZWF0ZScsIGNoYW5nZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHNlbGYuZW1pdCgndXBkYXRlJywgY2hhbmdlKTtcbiAgICB9XG4gIH07XG5cbiAgdmFyIHByb21pc2UgPSBuZXcgdXRpbHMuUHJvbWlzZShmdW5jdGlvbiAoZnVsZmlsbCwgcmVqZWN0KSB7XG4gICAgb3B0cy5jb21wbGV0ZSA9IGZ1bmN0aW9uIChlcnIsIHJlcykge1xuICAgICAgaWYgKGVycikge1xuICAgICAgICByZWplY3QoZXJyKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGZ1bGZpbGwocmVzKTtcbiAgICAgIH1cbiAgICB9O1xuICB9KTtcbiAgc2VsZi5vbmNlKCdjYW5jZWwnLCBmdW5jdGlvbiAoKSB7XG4gICAgaWYgKG9sZE9uQ2hhbmdlKSB7XG4gICAgICBzZWxmLnJlbW92ZUxpc3RlbmVyKCdjaGFuZ2UnLCBvbGRPbkNoYW5nZSk7XG4gICAgfVxuICAgIG9wdHMuY29tcGxldGUobnVsbCwge3N0YXR1czogJ2NhbmNlbGxlZCd9KTtcbiAgfSk7XG4gIHRoaXMudGhlbiA9IHByb21pc2UudGhlbi5iaW5kKHByb21pc2UpO1xuICB0aGlzWydjYXRjaCddID0gcHJvbWlzZVsnY2F0Y2gnXS5iaW5kKHByb21pc2UpO1xuICB0aGlzLnRoZW4oZnVuY3Rpb24gKHJlc3VsdCkge1xuICAgIGNvbXBsZXRlKG51bGwsIHJlc3VsdCk7XG4gIH0sIGNvbXBsZXRlKTtcblxuXG5cbiAgaWYgKCFkYi50YXNrcXVldWUuaXNSZWFkeSkge1xuICAgIGRiLnRhc2txdWV1ZS5hZGRUYXNrKGZ1bmN0aW9uICgpIHtcbiAgICAgIGlmIChzZWxmLmlzQ2FuY2VsbGVkKSB7XG4gICAgICAgIHNlbGYuZW1pdCgnY2FuY2VsJyk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzZWxmLmRvQ2hhbmdlcyhvcHRzKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfSBlbHNlIHtcbiAgICBzZWxmLmRvQ2hhbmdlcyhvcHRzKTtcbiAgfVxufVxuQ2hhbmdlcy5wcm90b3R5cGUuY2FuY2VsID0gZnVuY3Rpb24gKCkge1xuICB0aGlzLmlzQ2FuY2VsbGVkID0gdHJ1ZTtcbiAgaWYgKHRoaXMuZGIudGFza3F1ZXVlLmlzUmVhZHkpIHtcbiAgICB0aGlzLmVtaXQoJ2NhbmNlbCcpO1xuICB9XG59O1xuZnVuY3Rpb24gcHJvY2Vzc0NoYW5nZShkb2MsIG1ldGFkYXRhLCBvcHRzKSB7XG4gIHZhciBjaGFuZ2VMaXN0ID0gW3tyZXY6IGRvYy5fcmV2fV07XG4gIGlmIChvcHRzLnN0eWxlID09PSAnYWxsX2RvY3MnKSB7XG4gICAgY2hhbmdlTGlzdCA9IG1lcmdlLmNvbGxlY3RMZWF2ZXMobWV0YWRhdGEucmV2X3RyZWUpXG4gICAgLm1hcChmdW5jdGlvbiAoeCkgeyByZXR1cm4ge3JldjogeC5yZXZ9OyB9KTtcbiAgfVxuICB2YXIgY2hhbmdlID0ge1xuICAgIGlkOiBtZXRhZGF0YS5pZCxcbiAgICBjaGFuZ2VzOiBjaGFuZ2VMaXN0LFxuICAgIGRvYzogZG9jXG4gIH07XG5cbiAgaWYgKHV0aWxzLmlzRGVsZXRlZChtZXRhZGF0YSwgZG9jLl9yZXYpKSB7XG4gICAgY2hhbmdlLmRlbGV0ZWQgPSB0cnVlO1xuICB9XG4gIGlmIChvcHRzLmNvbmZsaWN0cykge1xuICAgIGNoYW5nZS5kb2MuX2NvbmZsaWN0cyA9IG1lcmdlLmNvbGxlY3RDb25mbGljdHMobWV0YWRhdGEpO1xuICAgIGlmICghY2hhbmdlLmRvYy5fY29uZmxpY3RzLmxlbmd0aCkge1xuICAgICAgZGVsZXRlIGNoYW5nZS5kb2MuX2NvbmZsaWN0cztcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGNoYW5nZTtcbn1cblxuQ2hhbmdlcy5wcm90b3R5cGUuZG9DaGFuZ2VzID0gZnVuY3Rpb24gKG9wdHMpIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICB2YXIgY2FsbGJhY2sgPSBvcHRzLmNvbXBsZXRlO1xuXG4gIG9wdHMgPSB1dGlscy5jbG9uZShvcHRzKTtcbiAgaWYgKCdsaXZlJyBpbiBvcHRzICYmICEoJ2NvbnRpbnVvdXMnIGluIG9wdHMpKSB7XG4gICAgb3B0cy5jb250aW51b3VzID0gb3B0cy5saXZlO1xuICB9XG4gIG9wdHMucHJvY2Vzc0NoYW5nZSA9IHByb2Nlc3NDaGFuZ2U7XG5cbiAgaWYgKG9wdHMuc2luY2UgPT09ICdsYXRlc3QnKSB7XG4gICAgb3B0cy5zaW5jZSA9ICdub3cnO1xuICB9XG4gIGlmICghb3B0cy5zaW5jZSkge1xuICAgIG9wdHMuc2luY2UgPSAwO1xuICB9XG4gIGlmIChvcHRzLnNpbmNlID09PSAnbm93Jykge1xuICAgIHRoaXMuZGIuaW5mbygpLnRoZW4oZnVuY3Rpb24gKGluZm8pIHtcbiAgICAgIGlmIChzZWxmLmlzQ2FuY2VsbGVkKSB7XG4gICAgICAgIGNhbGxiYWNrKG51bGwsIHtzdGF0dXM6ICdjYW5jZWxsZWQnfSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIG9wdHMuc2luY2UgPSBpbmZvLnVwZGF0ZV9zZXE7XG4gICAgICBzZWxmLmRvQ2hhbmdlcyhvcHRzKTtcbiAgICB9LCBjYWxsYmFjayk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgaWYgKG9wdHMuY29udGludW91cyAmJiBvcHRzLnNpbmNlICE9PSAnbm93Jykge1xuICAgIHRoaXMuZGIuaW5mbygpLnRoZW4oZnVuY3Rpb24gKGluZm8pIHtcbiAgICAgIHNlbGYuc3RhcnRTZXEgPSBpbmZvLnVwZGF0ZV9zZXE7XG4gICAgfSwgZnVuY3Rpb24gKGVycikge1xuICAgICAgaWYgKGVyci5pZCA9PT0gJ2lkYk51bGwnKSB7XG4gICAgICAgIC8vZGIgY2xvc2VkIGJlZm9yZSB0aGlzIHJldHVybmVkXG4gICAgICAgIC8vdGhhdHMgb2tcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgdGhyb3cgZXJyO1xuICAgIH0pO1xuICB9XG5cbiAgaWYgKHRoaXMuZGIudHlwZSgpICE9PSAnaHR0cCcgJiZcbiAgICAgIG9wdHMuZmlsdGVyICYmIHR5cGVvZiBvcHRzLmZpbHRlciA9PT0gJ3N0cmluZycgJiZcbiAgICAgICFvcHRzLmRvY19pZHMpIHtcbiAgICByZXR1cm4gdGhpcy5maWx0ZXJDaGFuZ2VzKG9wdHMpO1xuICB9XG5cbiAgaWYgKCEoJ2Rlc2NlbmRpbmcnIGluIG9wdHMpKSB7XG4gICAgb3B0cy5kZXNjZW5kaW5nID0gZmFsc2U7XG4gIH1cblxuICAvLyAwIGFuZCAxIHNob3VsZCByZXR1cm4gMSBkb2N1bWVudFxuICBvcHRzLmxpbWl0ID0gb3B0cy5saW1pdCA9PT0gMCA/IDEgOiBvcHRzLmxpbWl0O1xuICBvcHRzLmNvbXBsZXRlID0gY2FsbGJhY2s7XG4gIHZhciBuZXdQcm9taXNlID0gdGhpcy5kYi5fY2hhbmdlcyhvcHRzKTtcbiAgaWYgKG5ld1Byb21pc2UgJiYgdHlwZW9mIG5ld1Byb21pc2UuY2FuY2VsID09PSAnZnVuY3Rpb24nKSB7XG4gICAgdmFyIGNhbmNlbCA9IHNlbGYuY2FuY2VsO1xuICAgIHNlbGYuY2FuY2VsID0gdXRpbHMuZ2V0QXJndW1lbnRzKGZ1bmN0aW9uIChhcmdzKSB7XG4gICAgICBuZXdQcm9taXNlLmNhbmNlbCgpO1xuICAgICAgY2FuY2VsLmFwcGx5KHRoaXMsIGFyZ3MpO1xuICAgIH0pO1xuICB9XG59O1xuXG5DaGFuZ2VzLnByb3RvdHlwZS5maWx0ZXJDaGFuZ2VzID0gZnVuY3Rpb24gKG9wdHMpIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICB2YXIgY2FsbGJhY2sgPSBvcHRzLmNvbXBsZXRlO1xuICBpZiAob3B0cy5maWx0ZXIgPT09ICdfdmlldycpIHtcbiAgICBpZiAoIW9wdHMudmlldyB8fCB0eXBlb2Ygb3B0cy52aWV3ICE9PSAnc3RyaW5nJykge1xuICAgICAgdmFyIGVyciA9IGVycm9ycy5lcnJvcihlcnJvcnMuQkFEX1JFUVVFU1QsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICdgdmlld2AgZmlsdGVyIHBhcmFtZXRlciBpcyBub3QgcHJvdmlkZWQuJyk7XG4gICAgICBjYWxsYmFjayhlcnIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICAvLyBmZXRjaCBhIHZpZXcgZnJvbSBhIGRlc2lnbiBkb2MsIG1ha2UgaXQgYmVoYXZlIGxpa2UgYSBmaWx0ZXJcbiAgICB2YXIgdmlld05hbWUgPSBvcHRzLnZpZXcuc3BsaXQoJy8nKTtcbiAgICB0aGlzLmRiLmdldCgnX2Rlc2lnbi8nICsgdmlld05hbWVbMF0sIGZ1bmN0aW9uIChlcnIsIGRkb2MpIHtcbiAgICAgIGlmIChzZWxmLmlzQ2FuY2VsbGVkKSB7XG4gICAgICAgIGNhbGxiYWNrKG51bGwsIHtzdGF0dXM6ICdjYW5jZWxsZWQnfSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgY2FsbGJhY2soZXJyb3JzLmdlbmVyYXRlRXJyb3JGcm9tUmVzcG9uc2UoZXJyKSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGlmIChkZG9jICYmIGRkb2Mudmlld3MgJiYgZGRvYy52aWV3c1t2aWV3TmFtZVsxXV0pIHtcbiAgICAgICAgXG4gICAgICAgIHZhciBmaWx0ZXIgPSBldmFsVmlldyhkZG9jLnZpZXdzW3ZpZXdOYW1lWzFdXS5tYXApO1xuICAgICAgICBvcHRzLmZpbHRlciA9IGZpbHRlcjtcbiAgICAgICAgc2VsZi5kb0NoYW5nZXMob3B0cyk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHZhciBtc2cgPSBkZG9jLnZpZXdzID8gJ21pc3NpbmcganNvbiBrZXk6ICcgKyB2aWV3TmFtZVsxXSA6XG4gICAgICAgICdtaXNzaW5nIGpzb24ga2V5OiB2aWV3cyc7XG4gICAgICBpZiAoIWVycikge1xuICAgICAgICBlcnIgPSBlcnJvcnMuZXJyb3IoZXJyb3JzLk1JU1NJTkdfRE9DLCBtc2cpO1xuICAgICAgfVxuICAgICAgY2FsbGJhY2soZXJyKTtcbiAgICAgIHJldHVybjtcbiAgICB9KTtcbiAgfSBlbHNlIHtcbiAgICAvLyBmZXRjaCBhIGZpbHRlciBmcm9tIGEgZGVzaWduIGRvY1xuICAgIHZhciBmaWx0ZXJOYW1lID0gb3B0cy5maWx0ZXIuc3BsaXQoJy8nKTtcbiAgICB0aGlzLmRiLmdldCgnX2Rlc2lnbi8nICsgZmlsdGVyTmFtZVswXSwgZnVuY3Rpb24gKGVyciwgZGRvYykge1xuICAgICAgaWYgKHNlbGYuaXNDYW5jZWxsZWQpIHtcbiAgICAgICAgY2FsbGJhY2sobnVsbCwge3N0YXR1czogJ2NhbmNlbGxlZCd9KTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgaWYgKGVycikge1xuICAgICAgICBjYWxsYmFjayhlcnJvcnMuZ2VuZXJhdGVFcnJvckZyb21SZXNwb25zZShlcnIpKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgaWYgKGRkb2MgJiYgZGRvYy5maWx0ZXJzICYmIGRkb2MuZmlsdGVyc1tmaWx0ZXJOYW1lWzFdXSkge1xuICAgICAgICB2YXIgZmlsdGVyID0gZXZhbEZpbHRlcihkZG9jLmZpbHRlcnNbZmlsdGVyTmFtZVsxXV0pO1xuICAgICAgICBvcHRzLmZpbHRlciA9IGZpbHRlcjtcbiAgICAgICAgc2VsZi5kb0NoYW5nZXMob3B0cyk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHZhciBtc2cgPSAoZGRvYyAmJiBkZG9jLmZpbHRlcnMpID8gJ21pc3NpbmcganNvbiBrZXk6ICcgKyBmaWx0ZXJOYW1lWzFdXG4gICAgICAgICAgOiAnbWlzc2luZyBqc29uIGtleTogZmlsdGVycyc7XG4gICAgICAgIGlmICghZXJyKSB7XG4gICAgICAgICAgZXJyID0gZXJyb3JzLmVycm9yKGVycm9ycy5NSVNTSU5HX0RPQywgbXNnKTtcbiAgICAgICAgfVxuICAgICAgICBjYWxsYmFjayhlcnIpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgfSk7XG4gIH1cbn07IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzJyk7XG52YXIgcG91Y2hDb2xsYXRlID0gcmVxdWlyZSgncG91Y2hkYi1jb2xsYXRlJyk7XG52YXIgY29sbGF0ZSA9IHBvdWNoQ29sbGF0ZS5jb2xsYXRlO1xuXG5mdW5jdGlvbiB1cGRhdGVDaGVja3BvaW50KGRiLCBpZCwgY2hlY2twb2ludCwgcmV0dXJuVmFsdWUpIHtcbiAgcmV0dXJuIGRiLmdldChpZClbXCJjYXRjaFwiXShmdW5jdGlvbiAoZXJyKSB7XG4gICAgaWYgKGVyci5zdGF0dXMgPT09IDQwNCkge1xuICAgICAgaWYgKGRiLnR5cGUoKSA9PT0gJ2h0dHAnKSB7XG4gICAgICAgIHV0aWxzLmV4cGxhaW40MDQoXG4gICAgICAgICAgJ1BvdWNoREIgaXMganVzdCBjaGVja2luZyBpZiBhIHJlbW90ZSBjaGVja3BvaW50IGV4aXN0cy4nKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiB7X2lkOiBpZH07XG4gICAgfVxuICAgIHRocm93IGVycjtcbiAgfSkudGhlbihmdW5jdGlvbiAoZG9jKSB7XG4gICAgaWYgKHJldHVyblZhbHVlLmNhbmNlbGxlZCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBkb2MubGFzdF9zZXEgPSBjaGVja3BvaW50O1xuICAgIHJldHVybiBkYi5wdXQoZG9jKVtcImNhdGNoXCJdKGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgIGlmIChlcnIuc3RhdHVzID09PSA0MDkpIHtcbiAgICAgICAgLy8gcmV0cnk7IHNvbWVvbmUgaXMgdHJ5aW5nIHRvIHdyaXRlIGEgY2hlY2twb2ludCBzaW11bHRhbmVvdXNseVxuICAgICAgICByZXR1cm4gdXBkYXRlQ2hlY2twb2ludChkYiwgaWQsIGNoZWNrcG9pbnQsIHJldHVyblZhbHVlKTtcbiAgICAgIH1cbiAgICAgIHRocm93IGVycjtcbiAgICB9KTtcbiAgfSk7XG59XG5cbmZ1bmN0aW9uIENoZWNrcG9pbnRlcihzcmMsIHRhcmdldCwgaWQsIHJldHVyblZhbHVlKSB7XG4gIHRoaXMuc3JjID0gc3JjO1xuICB0aGlzLnRhcmdldCA9IHRhcmdldDtcbiAgdGhpcy5pZCA9IGlkO1xuICB0aGlzLnJldHVyblZhbHVlID0gcmV0dXJuVmFsdWU7XG59XG5cbkNoZWNrcG9pbnRlci5wcm90b3R5cGUud3JpdGVDaGVja3BvaW50ID0gZnVuY3Rpb24gKGNoZWNrcG9pbnQpIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICByZXR1cm4gdGhpcy51cGRhdGVUYXJnZXQoY2hlY2twb2ludCkudGhlbihmdW5jdGlvbiAoKSB7XG4gICAgcmV0dXJuIHNlbGYudXBkYXRlU291cmNlKGNoZWNrcG9pbnQpO1xuICB9KTtcbn07XG5cbkNoZWNrcG9pbnRlci5wcm90b3R5cGUudXBkYXRlVGFyZ2V0ID0gZnVuY3Rpb24gKGNoZWNrcG9pbnQpIHtcbiAgcmV0dXJuIHVwZGF0ZUNoZWNrcG9pbnQodGhpcy50YXJnZXQsIHRoaXMuaWQsIGNoZWNrcG9pbnQsIHRoaXMucmV0dXJuVmFsdWUpO1xufTtcblxuQ2hlY2twb2ludGVyLnByb3RvdHlwZS51cGRhdGVTb3VyY2UgPSBmdW5jdGlvbiAoY2hlY2twb2ludCkge1xuICB2YXIgc2VsZiA9IHRoaXM7XG4gIGlmICh0aGlzLnJlYWRPbmx5U291cmNlKSB7XG4gICAgcmV0dXJuIHV0aWxzLlByb21pc2UucmVzb2x2ZSh0cnVlKTtcbiAgfVxuICByZXR1cm4gdXBkYXRlQ2hlY2twb2ludCh0aGlzLnNyYywgdGhpcy5pZCwgY2hlY2twb2ludCwgdGhpcy5yZXR1cm5WYWx1ZSlbXG4gICAgXCJjYXRjaFwiXShmdW5jdGlvbiAoZXJyKSB7XG4gICAgICB2YXIgaXNGb3JiaWRkZW4gPSB0eXBlb2YgZXJyLnN0YXR1cyA9PT0gJ251bWJlcicgJiZcbiAgICAgICAgTWF0aC5mbG9vcihlcnIuc3RhdHVzIC8gMTAwKSA9PT0gNDtcbiAgICAgIGlmIChpc0ZvcmJpZGRlbikge1xuICAgICAgICBzZWxmLnJlYWRPbmx5U291cmNlID0gdHJ1ZTtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9XG4gICAgICB0aHJvdyBlcnI7XG4gICAgfSk7XG59O1xuXG5DaGVja3BvaW50ZXIucHJvdG90eXBlLmdldENoZWNrcG9pbnQgPSBmdW5jdGlvbiAoKSB7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgcmV0dXJuIHNlbGYudGFyZ2V0LmdldChzZWxmLmlkKS50aGVuKGZ1bmN0aW9uICh0YXJnZXREb2MpIHtcbiAgICByZXR1cm4gc2VsZi5zcmMuZ2V0KHNlbGYuaWQpLnRoZW4oZnVuY3Rpb24gKHNvdXJjZURvYykge1xuICAgICAgaWYgKGNvbGxhdGUodGFyZ2V0RG9jLmxhc3Rfc2VxLCBzb3VyY2VEb2MubGFzdF9zZXEpID09PSAwKSB7XG4gICAgICAgIHJldHVybiBzb3VyY2VEb2MubGFzdF9zZXE7XG4gICAgICB9XG4gICAgICByZXR1cm4gMDtcbiAgICB9LCBmdW5jdGlvbiAoZXJyKSB7XG4gICAgICBpZiAoZXJyLnN0YXR1cyA9PT0gNDA0ICYmIHRhcmdldERvYy5sYXN0X3NlcSkge1xuICAgICAgICByZXR1cm4gc2VsZi5zcmMucHV0KHtcbiAgICAgICAgICBfaWQ6IHNlbGYuaWQsXG4gICAgICAgICAgbGFzdF9zZXE6IDBcbiAgICAgICAgfSkudGhlbihmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgcmV0dXJuIDA7XG4gICAgICAgIH0sIGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgICAgICBpZiAoZXJyLnN0YXR1cyA9PT0gNDAxKSB7XG4gICAgICAgICAgICBzZWxmLnJlYWRPbmx5U291cmNlID0gdHJ1ZTtcbiAgICAgICAgICAgIHJldHVybiB0YXJnZXREb2MubGFzdF9zZXE7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiAwO1xuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICAgIHRocm93IGVycjtcbiAgICB9KTtcbiAgfSlbXCJjYXRjaFwiXShmdW5jdGlvbiAoZXJyKSB7XG4gICAgaWYgKGVyci5zdGF0dXMgIT09IDQwNCkge1xuICAgICAgdGhyb3cgZXJyO1xuICAgIH1cbiAgICByZXR1cm4gMDtcbiAgfSk7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IENoZWNrcG9pbnRlcjtcbiIsIi8qZ2xvYmFscyBjb3Jkb3ZhICovXG5cInVzZSBzdHJpY3RcIjtcblxudmFyIEFkYXB0ZXIgPSByZXF1aXJlKCcuL2FkYXB0ZXInKTtcbnZhciB1dGlscyA9IHJlcXVpcmUoJy4vdXRpbHMnKTtcbnZhciBUYXNrUXVldWUgPSByZXF1aXJlKCcuL3Rhc2txdWV1ZScpO1xudmFyIFByb21pc2UgPSB1dGlscy5Qcm9taXNlO1xuXG5mdW5jdGlvbiBkZWZhdWx0Q2FsbGJhY2soZXJyKSB7XG4gIGlmIChlcnIgJiYgZ2xvYmFsLmRlYnVnKSB7XG4gICAgY29uc29sZS5lcnJvcihlcnIpO1xuICB9XG59XG5cbnV0aWxzLmluaGVyaXRzKFBvdWNoREIsIEFkYXB0ZXIpO1xuZnVuY3Rpb24gUG91Y2hEQihuYW1lLCBvcHRzLCBjYWxsYmFjaykge1xuXG4gIGlmICghKHRoaXMgaW5zdGFuY2VvZiBQb3VjaERCKSkge1xuICAgIHJldHVybiBuZXcgUG91Y2hEQihuYW1lLCBvcHRzLCBjYWxsYmFjayk7XG4gIH1cbiAgdmFyIHNlbGYgPSB0aGlzO1xuICBpZiAodHlwZW9mIG9wdHMgPT09ICdmdW5jdGlvbicgfHwgdHlwZW9mIG9wdHMgPT09ICd1bmRlZmluZWQnKSB7XG4gICAgY2FsbGJhY2sgPSBvcHRzO1xuICAgIG9wdHMgPSB7fTtcbiAgfVxuXG4gIGlmIChuYW1lICYmIHR5cGVvZiBuYW1lID09PSAnb2JqZWN0Jykge1xuICAgIG9wdHMgPSBuYW1lO1xuICAgIG5hbWUgPSB1bmRlZmluZWQ7XG4gIH1cbiAgaWYgKHR5cGVvZiBjYWxsYmFjayA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBjYWxsYmFjayA9IGRlZmF1bHRDYWxsYmFjaztcbiAgfVxuICBvcHRzID0gb3B0cyB8fCB7fTtcbiAgdGhpcy5fX29wdHMgPSBvcHRzO1xuICB2YXIgb2xkQ0IgPSBjYWxsYmFjaztcbiAgc2VsZi5hdXRvX2NvbXBhY3Rpb24gPSBvcHRzLmF1dG9fY29tcGFjdGlvbjtcbiAgc2VsZi5wcmVmaXggPSBQb3VjaERCLnByZWZpeDtcbiAgQWRhcHRlci5jYWxsKHNlbGYpO1xuICBzZWxmLnRhc2txdWV1ZSA9IG5ldyBUYXNrUXVldWUoKTtcbiAgdmFyIHByb21pc2UgPSBuZXcgUHJvbWlzZShmdW5jdGlvbiAoZnVsZmlsbCwgcmVqZWN0KSB7XG4gICAgY2FsbGJhY2sgPSBmdW5jdGlvbiAoZXJyLCByZXNwKSB7XG4gICAgICBpZiAoZXJyKSB7XG4gICAgICAgIHJldHVybiByZWplY3QoZXJyKTtcbiAgICAgIH1cbiAgICAgIGRlbGV0ZSByZXNwLnRoZW47XG4gICAgICBmdWxmaWxsKHJlc3ApO1xuICAgIH07XG4gIFxuICAgIG9wdHMgPSB1dGlscy5jbG9uZShvcHRzKTtcbiAgICB2YXIgb3JpZ2luYWxOYW1lID0gb3B0cy5uYW1lIHx8IG5hbWU7XG4gICAgdmFyIGJhY2tlbmQsIGVycm9yO1xuICAgIChmdW5jdGlvbiAoKSB7XG4gICAgICB0cnkge1xuXG4gICAgICAgIGlmICh0eXBlb2Ygb3JpZ2luYWxOYW1lICE9PSAnc3RyaW5nJykge1xuICAgICAgICAgIGVycm9yID0gbmV3IEVycm9yKCdNaXNzaW5nL2ludmFsaWQgREIgbmFtZScpO1xuICAgICAgICAgIGVycm9yLmNvZGUgPSA0MDA7XG4gICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cblxuICAgICAgICBiYWNrZW5kID0gUG91Y2hEQi5wYXJzZUFkYXB0ZXIob3JpZ2luYWxOYW1lLCBvcHRzKTtcbiAgICAgICAgXG4gICAgICAgIG9wdHMub3JpZ2luYWxOYW1lID0gb3JpZ2luYWxOYW1lO1xuICAgICAgICBvcHRzLm5hbWUgPSBiYWNrZW5kLm5hbWU7XG4gICAgICAgIGlmIChvcHRzLnByZWZpeCAmJiBiYWNrZW5kLmFkYXB0ZXIgIT09ICdodHRwJyAmJlxuICAgICAgICAgICAgYmFja2VuZC5hZGFwdGVyICE9PSAnaHR0cHMnKSB7XG4gICAgICAgICAgb3B0cy5uYW1lID0gb3B0cy5wcmVmaXggKyBvcHRzLm5hbWU7XG4gICAgICAgIH1cbiAgICAgICAgb3B0cy5hZGFwdGVyID0gb3B0cy5hZGFwdGVyIHx8IGJhY2tlbmQuYWRhcHRlcjtcbiAgICAgICAgc2VsZi5fYWRhcHRlciA9IG9wdHMuYWRhcHRlcjtcbiAgICAgICAgc2VsZi5fZGJfbmFtZSA9IG9yaWdpbmFsTmFtZTtcbiAgICAgICAgaWYgKCFQb3VjaERCLmFkYXB0ZXJzW29wdHMuYWRhcHRlcl0pIHtcbiAgICAgICAgICBlcnJvciA9IG5ldyBFcnJvcignQWRhcHRlciBpcyBtaXNzaW5nJyk7XG4gICAgICAgICAgZXJyb3IuY29kZSA9IDQwNDtcbiAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghUG91Y2hEQi5hZGFwdGVyc1tvcHRzLmFkYXB0ZXJdLnZhbGlkKCkpIHtcbiAgICAgICAgICBlcnJvciA9IG5ldyBFcnJvcignSW52YWxpZCBBZGFwdGVyJyk7XG4gICAgICAgICAgZXJyb3IuY29kZSA9IDQwNDtcbiAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIHNlbGYudGFza3F1ZXVlLmZhaWwoZXJyKTtcbiAgICAgICAgc2VsZi5jaGFuZ2VzID0gdXRpbHMudG9Qcm9taXNlKGZ1bmN0aW9uIChvcHRzKSB7XG4gICAgICAgICAgaWYgKG9wdHMuY29tcGxldGUpIHtcbiAgICAgICAgICAgIG9wdHMuY29tcGxldGUoZXJyKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0oKSk7XG4gICAgaWYgKGVycm9yKSB7XG4gICAgICByZXR1cm4gcmVqZWN0KGVycm9yKTsgLy8gY29uc3RydWN0b3IgZXJyb3IsIHNlZSBhYm92ZVxuICAgIH1cbiAgICBzZWxmLmFkYXB0ZXIgPSBvcHRzLmFkYXB0ZXI7XG5cbiAgICAvLyBuZWVkcyBhY2Nlc3MgdG8gUG91Y2hEQjtcbiAgICBzZWxmLnJlcGxpY2F0ZSA9IHt9O1xuXG4gICAgc2VsZi5yZXBsaWNhdGUuZnJvbSA9IGZ1bmN0aW9uICh1cmwsIG9wdHMsIGNhbGxiYWNrKSB7XG4gICAgICByZXR1cm4gc2VsZi5jb25zdHJ1Y3Rvci5yZXBsaWNhdGUodXJsLCBzZWxmLCBvcHRzLCBjYWxsYmFjayk7XG4gICAgfTtcblxuICAgIHNlbGYucmVwbGljYXRlLnRvID0gZnVuY3Rpb24gKHVybCwgb3B0cywgY2FsbGJhY2spIHtcbiAgICAgIHJldHVybiBzZWxmLmNvbnN0cnVjdG9yLnJlcGxpY2F0ZShzZWxmLCB1cmwsIG9wdHMsIGNhbGxiYWNrKTtcbiAgICB9O1xuXG4gICAgc2VsZi5zeW5jID0gZnVuY3Rpb24gKGRiTmFtZSwgb3B0cywgY2FsbGJhY2spIHtcbiAgICAgIHJldHVybiBzZWxmLmNvbnN0cnVjdG9yLnN5bmMoc2VsZiwgZGJOYW1lLCBvcHRzLCBjYWxsYmFjayk7XG4gICAgfTtcblxuICAgIHNlbGYucmVwbGljYXRlLnN5bmMgPSBzZWxmLnN5bmM7XG5cbiAgICBzZWxmLmRlc3Ryb3kgPSB1dGlscy5hZGFwdGVyRnVuKCdkZXN0cm95JywgZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgICB2YXIgb3B0cyA9IHRoaXMuX19vcHRzIHx8IHt9O1xuICAgICAgc2VsZi5pbmZvKGZ1bmN0aW9uIChlcnIsIGluZm8pIHtcbiAgICAgICAgaWYgKGVycikge1xuICAgICAgICAgIHJldHVybiBjYWxsYmFjayhlcnIpO1xuICAgICAgICB9XG4gICAgICAgIG9wdHMuaW50ZXJuYWwgPSB0cnVlO1xuICAgICAgICBzZWxmLmNvbnN0cnVjdG9yLmRlc3Ryb3koaW5mby5kYl9uYW1lLCBvcHRzLCBjYWxsYmFjayk7XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIFBvdWNoREIuYWRhcHRlcnNbb3B0cy5hZGFwdGVyXS5jYWxsKHNlbGYsIG9wdHMsIGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICAgICAgc2VsZi50YXNrcXVldWUuZmFpbChlcnIpO1xuICAgICAgICAgIGNhbGxiYWNrKGVycik7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgZnVuY3Rpb24gZGVzdHJ1Y3Rpb25MaXN0ZW5lcihldmVudCkge1xuICAgICAgICBpZiAoZXZlbnQgPT09ICdkZXN0cm95ZWQnKSB7XG4gICAgICAgICAgc2VsZi5lbWl0KCdkZXN0cm95ZWQnKTtcbiAgICAgICAgICBQb3VjaERCLnJlbW92ZUxpc3RlbmVyKG9yaWdpbmFsTmFtZSwgZGVzdHJ1Y3Rpb25MaXN0ZW5lcik7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIFBvdWNoREIub24ob3JpZ2luYWxOYW1lLCBkZXN0cnVjdGlvbkxpc3RlbmVyKTtcbiAgICAgIHNlbGYuZW1pdCgnY3JlYXRlZCcsIHNlbGYpO1xuICAgICAgUG91Y2hEQi5lbWl0KCdjcmVhdGVkJywgb3B0cy5vcmlnaW5hbE5hbWUpO1xuICAgICAgc2VsZi50YXNrcXVldWUucmVhZHkoc2VsZik7XG4gICAgICBjYWxsYmFjayhudWxsLCBzZWxmKTtcbiAgICB9KTtcblxuICAgIGlmIChvcHRzLnNraXBTZXR1cCkge1xuICAgICAgc2VsZi50YXNrcXVldWUucmVhZHkoc2VsZik7XG4gICAgICBwcm9jZXNzLm5leHRUaWNrKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgY2FsbGJhY2sobnVsbCwgc2VsZik7XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBpZiAodXRpbHMuaXNDb3Jkb3ZhKCkpIHtcbiAgICAgIC8vdG8gaW5mb3JtIHdlYnNxbCBhZGFwdGVyIHRoYXQgd2UgY2FuIHVzZSBhcGlcbiAgICAgIGNvcmRvdmEuZmlyZVdpbmRvd0V2ZW50KG9wdHMubmFtZSArIFwiX3BvdWNoXCIsIHt9KTtcbiAgICB9XG4gIH0pO1xuICBwcm9taXNlLnRoZW4oZnVuY3Rpb24gKHJlc3ApIHtcbiAgICBvbGRDQihudWxsLCByZXNwKTtcbiAgfSwgb2xkQ0IpO1xuICBzZWxmLnRoZW4gPSBwcm9taXNlLnRoZW4uYmluZChwcm9taXNlKTtcbiAgc2VsZltcImNhdGNoXCJdID0gcHJvbWlzZVtcImNhdGNoXCJdLmJpbmQocHJvbWlzZSk7XG59XG5cblBvdWNoREIuZGVidWcgPSByZXF1aXJlKCdkZWJ1ZycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFBvdWNoREI7XG4iLCJcInVzZSBzdHJpY3RcIjtcblxudmFyIHJlcXVlc3QgPSByZXF1aXJlKCdyZXF1ZXN0Jyk7XG5cbnZhciBidWZmZXIgPSByZXF1aXJlKCcuL2J1ZmZlcicpO1xudmFyIGVycm9ycyA9IHJlcXVpcmUoJy4vZXJyb3JzJyk7XG52YXIgdXRpbHMgPSByZXF1aXJlKCcuLi91dGlscycpO1xuXG5mdW5jdGlvbiBhamF4KG9wdGlvbnMsIGFkYXB0ZXJDYWxsYmFjaykge1xuXG4gIHZhciByZXF1ZXN0Q29tcGxldGVkID0gZmFsc2U7XG4gIHZhciBjYWxsYmFjayA9IHV0aWxzLmdldEFyZ3VtZW50cyhmdW5jdGlvbiAoYXJncykge1xuICAgIGlmIChyZXF1ZXN0Q29tcGxldGVkKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGFkYXB0ZXJDYWxsYmFjay5hcHBseSh0aGlzLCBhcmdzKTtcbiAgICByZXF1ZXN0Q29tcGxldGVkID0gdHJ1ZTtcbiAgfSk7XG5cbiAgaWYgKHR5cGVvZiBvcHRpb25zID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICBjYWxsYmFjayA9IG9wdGlvbnM7XG4gICAgb3B0aW9ucyA9IHt9O1xuICB9XG5cbiAgb3B0aW9ucyA9IHV0aWxzLmNsb25lKG9wdGlvbnMpO1xuXG4gIHZhciBkZWZhdWx0T3B0aW9ucyA9IHtcbiAgICBtZXRob2QgOiBcIkdFVFwiLFxuICAgIGhlYWRlcnM6IHt9LFxuICAgIGpzb246IHRydWUsXG4gICAgcHJvY2Vzc0RhdGE6IHRydWUsXG4gICAgdGltZW91dDogMTAwMDAsXG4gICAgY2FjaGU6IGZhbHNlXG4gIH07XG5cbiAgb3B0aW9ucyA9IHV0aWxzLmV4dGVuZCh0cnVlLCBkZWZhdWx0T3B0aW9ucywgb3B0aW9ucyk7XG5cblxuICBmdW5jdGlvbiBvblN1Y2Nlc3Mob2JqLCByZXNwLCBjYikge1xuICAgIGlmICghb3B0aW9ucy5iaW5hcnkgJiYgIW9wdGlvbnMuanNvbiAmJiBvcHRpb25zLnByb2Nlc3NEYXRhICYmXG4gICAgICB0eXBlb2Ygb2JqICE9PSAnc3RyaW5nJykge1xuICAgICAgb2JqID0gSlNPTi5zdHJpbmdpZnkob2JqKTtcbiAgICB9IGVsc2UgaWYgKCFvcHRpb25zLmJpbmFyeSAmJiBvcHRpb25zLmpzb24gJiYgdHlwZW9mIG9iaiA9PT0gJ3N0cmluZycpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIG9iaiA9IEpTT04ucGFyc2Uob2JqKTtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgLy8gUHJvYmFibHkgYSBtYWxmb3JtZWQgSlNPTiBmcm9tIHNlcnZlclxuICAgICAgICByZXR1cm4gY2IoZSk7XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChBcnJheS5pc0FycmF5KG9iaikpIHtcbiAgICAgIG9iaiA9IG9iai5tYXAoZnVuY3Rpb24gKHYpIHtcbiAgICAgICAgaWYgKHYuZXJyb3IgfHwgdi5taXNzaW5nKSB7XG4gICAgICAgICAgcmV0dXJuIGVycm9ycy5nZW5lcmF0ZUVycm9yRnJvbVJlc3BvbnNlKHYpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJldHVybiB2O1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG4gICAgY2IobnVsbCwgb2JqLCByZXNwKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIG9uRXJyb3IoZXJyLCBjYikge1xuICAgIHZhciBlcnJQYXJzZWQsIGVyck9iajtcbiAgICBpZiAoZXJyLmNvZGUgJiYgZXJyLnN0YXR1cykge1xuICAgICAgdmFyIGVycjIgPSBuZXcgRXJyb3IoZXJyLm1lc3NhZ2UgfHwgZXJyLmNvZGUpO1xuICAgICAgZXJyMi5zdGF0dXMgPSBlcnIuc3RhdHVzO1xuICAgICAgcmV0dXJuIGNiKGVycjIpO1xuICAgIH1cbiAgICB0cnkge1xuICAgICAgZXJyUGFyc2VkID0gSlNPTi5wYXJzZShlcnIucmVzcG9uc2VUZXh0KTtcbiAgICAgIC8vd291bGQgcHJlZmVyIG5vdCB0byBoYXZlIGEgdHJ5L2NhdGNoIGNsYXVzZVxuICAgICAgZXJyT2JqID0gZXJyb3JzLmdlbmVyYXRlRXJyb3JGcm9tUmVzcG9uc2UoZXJyUGFyc2VkKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBlcnJPYmogPSBlcnJvcnMuZ2VuZXJhdGVFcnJvckZyb21SZXNwb25zZShlcnIpO1xuICAgIH1cbiAgICBjYihlcnJPYmopO1xuICB9XG5cblxuICBpZiAob3B0aW9ucy5qc29uKSB7XG4gICAgaWYgKCFvcHRpb25zLmJpbmFyeSkge1xuICAgICAgb3B0aW9ucy5oZWFkZXJzLkFjY2VwdCA9ICdhcHBsaWNhdGlvbi9qc29uJztcbiAgICB9XG4gICAgb3B0aW9ucy5oZWFkZXJzWydDb250ZW50LVR5cGUnXSA9IG9wdGlvbnMuaGVhZGVyc1snQ29udGVudC1UeXBlJ10gfHxcbiAgICAgICdhcHBsaWNhdGlvbi9qc29uJztcbiAgfVxuXG4gIGlmIChvcHRpb25zLmJpbmFyeSkge1xuICAgIG9wdGlvbnMuZW5jb2RpbmcgPSBudWxsO1xuICAgIG9wdGlvbnMuanNvbiA9IGZhbHNlO1xuICB9XG5cbiAgaWYgKCFvcHRpb25zLnByb2Nlc3NEYXRhKSB7XG4gICAgb3B0aW9ucy5qc29uID0gZmFsc2U7XG4gIH1cblxuICBmdW5jdGlvbiBkZWZhdWx0Qm9keShkYXRhKSB7XG4gICAgaWYgKHByb2Nlc3MuYnJvd3Nlcikge1xuICAgICAgcmV0dXJuICcnO1xuICAgIH1cbiAgICByZXR1cm4gbmV3IGJ1ZmZlcignJywgJ2JpbmFyeScpO1xuICB9XG5cbiAgcmV0dXJuIHJlcXVlc3Qob3B0aW9ucywgZnVuY3Rpb24gKGVyciwgcmVzcG9uc2UsIGJvZHkpIHtcbiAgICBpZiAoZXJyKSB7XG4gICAgICBlcnIuc3RhdHVzID0gcmVzcG9uc2UgPyByZXNwb25zZS5zdGF0dXNDb2RlIDogNDAwO1xuICAgICAgcmV0dXJuIG9uRXJyb3IoZXJyLCBjYWxsYmFjayk7XG4gICAgfVxuXG4gICAgdmFyIGVycm9yO1xuICAgIHZhciBjb250ZW50X3R5cGUgPSByZXNwb25zZS5oZWFkZXJzICYmIHJlc3BvbnNlLmhlYWRlcnNbJ2NvbnRlbnQtdHlwZSddO1xuICAgIHZhciBkYXRhID0gYm9keSB8fCBkZWZhdWx0Qm9keSgpO1xuXG4gICAgLy8gQ291Y2hEQiBkb2Vzbid0IGFsd2F5cyByZXR1cm4gdGhlIHJpZ2h0IGNvbnRlbnQtdHlwZSBmb3IgSlNPTiBkYXRhLCBzb1xuICAgIC8vIHdlIGNoZWNrIGZvciBeeyBhbmQgfSQgKGlnbm9yaW5nIGxlYWRpbmcvdHJhaWxpbmcgd2hpdGVzcGFjZSlcbiAgICBpZiAoIW9wdGlvbnMuYmluYXJ5ICYmIChvcHRpb25zLmpzb24gfHwgIW9wdGlvbnMucHJvY2Vzc0RhdGEpICYmXG4gICAgICAgIHR5cGVvZiBkYXRhICE9PSAnb2JqZWN0JyAmJlxuICAgICAgICAoL2pzb24vLnRlc3QoY29udGVudF90eXBlKSB8fFxuICAgICAgICAgKC9eW1xcc10qXFx7Ly50ZXN0KGRhdGEpICYmIC9cXH1bXFxzXSokLy50ZXN0KGRhdGEpKSkpIHtcbiAgICAgIGRhdGEgPSBKU09OLnBhcnNlKGRhdGEpO1xuICAgIH1cblxuICAgIGlmIChyZXNwb25zZS5zdGF0dXNDb2RlID49IDIwMCAmJiByZXNwb25zZS5zdGF0dXNDb2RlIDwgMzAwKSB7XG4gICAgICBvblN1Y2Nlc3MoZGF0YSwgcmVzcG9uc2UsIGNhbGxiYWNrKTtcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKG9wdGlvbnMuYmluYXJ5KSB7XG4gICAgICAgIGRhdGEgPSBKU09OLnBhcnNlKGRhdGEudG9TdHJpbmcoKSk7XG4gICAgICB9XG4gICAgICBlcnJvciA9IGVycm9ycy5nZW5lcmF0ZUVycm9yRnJvbVJlc3BvbnNlKGRhdGEpO1xuICAgICAgZXJyb3Iuc3RhdHVzID0gcmVzcG9uc2Uuc3RhdHVzQ29kZTtcbiAgICAgIGNhbGxiYWNrKGVycm9yKTtcbiAgICB9XG4gIH0pO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGFqYXg7XG4iLCJcInVzZSBzdHJpY3RcIjtcblxuLy9BYnN0cmFjdHMgY29uc3RydWN0aW5nIGEgQmxvYiBvYmplY3QsIHNvIGl0IGFsc28gd29ya3MgaW4gb2xkZXJcbi8vYnJvd3NlcnMgdGhhdCBkb24ndCBzdXBwb3J0IHRoZSBuYXRpdmUgQmxvYiBjb25zdHJ1Y3Rvci4gKGkuZS5cbi8vb2xkIFF0V2ViS2l0IHZlcnNpb25zLCBhdCBsZWFzdCkuXG5mdW5jdGlvbiBjcmVhdGVCbG9iKHBhcnRzLCBwcm9wZXJ0aWVzKSB7XG4gIHBhcnRzID0gcGFydHMgfHwgW107XG4gIHByb3BlcnRpZXMgPSBwcm9wZXJ0aWVzIHx8IHt9O1xuICB0cnkge1xuICAgIHJldHVybiBuZXcgQmxvYihwYXJ0cywgcHJvcGVydGllcyk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBpZiAoZS5uYW1lICE9PSBcIlR5cGVFcnJvclwiKSB7XG4gICAgICB0aHJvdyBlO1xuICAgIH1cbiAgICB2YXIgQmxvYkJ1aWxkZXIgPSBnbG9iYWwuQmxvYkJ1aWxkZXIgfHxcbiAgICAgICAgICAgICAgICAgICAgICBnbG9iYWwuTVNCbG9iQnVpbGRlciB8fFxuICAgICAgICAgICAgICAgICAgICAgIGdsb2JhbC5Nb3pCbG9iQnVpbGRlciB8fFxuICAgICAgICAgICAgICAgICAgICAgIGdsb2JhbC5XZWJLaXRCbG9iQnVpbGRlcjtcbiAgICB2YXIgYnVpbGRlciA9IG5ldyBCbG9iQnVpbGRlcigpO1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcGFydHMubGVuZ3RoOyBpICs9IDEpIHtcbiAgICAgIGJ1aWxkZXIuYXBwZW5kKHBhcnRzW2ldKTtcbiAgICB9XG4gICAgcmV0dXJuIGJ1aWxkZXIuZ2V0QmxvYihwcm9wZXJ0aWVzLnR5cGUpO1xuICB9XG59XG5cbm1vZHVsZS5leHBvcnRzID0gY3JlYXRlQmxvYjtcblxuIiwiLy8gaGV5IGd1ZXNzIHdoYXQsIHdlIGRvbid0IG5lZWQgdGhpcyBpbiB0aGUgYnJvd3NlclxubW9kdWxlLmV4cG9ydHMgPSB7fTsiLCJcInVzZSBzdHJpY3RcIjtcblxudmFyIGluaGVyaXRzID0gcmVxdWlyZSgnaW5oZXJpdHMnKTtcbmluaGVyaXRzKFBvdWNoRXJyb3IsIEVycm9yKTtcblxuZnVuY3Rpb24gUG91Y2hFcnJvcihvcHRzKSB7XG4gIEVycm9yLmNhbGwob3B0cy5yZWFzb24pO1xuICB0aGlzLnN0YXR1cyA9IG9wdHMuc3RhdHVzO1xuICB0aGlzLm5hbWUgPSBvcHRzLmVycm9yO1xuICB0aGlzLm1lc3NhZ2UgPSBvcHRzLnJlYXNvbjtcbiAgdGhpcy5lcnJvciA9IHRydWU7XG59XG5cblBvdWNoRXJyb3IucHJvdG90eXBlLnRvU3RyaW5nID0gZnVuY3Rpb24gKCkge1xuICByZXR1cm4gSlNPTi5zdHJpbmdpZnkoe1xuICAgIHN0YXR1czogdGhpcy5zdGF0dXMsXG4gICAgbmFtZTogdGhpcy5uYW1lLFxuICAgIG1lc3NhZ2U6IHRoaXMubWVzc2FnZVxuICB9KTtcbn07XG5cbmV4cG9ydHMuVU5BVVRIT1JJWkVEID0gbmV3IFBvdWNoRXJyb3Ioe1xuICBzdGF0dXM6IDQwMSxcbiAgZXJyb3I6ICd1bmF1dGhvcml6ZWQnLFxuICByZWFzb246IFwiTmFtZSBvciBwYXNzd29yZCBpcyBpbmNvcnJlY3QuXCJcbn0pO1xuXG5leHBvcnRzLk1JU1NJTkdfQlVMS19ET0NTID0gbmV3IFBvdWNoRXJyb3Ioe1xuICBzdGF0dXM6IDQwMCxcbiAgZXJyb3I6ICdiYWRfcmVxdWVzdCcsXG4gIHJlYXNvbjogXCJNaXNzaW5nIEpTT04gbGlzdCBvZiAnZG9jcydcIlxufSk7XG5cbmV4cG9ydHMuTUlTU0lOR19ET0MgPSBuZXcgUG91Y2hFcnJvcih7XG4gIHN0YXR1czogNDA0LFxuICBlcnJvcjogJ25vdF9mb3VuZCcsXG4gIHJlYXNvbjogJ21pc3NpbmcnXG59KTtcblxuZXhwb3J0cy5SRVZfQ09ORkxJQ1QgPSBuZXcgUG91Y2hFcnJvcih7XG4gIHN0YXR1czogNDA5LFxuICBlcnJvcjogJ2NvbmZsaWN0JyxcbiAgcmVhc29uOiAnRG9jdW1lbnQgdXBkYXRlIGNvbmZsaWN0J1xufSk7XG5cbmV4cG9ydHMuSU5WQUxJRF9JRCA9IG5ldyBQb3VjaEVycm9yKHtcbiAgc3RhdHVzOiA0MDAsXG4gIGVycm9yOiAnaW52YWxpZF9pZCcsXG4gIHJlYXNvbjogJ19pZCBmaWVsZCBtdXN0IGNvbnRhaW4gYSBzdHJpbmcnXG59KTtcblxuZXhwb3J0cy5NSVNTSU5HX0lEID0gbmV3IFBvdWNoRXJyb3Ioe1xuICBzdGF0dXM6IDQxMixcbiAgZXJyb3I6ICdtaXNzaW5nX2lkJyxcbiAgcmVhc29uOiAnX2lkIGlzIHJlcXVpcmVkIGZvciBwdXRzJ1xufSk7XG5cbmV4cG9ydHMuUkVTRVJWRURfSUQgPSBuZXcgUG91Y2hFcnJvcih7XG4gIHN0YXR1czogNDAwLFxuICBlcnJvcjogJ2JhZF9yZXF1ZXN0JyxcbiAgcmVhc29uOiAnT25seSByZXNlcnZlZCBkb2N1bWVudCBpZHMgbWF5IHN0YXJ0IHdpdGggdW5kZXJzY29yZS4nXG59KTtcblxuZXhwb3J0cy5OT1RfT1BFTiA9IG5ldyBQb3VjaEVycm9yKHtcbiAgc3RhdHVzOiA0MTIsXG4gIGVycm9yOiAncHJlY29uZGl0aW9uX2ZhaWxlZCcsXG4gIHJlYXNvbjogJ0RhdGFiYXNlIG5vdCBvcGVuJ1xufSk7XG5cbmV4cG9ydHMuVU5LTk9XTl9FUlJPUiA9IG5ldyBQb3VjaEVycm9yKHtcbiAgc3RhdHVzOiA1MDAsXG4gIGVycm9yOiAndW5rbm93bl9lcnJvcicsXG4gIHJlYXNvbjogJ0RhdGFiYXNlIGVuY291bnRlcmVkIGFuIHVua25vd24gZXJyb3InXG59KTtcblxuZXhwb3J0cy5CQURfQVJHID0gbmV3IFBvdWNoRXJyb3Ioe1xuICBzdGF0dXM6IDUwMCxcbiAgZXJyb3I6ICdiYWRhcmcnLFxuICByZWFzb246ICdTb21lIHF1ZXJ5IGFyZ3VtZW50IGlzIGludmFsaWQnXG59KTtcblxuZXhwb3J0cy5JTlZBTElEX1JFUVVFU1QgPSBuZXcgUG91Y2hFcnJvcih7XG4gIHN0YXR1czogNDAwLFxuICBlcnJvcjogJ2ludmFsaWRfcmVxdWVzdCcsXG4gIHJlYXNvbjogJ1JlcXVlc3Qgd2FzIGludmFsaWQnXG59KTtcblxuZXhwb3J0cy5RVUVSWV9QQVJTRV9FUlJPUiA9IG5ldyBQb3VjaEVycm9yKHtcbiAgc3RhdHVzOiA0MDAsXG4gIGVycm9yOiAncXVlcnlfcGFyc2VfZXJyb3InLFxuICByZWFzb246ICdTb21lIHF1ZXJ5IHBhcmFtZXRlciBpcyBpbnZhbGlkJ1xufSk7XG5cbmV4cG9ydHMuRE9DX1ZBTElEQVRJT04gPSBuZXcgUG91Y2hFcnJvcih7XG4gIHN0YXR1czogNTAwLFxuICBlcnJvcjogJ2RvY192YWxpZGF0aW9uJyxcbiAgcmVhc29uOiAnQmFkIHNwZWNpYWwgZG9jdW1lbnQgbWVtYmVyJ1xufSk7XG5cbmV4cG9ydHMuQkFEX1JFUVVFU1QgPSBuZXcgUG91Y2hFcnJvcih7XG4gIHN0YXR1czogNDAwLFxuICBlcnJvcjogJ2JhZF9yZXF1ZXN0JyxcbiAgcmVhc29uOiAnU29tZXRoaW5nIHdyb25nIHdpdGggdGhlIHJlcXVlc3QnXG59KTtcblxuZXhwb3J0cy5OT1RfQU5fT0JKRUNUID0gbmV3IFBvdWNoRXJyb3Ioe1xuICBzdGF0dXM6IDQwMCxcbiAgZXJyb3I6ICdiYWRfcmVxdWVzdCcsXG4gIHJlYXNvbjogJ0RvY3VtZW50IG11c3QgYmUgYSBKU09OIG9iamVjdCdcbn0pO1xuXG5leHBvcnRzLkRCX01JU1NJTkcgPSBuZXcgUG91Y2hFcnJvcih7XG4gIHN0YXR1czogNDA0LFxuICBlcnJvcjogJ25vdF9mb3VuZCcsXG4gIHJlYXNvbjogJ0RhdGFiYXNlIG5vdCBmb3VuZCdcbn0pO1xuXG5leHBvcnRzLklEQl9FUlJPUiA9IG5ldyBQb3VjaEVycm9yKHtcbiAgc3RhdHVzOiA1MDAsXG4gIGVycm9yOiAnaW5kZXhlZF9kYl93ZW50X2JhZCcsXG4gIHJlYXNvbjogJ3Vua25vd24nXG59KTtcblxuZXhwb3J0cy5XU1FfRVJST1IgPSBuZXcgUG91Y2hFcnJvcih7XG4gIHN0YXR1czogNTAwLFxuICBlcnJvcjogJ3dlYl9zcWxfd2VudF9iYWQnLFxuICByZWFzb246ICd1bmtub3duJ1xufSk7XG5cbmV4cG9ydHMuTERCX0VSUk9SID0gbmV3IFBvdWNoRXJyb3Ioe1xuICBzdGF0dXM6IDUwMCxcbiAgZXJyb3I6ICdsZXZlbERCX3dlbnRfd2VudF9iYWQnLFxuICByZWFzb246ICd1bmtub3duJ1xufSk7XG5cbmV4cG9ydHMuRk9SQklEREVOID0gbmV3IFBvdWNoRXJyb3Ioe1xuICBzdGF0dXM6IDQwMyxcbiAgZXJyb3I6ICdmb3JiaWRkZW4nLFxuICByZWFzb246ICdGb3JiaWRkZW4gYnkgZGVzaWduIGRvYyB2YWxpZGF0ZV9kb2NfdXBkYXRlIGZ1bmN0aW9uJ1xufSk7XG5cbmV4cG9ydHMuSU5WQUxJRF9SRVYgPSBuZXcgUG91Y2hFcnJvcih7XG4gIHN0YXR1czogNDAwLFxuICBlcnJvcjogJ2JhZF9yZXF1ZXN0JyxcbiAgcmVhc29uOiAnSW52YWxpZCByZXYgZm9ybWF0J1xufSk7XG5cbmV4cG9ydHMuRklMRV9FWElTVFMgPSBuZXcgUG91Y2hFcnJvcih7XG4gIHN0YXR1czogNDEyLFxuICBlcnJvcjogJ2ZpbGVfZXhpc3RzJyxcbiAgcmVhc29uOiAnVGhlIGRhdGFiYXNlIGNvdWxkIG5vdCBiZSBjcmVhdGVkLCB0aGUgZmlsZSBhbHJlYWR5IGV4aXN0cy4nXG59KTtcblxuZXhwb3J0cy5NSVNTSU5HX1NUVUIgPSBuZXcgUG91Y2hFcnJvcih7XG4gIHN0YXR1czogNDEyLFxuICBlcnJvcjogJ21pc3Npbmdfc3R1Yidcbn0pO1xuXG5leHBvcnRzLmVycm9yID0gZnVuY3Rpb24gKGVycm9yLCByZWFzb24sIG5hbWUpIHtcbiAgZnVuY3Rpb24gQ3VzdG9tUG91Y2hFcnJvcihyZWFzb24pIHtcbiAgICAvLyBpbmhlcml0IGVycm9yIHByb3BlcnRpZXMgZnJvbSBvdXIgcGFyZW50IGVycm9yIG1hbnVhbGx5XG4gICAgLy8gc28gYXMgdG8gYWxsb3cgcHJvcGVyIEpTT04gcGFyc2luZy5cbiAgICAvKiBqc2hpbnQgaWdub3JlOnN0YXJ0ICovXG4gICAgZm9yICh2YXIgcCBpbiBlcnJvcikge1xuICAgICAgaWYgKHR5cGVvZiBlcnJvcltwXSAhPT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICB0aGlzW3BdID0gZXJyb3JbcF07XG4gICAgICB9XG4gICAgfVxuICAgIC8qIGpzaGludCBpZ25vcmU6ZW5kICovXG4gICAgaWYgKG5hbWUgIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5uYW1lID0gbmFtZTtcbiAgICB9XG4gICAgaWYgKHJlYXNvbiAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLnJlYXNvbiA9IHJlYXNvbjtcbiAgICB9XG4gIH1cbiAgQ3VzdG9tUG91Y2hFcnJvci5wcm90b3R5cGUgPSBQb3VjaEVycm9yLnByb3RvdHlwZTtcbiAgcmV0dXJuIG5ldyBDdXN0b21Qb3VjaEVycm9yKHJlYXNvbik7XG59O1xuXG4vLyBGaW5kIG9uZSBvZiB0aGUgZXJyb3JzIGRlZmluZWQgYWJvdmUgYmFzZWQgb24gdGhlIHZhbHVlXG4vLyBvZiB0aGUgc3BlY2lmaWVkIHByb3BlcnR5LlxuLy8gSWYgcmVhc29uIGlzIHByb3ZpZGVkIHByZWZlciB0aGUgZXJyb3IgbWF0Y2hpbmcgdGhhdCByZWFzb24uXG4vLyBUaGlzIGlzIGZvciBkaWZmZXJlbnRpYXRpbmcgYmV0d2VlbiBlcnJvcnMgd2l0aCB0aGUgc2FtZSBuYW1lIGFuZCBzdGF0dXMsXG4vLyBlZywgYmFkX3JlcXVlc3QuXG5leHBvcnRzLmdldEVycm9yVHlwZUJ5UHJvcCA9IGZ1bmN0aW9uIChwcm9wLCB2YWx1ZSwgcmVhc29uKSB7XG4gIHZhciBlcnJvcnMgPSBleHBvcnRzO1xuICB2YXIga2V5cyA9IE9iamVjdC5rZXlzKGVycm9ycykuZmlsdGVyKGZ1bmN0aW9uIChrZXkpIHtcbiAgICB2YXIgZXJyb3IgPSBlcnJvcnNba2V5XTtcbiAgICByZXR1cm4gdHlwZW9mIGVycm9yICE9PSAnZnVuY3Rpb24nICYmIGVycm9yW3Byb3BdID09PSB2YWx1ZTtcbiAgfSk7XG4gIHZhciBrZXkgPSByZWFzb24gJiYga2V5cy5maWx0ZXIoZnVuY3Rpb24gKGtleSkge1xuICAgICAgICB2YXIgZXJyb3IgPSBlcnJvcnNba2V5XTtcbiAgICAgICAgcmV0dXJuIGVycm9yLm1lc3NhZ2UgPT09IHJlYXNvbjtcbiAgICAgIH0pWzBdIHx8IGtleXNbMF07XG4gIHJldHVybiAoa2V5KSA/IGVycm9yc1trZXldIDogbnVsbDtcbn07XG5cbmV4cG9ydHMuZ2VuZXJhdGVFcnJvckZyb21SZXNwb25zZSA9IGZ1bmN0aW9uIChyZXMpIHtcbiAgdmFyIGVycm9yLCBlcnJOYW1lLCBlcnJUeXBlLCBlcnJNc2csIGVyclJlYXNvbjtcbiAgdmFyIGVycm9ycyA9IGV4cG9ydHM7XG5cbiAgZXJyTmFtZSA9IChyZXMuZXJyb3IgPT09IHRydWUgJiYgdHlwZW9mIHJlcy5uYW1lID09PSAnc3RyaW5nJykgP1xuICAgICAgICAgICAgICByZXMubmFtZSA6XG4gICAgICAgICAgICAgIHJlcy5lcnJvcjtcbiAgZXJyUmVhc29uID0gcmVzLnJlYXNvbjtcbiAgZXJyVHlwZSA9IGVycm9ycy5nZXRFcnJvclR5cGVCeVByb3AoJ25hbWUnLCBlcnJOYW1lLCBlcnJSZWFzb24pO1xuXG4gIGlmIChyZXMubWlzc2luZyB8fFxuICAgICAgZXJyUmVhc29uID09PSAnbWlzc2luZycgfHxcbiAgICAgIGVyclJlYXNvbiA9PT0gJ2RlbGV0ZWQnIHx8XG4gICAgICBlcnJOYW1lID09PSAnbm90X2ZvdW5kJykge1xuICAgIGVyclR5cGUgPSBlcnJvcnMuTUlTU0lOR19ET0M7XG4gIH0gZWxzZSBpZiAoZXJyTmFtZSA9PT0gJ2RvY192YWxpZGF0aW9uJykge1xuICAgIC8vIGRvYyB2YWxpZGF0aW9uIG5lZWRzIHNwZWNpYWwgdHJlYXRtZW50IHNpbmNlXG4gICAgLy8gcmVzLnJlYXNvbiBkZXBlbmRzIG9uIHRoZSB2YWxpZGF0aW9uIGVycm9yLlxuICAgIC8vIHNlZSB1dGlscy5qc1xuICAgIGVyclR5cGUgPSBlcnJvcnMuRE9DX1ZBTElEQVRJT047XG4gICAgZXJyTXNnID0gZXJyUmVhc29uO1xuICB9IGVsc2UgaWYgKGVyck5hbWUgPT09ICdiYWRfcmVxdWVzdCcgJiYgZXJyVHlwZS5tZXNzYWdlICE9PSBlcnJSZWFzb24pIHtcbiAgICAvLyBpZiBiYWRfcmVxdWVzdCBlcnJvciBhbHJlYWR5IGZvdW5kIGJhc2VkIG9uIHJlYXNvbiBkb24ndCBvdmVycmlkZS5cblxuICAgIC8vIGF0dGFjaG1lbnQgZXJyb3JzLlxuICAgIGlmIChlcnJSZWFzb24uaW5kZXhPZigndW5rbm93biBzdHViIGF0dGFjaG1lbnQnKSA9PT0gMCkge1xuICAgICAgZXJyVHlwZSA9IGVycm9ycy5NSVNTSU5HX1NUVUI7XG4gICAgICBlcnJNc2cgPSBlcnJSZWFzb247XG4gICAgfSBlbHNlIHtcbiAgICAgIGVyclR5cGUgPSBlcnJvcnMuQkFEX1JFUVVFU1Q7XG4gICAgfVxuICB9XG5cbiAgLy8gZmFsbGJhY2sgdG8gZXJyb3IgYnkgc3RhdHlzIG9yIHVua25vd24gZXJyb3IuXG4gIGlmICghZXJyVHlwZSkge1xuICAgIGVyclR5cGUgPSBlcnJvcnMuZ2V0RXJyb3JUeXBlQnlQcm9wKCdzdGF0dXMnLCByZXMuc3RhdHVzLCBlcnJSZWFzb24pIHx8XG4gICAgICAgICAgICAgICAgZXJyb3JzLlVOS05PV05fRVJST1I7XG4gIH1cblxuICBlcnJvciA9IGVycm9ycy5lcnJvcihlcnJUeXBlLCBlcnJSZWFzb24sIGVyck5hbWUpO1xuXG4gIC8vIEtlZXAgY3VzdG9tIG1lc3NhZ2UuXG4gIGlmIChlcnJNc2cpIHtcbiAgICBlcnJvci5tZXNzYWdlID0gZXJyTXNnO1xuICB9XG5cbiAgLy8gS2VlcCBoZWxwZnVsIHJlc3BvbnNlIGRhdGEgaW4gb3VyIGVycm9yIG1lc3NhZ2VzLlxuICBpZiAocmVzLmlkKSB7XG4gICAgZXJyb3IuaWQgPSByZXMuaWQ7XG4gIH1cbiAgaWYgKHJlcy5zdGF0dXMpIHtcbiAgICBlcnJvci5zdGF0dXMgPSByZXMuc3RhdHVzO1xuICB9XG4gIGlmIChyZXMuc3RhdHVzVGV4dCkge1xuICAgIGVycm9yLm5hbWUgPSByZXMuc3RhdHVzVGV4dDtcbiAgfVxuICBpZiAocmVzLm1pc3NpbmcpIHtcbiAgICBlcnJvci5taXNzaW5nID0gcmVzLm1pc3Npbmc7XG4gIH1cblxuICByZXR1cm4gZXJyb3I7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgY3J5cHRvID0gcmVxdWlyZSgnY3J5cHRvJyk7XG52YXIgTWQ1ID0gcmVxdWlyZSgnc3BhcmstbWQ1Jyk7XG52YXIgc2V0SW1tZWRpYXRlU2hpbSA9IGdsb2JhbC5zZXRJbW1lZGlhdGUgfHwgZ2xvYmFsLnNldFRpbWVvdXQ7XG52YXIgTUQ1X0NIVU5LX1NJWkUgPSAzMjc2ODtcblxuLy8gY29udmVydCBhIDY0LWJpdCBpbnQgdG8gYSBiaW5hcnkgc3RyaW5nXG5mdW5jdGlvbiBpbnRUb1N0cmluZyhpbnQpIHtcbiAgdmFyIGJ5dGVzID0gW1xuICAgIChpbnQgJiAweGZmKSxcbiAgICAoKGludCA+Pj4gOCkgJiAweGZmKSxcbiAgICAoKGludCA+Pj4gMTYpICYgMHhmZiksXG4gICAgKChpbnQgPj4+IDI0KSAmIDB4ZmYpXG4gIF07XG4gIHJldHVybiBieXRlcy5tYXAoZnVuY3Rpb24gKGJ5dGUpIHtcbiAgICByZXR1cm4gU3RyaW5nLmZyb21DaGFyQ29kZShieXRlKTtcbiAgfSkuam9pbignJyk7XG59XG5cbi8vIGNvbnZlcnQgYW4gYXJyYXkgb2YgNjQtYml0IGludHMgaW50b1xuLy8gYSBiYXNlNjQtZW5jb2RlZCBzdHJpbmdcbmZ1bmN0aW9uIHJhd1RvQmFzZTY0KHJhdykge1xuICB2YXIgcmVzID0gJyc7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgcmF3Lmxlbmd0aDsgaSsrKSB7XG4gICAgcmVzICs9IGludFRvU3RyaW5nKHJhd1tpXSk7XG4gIH1cbiAgcmV0dXJuIGJ0b2EocmVzKTtcbn1cblxuZnVuY3Rpb24gYXBwZW5kQnVmZmVyKGJ1ZmZlciwgZGF0YSwgc3RhcnQsIGVuZCkge1xuICBpZiAoc3RhcnQgPiAwIHx8IGVuZCA8IGRhdGEuYnl0ZUxlbmd0aCkge1xuICAgIC8vIG9ubHkgY3JlYXRlIGEgc3ViYXJyYXkgaWYgd2UgcmVhbGx5IG5lZWQgdG9cbiAgICBkYXRhID0gbmV3IFVpbnQ4QXJyYXkoZGF0YSwgc3RhcnQsXG4gICAgICBNYXRoLm1pbihlbmQsIGRhdGEuYnl0ZUxlbmd0aCkgLSBzdGFydCk7XG4gIH1cbiAgYnVmZmVyLmFwcGVuZChkYXRhKTtcbn1cblxuZnVuY3Rpb24gYXBwZW5kU3RyaW5nKGJ1ZmZlciwgZGF0YSwgc3RhcnQsIGVuZCkge1xuICBpZiAoc3RhcnQgPiAwIHx8IGVuZCA8IGRhdGEubGVuZ3RoKSB7XG4gICAgLy8gb25seSBjcmVhdGUgYSBzdWJzdHJpbmcgaWYgd2UgcmVhbGx5IG5lZWQgdG9cbiAgICBkYXRhID0gZGF0YS5zdWJzdHJpbmcoc3RhcnQsIGVuZCk7XG4gIH1cbiAgYnVmZmVyLmFwcGVuZEJpbmFyeShkYXRhKTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoZGF0YSwgY2FsbGJhY2spIHtcbiAgaWYgKCFwcm9jZXNzLmJyb3dzZXIpIHtcbiAgICB2YXIgYmFzZTY0ID0gY3J5cHRvLmNyZWF0ZUhhc2goJ21kNScpLnVwZGF0ZShkYXRhKS5kaWdlc3QoJ2Jhc2U2NCcpO1xuICAgIGNhbGxiYWNrKG51bGwsIGJhc2U2NCk7XG4gICAgcmV0dXJuO1xuICB9XG4gIHZhciBpbnB1dElzU3RyaW5nID0gdHlwZW9mIGRhdGEgPT09ICdzdHJpbmcnO1xuICB2YXIgbGVuID0gaW5wdXRJc1N0cmluZyA/IGRhdGEubGVuZ3RoIDogZGF0YS5ieXRlTGVuZ3RoO1xuICB2YXIgY2h1bmtTaXplID0gTWF0aC5taW4oTUQ1X0NIVU5LX1NJWkUsIGxlbik7XG4gIHZhciBjaHVua3MgPSBNYXRoLmNlaWwobGVuIC8gY2h1bmtTaXplKTtcbiAgdmFyIGN1cnJlbnRDaHVuayA9IDA7XG4gIHZhciBidWZmZXIgPSBpbnB1dElzU3RyaW5nID8gbmV3IE1kNSgpIDogbmV3IE1kNS5BcnJheUJ1ZmZlcigpO1xuXG4gIHZhciBhcHBlbmQgPSBpbnB1dElzU3RyaW5nID8gYXBwZW5kU3RyaW5nIDogYXBwZW5kQnVmZmVyO1xuXG4gIGZ1bmN0aW9uIGxvYWROZXh0Q2h1bmsoKSB7XG4gICAgdmFyIHN0YXJ0ID0gY3VycmVudENodW5rICogY2h1bmtTaXplO1xuICAgIHZhciBlbmQgPSBzdGFydCArIGNodW5rU2l6ZTtcbiAgICBjdXJyZW50Q2h1bmsrKztcbiAgICBpZiAoY3VycmVudENodW5rIDwgY2h1bmtzKSB7XG4gICAgICBhcHBlbmQoYnVmZmVyLCBkYXRhLCBzdGFydCwgZW5kKTtcbiAgICAgIHNldEltbWVkaWF0ZVNoaW0obG9hZE5leHRDaHVuayk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGFwcGVuZChidWZmZXIsIGRhdGEsIHN0YXJ0LCBlbmQpO1xuICAgICAgdmFyIHJhdyA9IGJ1ZmZlci5lbmQodHJ1ZSk7XG4gICAgICB2YXIgYmFzZTY0ID0gcmF3VG9CYXNlNjQocmF3KTtcbiAgICAgIGNhbGxiYWNrKG51bGwsIGJhc2U2NCk7XG4gICAgICBidWZmZXIuZGVzdHJveSgpO1xuICAgIH1cbiAgfVxuICBsb2FkTmV4dENodW5rKCk7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZXJyb3JzID0gcmVxdWlyZSgnLi9lcnJvcnMnKTtcbnZhciB1dWlkID0gcmVxdWlyZSgnLi91dWlkJyk7XG5cbmZ1bmN0aW9uIHRvT2JqZWN0KGFycmF5KSB7XG4gIHJldHVybiBhcnJheS5yZWR1Y2UoZnVuY3Rpb24gKG9iaiwgaXRlbSkge1xuICAgIG9ialtpdGVtXSA9IHRydWU7XG4gICAgcmV0dXJuIG9iajtcbiAgfSwge30pO1xufVxuLy8gTGlzdCBvZiB0b3AgbGV2ZWwgcmVzZXJ2ZWQgd29yZHMgZm9yIGRvY1xudmFyIHJlc2VydmVkV29yZHMgPSB0b09iamVjdChbXG4gICdfaWQnLFxuICAnX3JldicsXG4gICdfYXR0YWNobWVudHMnLFxuICAnX2RlbGV0ZWQnLFxuICAnX3JldmlzaW9ucycsXG4gICdfcmV2c19pbmZvJyxcbiAgJ19jb25mbGljdHMnLFxuICAnX2RlbGV0ZWRfY29uZmxpY3RzJyxcbiAgJ19sb2NhbF9zZXEnLFxuICAnX3Jldl90cmVlJyxcbiAgLy9yZXBsaWNhdGlvbiBkb2N1bWVudHNcbiAgJ19yZXBsaWNhdGlvbl9pZCcsXG4gICdfcmVwbGljYXRpb25fc3RhdGUnLFxuICAnX3JlcGxpY2F0aW9uX3N0YXRlX3RpbWUnLFxuICAnX3JlcGxpY2F0aW9uX3N0YXRlX3JlYXNvbicsXG4gICdfcmVwbGljYXRpb25fc3RhdHMnLFxuICAvLyBTcGVjaWZpYyB0byBDb3VjaGJhc2UgU3luYyBHYXRld2F5XG4gICdfcmVtb3ZlZCdcbl0pO1xuXG4vLyBMaXN0IG9mIHJlc2VydmVkIHdvcmRzIHRoYXQgc2hvdWxkIGVuZCB1cCB0aGUgZG9jdW1lbnRcbnZhciBkYXRhV29yZHMgPSB0b09iamVjdChbXG4gICdfYXR0YWNobWVudHMnLFxuICAvL3JlcGxpY2F0aW9uIGRvY3VtZW50c1xuICAnX3JlcGxpY2F0aW9uX2lkJyxcbiAgJ19yZXBsaWNhdGlvbl9zdGF0ZScsXG4gICdfcmVwbGljYXRpb25fc3RhdGVfdGltZScsXG4gICdfcmVwbGljYXRpb25fc3RhdGVfcmVhc29uJyxcbiAgJ19yZXBsaWNhdGlvbl9zdGF0cydcbl0pO1xuXG4vLyBEZXRlcm1pbmUgaWQgYW4gSUQgaXMgdmFsaWRcbi8vICAgLSBpbnZhbGlkIElEcyBiZWdpbiB3aXRoIGFuIHVuZGVyZXNjb3JlIHRoYXQgZG9lcyBub3QgYmVnaW4gJ19kZXNpZ24nIG9yXG4vLyAgICAgJ19sb2NhbCdcbi8vICAgLSBhbnkgb3RoZXIgc3RyaW5nIHZhbHVlIGlzIGEgdmFsaWQgaWRcbi8vIFJldHVybnMgdGhlIHNwZWNpZmljIGVycm9yIG9iamVjdCBmb3IgZWFjaCBjYXNlXG5leHBvcnRzLmludmFsaWRJZEVycm9yID0gZnVuY3Rpb24gKGlkKSB7XG4gIHZhciBlcnI7XG4gIGlmICghaWQpIHtcbiAgICBlcnIgPSBlcnJvcnMuZXJyb3IoZXJyb3JzLk1JU1NJTkdfSUQpO1xuICB9IGVsc2UgaWYgKHR5cGVvZiBpZCAhPT0gJ3N0cmluZycpIHtcbiAgICBlcnIgPSBlcnJvcnMuZXJyb3IoZXJyb3JzLklOVkFMSURfSUQpO1xuICB9IGVsc2UgaWYgKC9eXy8udGVzdChpZCkgJiYgISgvXl8oZGVzaWdufGxvY2FsKS8pLnRlc3QoaWQpKSB7XG4gICAgZXJyID0gZXJyb3JzLmVycm9yKGVycm9ycy5SRVNFUlZFRF9JRCk7XG4gIH1cbiAgaWYgKGVycikge1xuICAgIHRocm93IGVycjtcbiAgfVxufTtcblxuZnVuY3Rpb24gcGFyc2VSZXZpc2lvbkluZm8ocmV2KSB7XG4gIGlmICghL15cXGQrXFwtLi8udGVzdChyZXYpKSB7XG4gICAgcmV0dXJuIGVycm9ycy5lcnJvcihlcnJvcnMuSU5WQUxJRF9SRVYpO1xuICB9XG4gIHZhciBpZHggPSByZXYuaW5kZXhPZignLScpO1xuICB2YXIgbGVmdCA9IHJldi5zdWJzdHJpbmcoMCwgaWR4KTtcbiAgdmFyIHJpZ2h0ID0gcmV2LnN1YnN0cmluZyhpZHggKyAxKTtcbiAgcmV0dXJuIHtcbiAgICBwcmVmaXg6IHBhcnNlSW50KGxlZnQsIDEwKSxcbiAgICBpZDogcmlnaHRcbiAgfTtcbn1cblxuZnVuY3Rpb24gbWFrZVJldlRyZWVGcm9tUmV2aXNpb25zKHJldmlzaW9ucywgb3B0cykge1xuICB2YXIgcG9zID0gcmV2aXNpb25zLnN0YXJ0IC0gcmV2aXNpb25zLmlkcy5sZW5ndGggKyAxO1xuXG4gIHZhciByZXZpc2lvbklkcyA9IHJldmlzaW9ucy5pZHM7XG4gIHZhciBpZHMgPSBbcmV2aXNpb25JZHNbMF0sIG9wdHMsIFtdXTtcblxuICBmb3IgKHZhciBpID0gMSwgbGVuID0gcmV2aXNpb25JZHMubGVuZ3RoOyBpIDwgbGVuOyBpKyspIHtcbiAgICBpZHMgPSBbcmV2aXNpb25JZHNbaV0sIHtzdGF0dXM6ICdtaXNzaW5nJ30sIFtpZHNdXTtcbiAgfVxuXG4gIHJldHVybiBbe1xuICAgIHBvczogcG9zLFxuICAgIGlkczogaWRzXG4gIH1dO1xufVxuXG4vLyBQcmVwcm9jZXNzIGRvY3VtZW50cywgcGFyc2UgdGhlaXIgcmV2aXNpb25zLCBhc3NpZ24gYW4gaWQgYW5kIGFcbi8vIHJldmlzaW9uIGZvciBuZXcgd3JpdGVzIHRoYXQgYXJlIG1pc3NpbmcgdGhlbSwgZXRjXG5leHBvcnRzLnBhcnNlRG9jID0gZnVuY3Rpb24gKGRvYywgbmV3RWRpdHMpIHtcblxuICB2YXIgblJldk51bTtcbiAgdmFyIG5ld1JldklkO1xuICB2YXIgcmV2SW5mbztcbiAgdmFyIG9wdHMgPSB7c3RhdHVzOiAnYXZhaWxhYmxlJ307XG4gIGlmIChkb2MuX2RlbGV0ZWQpIHtcbiAgICBvcHRzLmRlbGV0ZWQgPSB0cnVlO1xuICB9XG5cbiAgaWYgKG5ld0VkaXRzKSB7XG4gICAgaWYgKCFkb2MuX2lkKSB7XG4gICAgICBkb2MuX2lkID0gdXVpZCgpO1xuICAgIH1cbiAgICBuZXdSZXZJZCA9IHV1aWQoMzIsIDE2KS50b0xvd2VyQ2FzZSgpO1xuICAgIGlmIChkb2MuX3Jldikge1xuICAgICAgcmV2SW5mbyA9IHBhcnNlUmV2aXNpb25JbmZvKGRvYy5fcmV2KTtcbiAgICAgIGlmIChyZXZJbmZvLmVycm9yKSB7XG4gICAgICAgIHJldHVybiByZXZJbmZvO1xuICAgICAgfVxuICAgICAgZG9jLl9yZXZfdHJlZSA9IFt7XG4gICAgICAgIHBvczogcmV2SW5mby5wcmVmaXgsXG4gICAgICAgIGlkczogW3JldkluZm8uaWQsIHtzdGF0dXM6ICdtaXNzaW5nJ30sIFtbbmV3UmV2SWQsIG9wdHMsIFtdXV1dXG4gICAgICB9XTtcbiAgICAgIG5SZXZOdW0gPSByZXZJbmZvLnByZWZpeCArIDE7XG4gICAgfSBlbHNlIHtcbiAgICAgIGRvYy5fcmV2X3RyZWUgPSBbe1xuICAgICAgICBwb3M6IDEsXG4gICAgICAgIGlkcyA6IFtuZXdSZXZJZCwgb3B0cywgW11dXG4gICAgICB9XTtcbiAgICAgIG5SZXZOdW0gPSAxO1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICBpZiAoZG9jLl9yZXZpc2lvbnMpIHtcbiAgICAgIGRvYy5fcmV2X3RyZWUgPSBtYWtlUmV2VHJlZUZyb21SZXZpc2lvbnMoZG9jLl9yZXZpc2lvbnMsIG9wdHMpO1xuICAgICAgblJldk51bSA9IGRvYy5fcmV2aXNpb25zLnN0YXJ0O1xuICAgICAgbmV3UmV2SWQgPSBkb2MuX3JldmlzaW9ucy5pZHNbMF07XG4gICAgfVxuICAgIGlmICghZG9jLl9yZXZfdHJlZSkge1xuICAgICAgcmV2SW5mbyA9IHBhcnNlUmV2aXNpb25JbmZvKGRvYy5fcmV2KTtcbiAgICAgIGlmIChyZXZJbmZvLmVycm9yKSB7XG4gICAgICAgIHJldHVybiByZXZJbmZvO1xuICAgICAgfVxuICAgICAgblJldk51bSA9IHJldkluZm8ucHJlZml4O1xuICAgICAgbmV3UmV2SWQgPSByZXZJbmZvLmlkO1xuICAgICAgZG9jLl9yZXZfdHJlZSA9IFt7XG4gICAgICAgIHBvczogblJldk51bSxcbiAgICAgICAgaWRzOiBbbmV3UmV2SWQsIG9wdHMsIFtdXVxuICAgICAgfV07XG4gICAgfVxuICB9XG5cbiAgZXhwb3J0cy5pbnZhbGlkSWRFcnJvcihkb2MuX2lkKTtcblxuICBkb2MuX3JldiA9IG5SZXZOdW0gKyAnLScgKyBuZXdSZXZJZDtcblxuICB2YXIgcmVzdWx0ID0ge21ldGFkYXRhIDoge30sIGRhdGEgOiB7fX07XG4gIGZvciAodmFyIGtleSBpbiBkb2MpIHtcbiAgICBpZiAoZG9jLmhhc093blByb3BlcnR5KGtleSkpIHtcbiAgICAgIHZhciBzcGVjaWFsS2V5ID0ga2V5WzBdID09PSAnXyc7XG4gICAgICBpZiAoc3BlY2lhbEtleSAmJiAhcmVzZXJ2ZWRXb3Jkc1trZXldKSB7XG4gICAgICAgIHZhciBlcnJvciA9IGVycm9ycy5lcnJvcihlcnJvcnMuRE9DX1ZBTElEQVRJT04sIGtleSk7XG4gICAgICAgIGVycm9yLm1lc3NhZ2UgPSBlcnJvcnMuRE9DX1ZBTElEQVRJT04ubWVzc2FnZSArICc6ICcgKyBrZXk7XG4gICAgICAgIHRocm93IGVycm9yO1xuICAgICAgfSBlbHNlIGlmIChzcGVjaWFsS2V5ICYmICFkYXRhV29yZHNba2V5XSkge1xuICAgICAgICByZXN1bHQubWV0YWRhdGFba2V5LnNsaWNlKDEpXSA9IGRvY1trZXldO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmVzdWx0LmRhdGFba2V5XSA9IGRvY1trZXldO1xuICAgICAgfVxuICAgIH1cbiAgfVxuICByZXR1cm4gcmVzdWx0O1xufTsiLCIndXNlIHN0cmljdCc7XG5cbi8vXG4vLyBQYXJzaW5nIGhleCBzdHJpbmdzLiBZZWFoLlxuLy9cbi8vIFNvIGJhc2ljYWxseSB3ZSBuZWVkIHRoaXMgYmVjYXVzZSBvZiBhIGJ1ZyBpbiBXZWJTUUw6XG4vLyBodHRwczovL2NvZGUuZ29vZ2xlLmNvbS9wL2Nocm9taXVtL2lzc3Vlcy9kZXRhaWw/aWQ9NDIyNjkwXG4vLyBodHRwczovL2J1Z3Mud2Via2l0Lm9yZy9zaG93X2J1Zy5jZ2k/aWQ9MTM3NjM3XG4vL1xuLy8gVVRGLTggYW5kIFVURi0xNiBhcmUgcHJvdmlkZWQgYXMgc2VwYXJhdGUgZnVuY3Rpb25zXG4vLyBmb3IgbWVhZ2VyIHBlcmZvcm1hbmNlIGltcHJvdmVtZW50c1xuLy9cblxuZnVuY3Rpb24gZGVjb2RlVXRmOChzdHIpIHtcbiAgcmV0dXJuIGRlY29kZVVSSUNvbXBvbmVudCh3aW5kb3cuZXNjYXBlKHN0cikpO1xufVxuXG5mdW5jdGlvbiBoZXhUb0ludChjaGFyQ29kZSkge1xuICAvLyAnMCctJzknIGlzIDQ4LTU3XG4gIC8vICdBJy0nRicgaXMgNjUtNzBcbiAgLy8gU1FMaXRlIHdpbGwgb25seSBnaXZlIHVzIHVwcGVyY2FzZSBoZXhcbiAgcmV0dXJuIGNoYXJDb2RlIDwgNjUgPyAoY2hhckNvZGUgLSA0OCkgOiAoY2hhckNvZGUgLSA1NSk7XG59XG5cblxuLy8gRXhhbXBsZTpcbi8vIHByYWdtYSBlbmNvZGluZz11dGY4O1xuLy8gc2VsZWN0IGhleCgnQScpO1xuLy8gcmV0dXJucyAnNDEnXG5mdW5jdGlvbiBwYXJzZUhleFV0Zjgoc3RyLCBzdGFydCwgZW5kKSB7XG4gIHZhciByZXN1bHQgPSAnJztcbiAgd2hpbGUgKHN0YXJ0IDwgZW5kKSB7XG4gICAgcmVzdWx0ICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoXG4gICAgICAoaGV4VG9JbnQoc3RyLmNoYXJDb2RlQXQoc3RhcnQrKykpIDw8IDQpIHxcbiAgICAgICAgaGV4VG9JbnQoc3RyLmNoYXJDb2RlQXQoc3RhcnQrKykpKTtcbiAgfVxuICByZXR1cm4gcmVzdWx0O1xufVxuXG4vLyBFeGFtcGxlOlxuLy8gcHJhZ21hIGVuY29kaW5nPXV0ZjE2O1xuLy8gc2VsZWN0IGhleCgnQScpO1xuLy8gcmV0dXJucyAnNDEwMCdcbi8vIG5vdGljZSB0aGF0IHRoZSAwMCBjb21lcyBhZnRlciB0aGUgNDEgKGkuZS4gaXQncyBzd2l6emxlZClcbmZ1bmN0aW9uIHBhcnNlSGV4VXRmMTYoc3RyLCBzdGFydCwgZW5kKSB7XG4gIHZhciByZXN1bHQgPSAnJztcbiAgd2hpbGUgKHN0YXJ0IDwgZW5kKSB7XG4gICAgLy8gVVRGLTE2LCBzbyBzd2l6emxlIHRoZSBieXRlc1xuICAgIHJlc3VsdCArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKFxuICAgICAgKGhleFRvSW50KHN0ci5jaGFyQ29kZUF0KHN0YXJ0ICsgMikpIDw8IDEyKSB8XG4gICAgICAgIChoZXhUb0ludChzdHIuY2hhckNvZGVBdChzdGFydCArIDMpKSA8PCA4KSB8XG4gICAgICAgIChoZXhUb0ludChzdHIuY2hhckNvZGVBdChzdGFydCkpIDw8IDQpIHxcbiAgICAgICAgaGV4VG9JbnQoc3RyLmNoYXJDb2RlQXQoc3RhcnQgKyAxKSkpO1xuICAgIHN0YXJ0ICs9IDQ7XG4gIH1cbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuZnVuY3Rpb24gcGFyc2VIZXhTdHJpbmcoc3RyLCBlbmNvZGluZykge1xuICBpZiAoZW5jb2RpbmcgPT09ICdVVEYtOCcpIHtcbiAgICByZXR1cm4gZGVjb2RlVXRmOChwYXJzZUhleFV0Zjgoc3RyLCAwLCBzdHIubGVuZ3RoKSk7XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIHBhcnNlSGV4VXRmMTYoc3RyLCAwLCBzdHIubGVuZ3RoKTtcbiAgfVxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHBhcnNlSGV4U3RyaW5nOyIsIid1c2Ugc3RyaWN0JztcblxuLy8gb3JpZ2luYWxseSBwYXJzZVVyaSAxLjIuMiwgbm93IHBhdGNoZWQgYnkgdXNcbi8vIChjKSBTdGV2ZW4gTGV2aXRoYW4gPHN0ZXZlbmxldml0aGFuLmNvbT5cbi8vIE1JVCBMaWNlbnNlXG52YXIgb3B0aW9ucyA9IHtcbiAgc3RyaWN0TW9kZTogZmFsc2UsXG4gIGtleTogW1wic291cmNlXCIsIFwicHJvdG9jb2xcIiwgXCJhdXRob3JpdHlcIiwgXCJ1c2VySW5mb1wiLCBcInVzZXJcIiwgXCJwYXNzd29yZFwiLFxuICAgIFwiaG9zdFwiLCBcInBvcnRcIiwgXCJyZWxhdGl2ZVwiLCBcInBhdGhcIiwgXCJkaXJlY3RvcnlcIiwgXCJmaWxlXCIsIFwicXVlcnlcIixcbiAgICBcImFuY2hvclwiXSxcbiAgcTogICB7XG4gICAgbmFtZTogICBcInF1ZXJ5S2V5XCIsXG4gICAgcGFyc2VyOiAvKD86XnwmKShbXiY9XSopPT8oW14mXSopL2dcbiAgfSxcbiAgcGFyc2VyOiB7XG4gICAgLyoganNoaW50IG1heGxlbjogZmFsc2UgKi9cbiAgICBzdHJpY3Q6IC9eKD86KFteOlxcLz8jXSspOik/KD86XFwvXFwvKCg/OigoW146QF0qKSg/OjooW146QF0qKSk/KT9AKT8oW146XFwvPyNdKikoPzo6KFxcZCopKT8pKT8oKCgoPzpbXj8jXFwvXSpcXC8pKikoW14/I10qKSkoPzpcXD8oW14jXSopKT8oPzojKC4qKSk/KS8sXG4gICAgbG9vc2U6ICAvXig/Oig/IVteOkBdKzpbXjpAXFwvXSpAKShbXjpcXC8/Iy5dKyk6KT8oPzpcXC9cXC8pPygoPzooKFteOkBdKikoPzo6KFteOkBdKikpPyk/QCk/KFteOlxcLz8jXSopKD86OihcXGQqKSk/KSgoKFxcLyg/OltePyNdKD8hW14/I1xcL10qXFwuW14/I1xcLy5dKyg/Ols/I118JCkpKSpcXC8/KT8oW14/I1xcL10qKSkoPzpcXD8oW14jXSopKT8oPzojKC4qKSk/KS9cbiAgfVxufTtcbmZ1bmN0aW9uIHBhcnNlVXJpKHN0cikge1xuICB2YXIgbyA9IG9wdGlvbnM7XG4gIHZhciBtID0gby5wYXJzZXJbby5zdHJpY3RNb2RlID8gXCJzdHJpY3RcIiA6IFwibG9vc2VcIl0uZXhlYyhzdHIpO1xuICB2YXIgdXJpID0ge307XG4gIHZhciBpID0gMTQ7XG5cbiAgd2hpbGUgKGktLSkge1xuICAgIHZhciBrZXkgPSBvLmtleVtpXTtcbiAgICB2YXIgdmFsdWUgPSBtW2ldIHx8IFwiXCI7XG4gICAgdmFyIGVuY29kZWQgPSBbJ3VzZXInLCAncGFzc3dvcmQnXS5pbmRleE9mKGtleSkgIT09IC0xO1xuICAgIHVyaVtrZXldID0gZW5jb2RlZCA/IGRlY29kZVVSSUNvbXBvbmVudCh2YWx1ZSkgOiB2YWx1ZTtcbiAgfVxuXG4gIHVyaVtvLnEubmFtZV0gPSB7fTtcbiAgdXJpW28ua2V5WzEyXV0ucmVwbGFjZShvLnEucGFyc2VyLCBmdW5jdGlvbiAoJDAsICQxLCAkMikge1xuICAgIGlmICgkMSkge1xuICAgICAgdXJpW28ucS5uYW1lXVskMV0gPSAkMjtcbiAgICB9XG4gIH0pO1xuXG4gIHJldHVybiB1cmk7XG59XG5cblxubW9kdWxlLmV4cG9ydHMgPSBwYXJzZVVyaTsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBjcmVhdGVCbG9iID0gcmVxdWlyZSgnLi9ibG9iLmpzJyk7XG52YXIgdXRpbHMgPSByZXF1aXJlKCcuLi91dGlscycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKG9wdGlvbnMsIGNhbGxiYWNrKSB7XG5cbiAgdmFyIHhociwgdGltZXIsIGhhc1VwbG9hZDtcblxuICB2YXIgYWJvcnRSZXEgPSBmdW5jdGlvbiAoKSB7XG4gICAgeGhyLmFib3J0KCk7XG4gIH07XG5cbiAgaWYgKG9wdGlvbnMueGhyKSB7XG4gICAgeGhyID0gbmV3IG9wdGlvbnMueGhyKCk7XG4gIH0gZWxzZSB7XG4gICAgeGhyID0gbmV3IFhNTEh0dHBSZXF1ZXN0KCk7XG4gIH1cblxuICAvLyBjYWNoZS1idXN0ZXIsIHNwZWNpZmljYWxseSBkZXNpZ25lZCB0byB3b3JrIGFyb3VuZCBJRSdzIGFnZ3Jlc3NpdmUgY2FjaGluZ1xuICAvLyBzZWUgaHR0cDovL3d3dy5kYXNoYmF5LmNvbS8yMDExLzA1L2ludGVybmV0LWV4cGxvcmVyLWNhY2hlcy1hamF4L1xuICBpZiAob3B0aW9ucy5tZXRob2QgPT09ICdHRVQnICYmICFvcHRpb25zLmNhY2hlKSB7XG4gICAgdmFyIGhhc0FyZ3MgPSBvcHRpb25zLnVybC5pbmRleE9mKCc/JykgIT09IC0xO1xuICAgIG9wdGlvbnMudXJsICs9IChoYXNBcmdzID8gJyYnIDogJz8nKSArICdfbm9uY2U9JyArIERhdGUubm93KCk7XG4gIH1cblxuICB4aHIub3BlbihvcHRpb25zLm1ldGhvZCwgb3B0aW9ucy51cmwpO1xuICB4aHIud2l0aENyZWRlbnRpYWxzID0gdHJ1ZTtcblxuICBpZiAob3B0aW9ucy5qc29uKSB7XG4gICAgb3B0aW9ucy5oZWFkZXJzLkFjY2VwdCA9ICdhcHBsaWNhdGlvbi9qc29uJztcbiAgICBvcHRpb25zLmhlYWRlcnNbJ0NvbnRlbnQtVHlwZSddID0gb3B0aW9ucy5oZWFkZXJzWydDb250ZW50LVR5cGUnXSB8fFxuICAgICAgJ2FwcGxpY2F0aW9uL2pzb24nO1xuICAgIGlmIChvcHRpb25zLmJvZHkgJiZcbiAgICAgICAgb3B0aW9ucy5wcm9jZXNzRGF0YSAmJlxuICAgICAgICB0eXBlb2Ygb3B0aW9ucy5ib2R5ICE9PSBcInN0cmluZ1wiKSB7XG4gICAgICBvcHRpb25zLmJvZHkgPSBKU09OLnN0cmluZ2lmeShvcHRpb25zLmJvZHkpO1xuICAgIH1cbiAgfVxuXG4gIGlmIChvcHRpb25zLmJpbmFyeSkge1xuICAgIHhoci5yZXNwb25zZVR5cGUgPSAnYXJyYXlidWZmZXInO1xuICB9XG5cbiAgaWYgKCEoJ2JvZHknIGluIG9wdGlvbnMpKSB7XG4gICAgb3B0aW9ucy5ib2R5ID0gbnVsbDtcbiAgfVxuXG4gIGZvciAodmFyIGtleSBpbiBvcHRpb25zLmhlYWRlcnMpIHtcbiAgICBpZiAob3B0aW9ucy5oZWFkZXJzLmhhc093blByb3BlcnR5KGtleSkpIHtcbiAgICAgIHhoci5zZXRSZXF1ZXN0SGVhZGVyKGtleSwgb3B0aW9ucy5oZWFkZXJzW2tleV0pO1xuICAgIH1cbiAgfVxuXG4gIGlmIChvcHRpb25zLnRpbWVvdXQgPiAwKSB7XG4gICAgdGltZXIgPSBzZXRUaW1lb3V0KGFib3J0UmVxLCBvcHRpb25zLnRpbWVvdXQpO1xuICAgIHhoci5vbnByb2dyZXNzID0gZnVuY3Rpb24gKCkge1xuICAgICAgY2xlYXJUaW1lb3V0KHRpbWVyKTtcbiAgICAgIHRpbWVyID0gc2V0VGltZW91dChhYm9ydFJlcSwgb3B0aW9ucy50aW1lb3V0KTtcbiAgICB9O1xuICAgIGlmICh0eXBlb2YgaGFzVXBsb2FkID09PSAndW5kZWZpbmVkJykge1xuICAgICAgLy8gSUUgdGhyb3dzIGFuIGVycm9yIGlmIHlvdSB0cnkgdG8gYWNjZXNzIGl0IGRpcmVjdGx5XG4gICAgICBoYXNVcGxvYWQgPSBPYmplY3Qua2V5cyh4aHIpLmluZGV4T2YoJ3VwbG9hZCcpICE9PSAtMTtcbiAgICB9XG4gICAgaWYgKGhhc1VwbG9hZCkgeyAvLyBkb2VzIG5vdCBleGlzdCBpbiBpZTlcbiAgICAgIHhoci51cGxvYWQub25wcm9ncmVzcyA9IHhoci5vbnByb2dyZXNzO1xuICAgIH1cbiAgfVxuXG4gIHhoci5vbnJlYWR5c3RhdGVjaGFuZ2UgPSBmdW5jdGlvbiAoKSB7XG4gICAgaWYgKHhoci5yZWFkeVN0YXRlICE9PSA0KSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdmFyIHJlc3BvbnNlID0ge1xuICAgICAgc3RhdHVzQ29kZTogeGhyLnN0YXR1c1xuICAgIH07XG5cbiAgICBpZiAoeGhyLnN0YXR1cyA+PSAyMDAgJiYgeGhyLnN0YXR1cyA8IDMwMCkge1xuICAgICAgdmFyIGRhdGE7XG4gICAgICBpZiAob3B0aW9ucy5iaW5hcnkpIHtcbiAgICAgICAgZGF0YSA9IGNyZWF0ZUJsb2IoW3hoci5yZXNwb25zZSB8fCAnJ10sIHtcbiAgICAgICAgICB0eXBlOiB4aHIuZ2V0UmVzcG9uc2VIZWFkZXIoJ0NvbnRlbnQtVHlwZScpXG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZGF0YSA9IHhoci5yZXNwb25zZVRleHQ7XG4gICAgICB9XG4gICAgICBjYWxsYmFjayhudWxsLCByZXNwb25zZSwgZGF0YSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHZhciBlcnIgPSB7fTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGVyciA9IEpTT04ucGFyc2UoeGhyLnJlc3BvbnNlKTtcbiAgICAgIH0gY2F0Y2goZSkge31cbiAgICAgIGNhbGxiYWNrKGVyciwgcmVzcG9uc2UpO1xuICAgIH1cbiAgfTtcblxuICBpZiAob3B0aW9ucy5ib2R5ICYmIChvcHRpb25zLmJvZHkgaW5zdGFuY2VvZiBCbG9iKSkge1xuICAgIHV0aWxzLnJlYWRBc0JpbmFyeVN0cmluZyhvcHRpb25zLmJvZHksIGZ1bmN0aW9uIChiaW5hcnkpIHtcbiAgICAgIHhoci5zZW5kKHV0aWxzLmZpeEJpbmFyeShiaW5hcnkpKTtcbiAgICB9KTtcbiAgfSBlbHNlIHtcbiAgICB4aHIuc2VuZChvcHRpb25zLmJvZHkpO1xuICB9XG5cbiAgcmV0dXJuIHthYm9ydDogYWJvcnRSZXF9O1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIHVwc2VydCA9IHJlcXVpcmUoJ3BvdWNoZGItdXBzZXJ0JykudXBzZXJ0O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChkYiwgZG9jLCBkaWZmRnVuLCBjYikge1xuICByZXR1cm4gdXBzZXJ0LmNhbGwoZGIsIGRvYywgZGlmZkZ1biwgY2IpO1xufTtcbiIsIlwidXNlIHN0cmljdFwiO1xuXG4vLyBCRUdJTiBNYXRoLnV1aWQuanNcblxuLyohXG5NYXRoLnV1aWQuanMgKHYxLjQpXG5odHRwOi8vd3d3LmJyb29mYS5jb21cbm1haWx0bzpyb2JlcnRAYnJvb2ZhLmNvbVxuXG5Db3B5cmlnaHQgKGMpIDIwMTAgUm9iZXJ0IEtpZWZmZXJcbkR1YWwgbGljZW5zZWQgdW5kZXIgdGhlIE1JVCBhbmQgR1BMIGxpY2Vuc2VzLlxuKi9cblxuLypcbiAqIEdlbmVyYXRlIGEgcmFuZG9tIHV1aWQuXG4gKlxuICogVVNBR0U6IE1hdGgudXVpZChsZW5ndGgsIHJhZGl4KVxuICogICBsZW5ndGggLSB0aGUgZGVzaXJlZCBudW1iZXIgb2YgY2hhcmFjdGVyc1xuICogICByYWRpeCAgLSB0aGUgbnVtYmVyIG9mIGFsbG93YWJsZSB2YWx1ZXMgZm9yIGVhY2ggY2hhcmFjdGVyLlxuICpcbiAqIEVYQU1QTEVTOlxuICogICAvLyBObyBhcmd1bWVudHMgIC0gcmV0dXJucyBSRkM0MTIyLCB2ZXJzaW9uIDQgSURcbiAqICAgPj4+IE1hdGgudXVpZCgpXG4gKiAgIFwiOTIzMjlEMzktNkY1Qy00NTIwLUFCRkMtQUFCNjQ1NDRFMTcyXCJcbiAqXG4gKiAgIC8vIE9uZSBhcmd1bWVudCAtIHJldHVybnMgSUQgb2YgdGhlIHNwZWNpZmllZCBsZW5ndGhcbiAqICAgPj4+IE1hdGgudXVpZCgxNSkgICAgIC8vIDE1IGNoYXJhY3RlciBJRCAoZGVmYXVsdCBiYXNlPTYyKVxuICogICBcIlZjeWR4Z2x0eHJWWlNUVlwiXG4gKlxuICogICAvLyBUd28gYXJndW1lbnRzIC0gcmV0dXJucyBJRCBvZiB0aGUgc3BlY2lmaWVkIGxlbmd0aCwgYW5kIHJhZGl4LiBcbiAqICAgLy8gKFJhZGl4IG11c3QgYmUgPD0gNjIpXG4gKiAgID4+PiBNYXRoLnV1aWQoOCwgMikgIC8vIDggY2hhcmFjdGVyIElEIChiYXNlPTIpXG4gKiAgIFwiMDEwMDEwMTBcIlxuICogICA+Pj4gTWF0aC51dWlkKDgsIDEwKSAvLyA4IGNoYXJhY3RlciBJRCAoYmFzZT0xMClcbiAqICAgXCI0NzQ3MzA0NlwiXG4gKiAgID4+PiBNYXRoLnV1aWQoOCwgMTYpIC8vIDggY2hhcmFjdGVyIElEIChiYXNlPTE2KVxuICogICBcIjA5OEY0RDM1XCJcbiAqL1xudmFyIGNoYXJzID0gKFxuICAnMDEyMzQ1Njc4OUFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaJyArXG4gICdhYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5eidcbikuc3BsaXQoJycpO1xuZnVuY3Rpb24gZ2V0VmFsdWUocmFkaXgpIHtcbiAgcmV0dXJuIDAgfCBNYXRoLnJhbmRvbSgpICogcmFkaXg7XG59XG5mdW5jdGlvbiB1dWlkKGxlbiwgcmFkaXgpIHtcbiAgcmFkaXggPSByYWRpeCB8fCBjaGFycy5sZW5ndGg7XG4gIHZhciBvdXQgPSAnJztcbiAgdmFyIGkgPSAtMTtcblxuICBpZiAobGVuKSB7XG4gICAgLy8gQ29tcGFjdCBmb3JtXG4gICAgd2hpbGUgKCsraSA8IGxlbikge1xuICAgICAgb3V0ICs9IGNoYXJzW2dldFZhbHVlKHJhZGl4KV07XG4gICAgfVxuICAgIHJldHVybiBvdXQ7XG4gIH1cbiAgICAvLyByZmM0MTIyLCB2ZXJzaW9uIDQgZm9ybVxuICAgIC8vIEZpbGwgaW4gcmFuZG9tIGRhdGEuICBBdCBpPT0xOSBzZXQgdGhlIGhpZ2ggYml0cyBvZiBjbG9jayBzZXF1ZW5jZSBhc1xuICAgIC8vIHBlciByZmM0MTIyLCBzZWMuIDQuMS41XG4gIHdoaWxlICgrK2kgPCAzNikge1xuICAgIHN3aXRjaCAoaSkge1xuICAgICAgY2FzZSA4OlxuICAgICAgY2FzZSAxMzpcbiAgICAgIGNhc2UgMTg6XG4gICAgICBjYXNlIDIzOlxuICAgICAgICBvdXQgKz0gJy0nO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgMTk6XG4gICAgICAgIG91dCArPSBjaGFyc1soZ2V0VmFsdWUoMTYpICYgMHgzKSB8IDB4OF07XG4gICAgICAgIGJyZWFrO1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgb3V0ICs9IGNoYXJzW2dldFZhbHVlKDE2KV07XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG91dDtcbn1cblxuXG5cbm1vZHVsZS5leHBvcnRzID0gdXVpZDtcblxuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGV2YWxGaWx0ZXI7XG5mdW5jdGlvbiBldmFsRmlsdGVyKGlucHV0KSB7XG4gIC8qanNoaW50IGV2aWw6IHRydWUgKi9cbiAgcmV0dXJuIGV2YWwoW1xuICAgICcoZnVuY3Rpb24gKCkgeyByZXR1cm4gJyxcbiAgICBpbnB1dCxcbiAgICAnIH0pKCknXG4gIF0uam9pbignJykpO1xufSIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSBldmFsVmlldztcbmZ1bmN0aW9uIGV2YWxWaWV3KGlucHV0KSB7XG4gIC8qanNoaW50IGV2aWw6IHRydWUgKi9cbiAgcmV0dXJuIGV2YWwoW1xuICAgICcoZnVuY3Rpb24gKCkgeycsXG4gICAgJyAgcmV0dXJuIGZ1bmN0aW9uIChkb2MpIHsnLFxuICAgICcgICAgdmFyIGVtaXR0ZWQgPSBmYWxzZTsnLFxuICAgICcgICAgdmFyIGVtaXQgPSBmdW5jdGlvbiAoYSwgYikgeycsXG4gICAgJyAgICAgIGVtaXR0ZWQgPSB0cnVlOycsXG4gICAgJyAgICB9OycsXG4gICAgJyAgICB2YXIgdmlldyA9ICcgKyBpbnB1dCArICc7JyxcbiAgICAnICAgIHZpZXcoZG9jKTsnLFxuICAgICcgICAgaWYgKGVtaXR0ZWQpIHsnLFxuICAgICcgICAgICByZXR1cm4gdHJ1ZTsnLFxuICAgICcgICAgfScsXG4gICAgJyAgfScsXG4gICAgJ30pKCknXG4gIF0uam9pbignXFxuJykpO1xufSIsIlwidXNlIHN0cmljdFwiO1xuXG52YXIgUG91Y2hEQiA9IHJlcXVpcmUoJy4vc2V0dXAnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBQb3VjaERCO1xuXG5Qb3VjaERCLmFqYXggPSByZXF1aXJlKCcuL2RlcHMvYWpheCcpO1xuUG91Y2hEQi51dGlscyA9IHJlcXVpcmUoJy4vdXRpbHMnKTtcblBvdWNoREIuRXJyb3JzID0gcmVxdWlyZSgnLi9kZXBzL2Vycm9ycycpO1xuUG91Y2hEQi5yZXBsaWNhdGUgPSByZXF1aXJlKCcuL3JlcGxpY2F0ZScpLnJlcGxpY2F0ZTtcblBvdWNoREIuc3luYyA9IHJlcXVpcmUoJy4vc3luYycpO1xuUG91Y2hEQi52ZXJzaW9uID0gcmVxdWlyZSgnLi92ZXJzaW9uJyk7XG52YXIgaHR0cEFkYXB0ZXIgPSByZXF1aXJlKCcuL2FkYXB0ZXJzL2h0dHAvaHR0cCcpO1xuUG91Y2hEQi5hZGFwdGVyKCdodHRwJywgaHR0cEFkYXB0ZXIpO1xuUG91Y2hEQi5hZGFwdGVyKCdodHRwcycsIGh0dHBBZGFwdGVyKTtcblxuUG91Y2hEQi5hZGFwdGVyKCdpZGInLCByZXF1aXJlKCcuL2FkYXB0ZXJzL2lkYi9pZGInKSk7XG5Qb3VjaERCLmFkYXB0ZXIoJ3dlYnNxbCcsIHJlcXVpcmUoJy4vYWRhcHRlcnMvd2Vic3FsL3dlYnNxbCcpKTtcblBvdWNoREIucGx1Z2luKHJlcXVpcmUoJ3BvdWNoZGItbWFwcmVkdWNlJykpO1xuXG5pZiAoIXByb2Nlc3MuYnJvd3Nlcikge1xuICB2YXIgbGRiQWRhcHRlciA9IHJlcXVpcmUoJy4vYWRhcHRlcnMvbGV2ZWxkYi9sZXZlbGRiJyk7XG4gIFBvdWNoREIuYWRhcHRlcignbGRiJywgbGRiQWRhcHRlcik7XG4gIFBvdWNoREIuYWRhcHRlcignbGV2ZWxkYicsIGxkYkFkYXB0ZXIpO1xufVxuIiwiJ3VzZSBzdHJpY3QnO1xudmFyIGV4dGVuZCA9IHJlcXVpcmUoJ3BvdWNoZGItZXh0ZW5kJyk7XG5cblxuLy8gZm9yIGEgYmV0dGVyIG92ZXJ2aWV3IG9mIHdoYXQgdGhpcyBpcyBkb2luZywgcmVhZDpcbi8vIGh0dHBzOi8vZ2l0aHViLmNvbS9hcGFjaGUvY291Y2hkYi9ibG9iL21hc3Rlci9zcmMvY291Y2hkYi9jb3VjaF9rZXlfdHJlZS5lcmxcbi8vXG4vLyBCdXQgZm9yIGEgcXVpY2sgaW50cm8sIENvdWNoREIgdXNlcyBhIHJldmlzaW9uIHRyZWUgdG8gc3RvcmUgYSBkb2N1bWVudHNcbi8vIGhpc3RvcnksIEEgLT4gQiAtPiBDLCB3aGVuIGEgZG9jdW1lbnQgaGFzIGNvbmZsaWN0cywgdGhhdCBpcyBhIGJyYW5jaCBpbiB0aGVcbi8vIHRyZWUsIEEgLT4gKEIxIHwgQjIgLT4gQyksIFdlIHN0b3JlIHRoZXNlIGFzIGEgbmVzdGVkIGFycmF5IGluIHRoZSBmb3JtYXRcbi8vXG4vLyBLZXlUcmVlID0gW1BhdGggLi4uIF1cbi8vIFBhdGggPSB7cG9zOiBwb3NpdGlvbl9mcm9tX3Jvb3QsIGlkczogVHJlZX1cbi8vIFRyZWUgPSBbS2V5LCBPcHRzLCBbVHJlZSwgLi4uXV0sIGluIHBhcnRpY3VsYXIgc2luZ2xlIG5vZGU6IFtLZXksIFtdXVxuXG4vLyBjbGFzc2ljIGJpbmFyeSBzZWFyY2hcbmZ1bmN0aW9uIGJpbmFyeVNlYXJjaChhcnIsIGl0ZW0sIGNvbXBhcmF0b3IpIHtcbiAgdmFyIGxvdyA9IDA7XG4gIHZhciBoaWdoID0gYXJyLmxlbmd0aDtcbiAgdmFyIG1pZDtcbiAgd2hpbGUgKGxvdyA8IGhpZ2gpIHtcbiAgICBtaWQgPSAobG93ICsgaGlnaCkgPj4+IDE7XG4gICAgaWYgKGNvbXBhcmF0b3IoYXJyW21pZF0sIGl0ZW0pIDwgMCkge1xuICAgICAgbG93ID0gbWlkICsgMTtcbiAgICB9IGVsc2Uge1xuICAgICAgaGlnaCA9IG1pZDtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGxvdztcbn1cblxuLy8gYXNzdW1pbmcgdGhlIGFyciBpcyBzb3J0ZWQsIGluc2VydCB0aGUgaXRlbSBpbiB0aGUgcHJvcGVyIHBsYWNlXG5mdW5jdGlvbiBpbnNlcnRTb3J0ZWQoYXJyLCBpdGVtLCBjb21wYXJhdG9yKSB7XG4gIHZhciBpZHggPSBiaW5hcnlTZWFyY2goYXJyLCBpdGVtLCBjb21wYXJhdG9yKTtcbiAgYXJyLnNwbGljZShpZHgsIDAsIGl0ZW0pO1xufVxuXG4vLyBUdXJuIGEgcGF0aCBhcyBhIGZsYXQgYXJyYXkgaW50byBhIHRyZWUgd2l0aCBhIHNpbmdsZSBicmFuY2hcbmZ1bmN0aW9uIHBhdGhUb1RyZWUocGF0aCkge1xuICB2YXIgZG9jID0gcGF0aC5zaGlmdCgpO1xuICB2YXIgcm9vdCA9IFtkb2MuaWQsIGRvYy5vcHRzLCBbXV07XG4gIHZhciBsZWFmID0gcm9vdDtcbiAgdmFyIG5sZWFmO1xuXG4gIHdoaWxlIChwYXRoLmxlbmd0aCkge1xuICAgIGRvYyA9IHBhdGguc2hpZnQoKTtcbiAgICBubGVhZiA9IFtkb2MuaWQsIGRvYy5vcHRzLCBbXV07XG4gICAgbGVhZlsyXS5wdXNoKG5sZWFmKTtcbiAgICBsZWFmID0gbmxlYWY7XG4gIH1cbiAgcmV0dXJuIHJvb3Q7XG59XG5cbi8vIGNvbXBhcmUgdGhlIElEcyBvZiB0d28gdHJlZXNcbmZ1bmN0aW9uIGNvbXBhcmVUcmVlKGEsIGIpIHtcbiAgcmV0dXJuIGFbMF0gPCBiWzBdID8gLTEgOiAxO1xufVxuXG4vLyBNZXJnZSB0d28gdHJlZXMgdG9nZXRoZXJcbi8vIFRoZSByb290cyBvZiB0cmVlMSBhbmQgdHJlZTIgbXVzdCBiZSB0aGUgc2FtZSByZXZpc2lvblxuZnVuY3Rpb24gbWVyZ2VUcmVlKGluX3RyZWUxLCBpbl90cmVlMikge1xuICB2YXIgcXVldWUgPSBbe3RyZWUxOiBpbl90cmVlMSwgdHJlZTI6IGluX3RyZWUyfV07XG4gIHZhciBjb25mbGljdHMgPSBmYWxzZTtcbiAgd2hpbGUgKHF1ZXVlLmxlbmd0aCA+IDApIHtcbiAgICB2YXIgaXRlbSA9IHF1ZXVlLnBvcCgpO1xuICAgIHZhciB0cmVlMSA9IGl0ZW0udHJlZTE7XG4gICAgdmFyIHRyZWUyID0gaXRlbS50cmVlMjtcblxuICAgIGlmICh0cmVlMVsxXS5zdGF0dXMgfHwgdHJlZTJbMV0uc3RhdHVzKSB7XG4gICAgICB0cmVlMVsxXS5zdGF0dXMgPVxuICAgICAgICAodHJlZTFbMV0uc3RhdHVzID09PSAgJ2F2YWlsYWJsZScgfHxcbiAgICAgICAgIHRyZWUyWzFdLnN0YXR1cyA9PT0gJ2F2YWlsYWJsZScpID8gJ2F2YWlsYWJsZScgOiAnbWlzc2luZyc7XG4gICAgfVxuXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCB0cmVlMlsyXS5sZW5ndGg7IGkrKykge1xuICAgICAgaWYgKCF0cmVlMVsyXVswXSkge1xuICAgICAgICBjb25mbGljdHMgPSAnbmV3X2xlYWYnO1xuICAgICAgICB0cmVlMVsyXVswXSA9IHRyZWUyWzJdW2ldO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgdmFyIG1lcmdlZCA9IGZhbHNlO1xuICAgICAgZm9yICh2YXIgaiA9IDA7IGogPCB0cmVlMVsyXS5sZW5ndGg7IGorKykge1xuICAgICAgICBpZiAodHJlZTFbMl1bal1bMF0gPT09IHRyZWUyWzJdW2ldWzBdKSB7XG4gICAgICAgICAgcXVldWUucHVzaCh7dHJlZTE6IHRyZWUxWzJdW2pdLCB0cmVlMjogdHJlZTJbMl1baV19KTtcbiAgICAgICAgICBtZXJnZWQgPSB0cnVlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAoIW1lcmdlZCkge1xuICAgICAgICBjb25mbGljdHMgPSAnbmV3X2JyYW5jaCc7XG4gICAgICAgIGluc2VydFNvcnRlZCh0cmVlMVsyXSwgdHJlZTJbMl1baV0sIGNvbXBhcmVUcmVlKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgcmV0dXJuIHtjb25mbGljdHM6IGNvbmZsaWN0cywgdHJlZTogaW5fdHJlZTF9O1xufVxuXG5mdW5jdGlvbiBkb01lcmdlKHRyZWUsIHBhdGgsIGRvbnRFeHBhbmQpIHtcbiAgdmFyIHJlc3RyZWUgPSBbXTtcbiAgdmFyIGNvbmZsaWN0cyA9IGZhbHNlO1xuICB2YXIgbWVyZ2VkID0gZmFsc2U7XG4gIHZhciByZXM7XG5cbiAgaWYgKCF0cmVlLmxlbmd0aCkge1xuICAgIHJldHVybiB7dHJlZTogW3BhdGhdLCBjb25mbGljdHM6ICduZXdfbGVhZid9O1xuICB9XG5cbiAgdHJlZS5mb3JFYWNoKGZ1bmN0aW9uIChicmFuY2gpIHtcbiAgICBpZiAoYnJhbmNoLnBvcyA9PT0gcGF0aC5wb3MgJiYgYnJhbmNoLmlkc1swXSA9PT0gcGF0aC5pZHNbMF0pIHtcbiAgICAgIC8vIFBhdGhzIHN0YXJ0IGF0IHRoZSBzYW1lIHBvc2l0aW9uIGFuZCBoYXZlIHRoZSBzYW1lIHJvb3QsIHNvIHRoZXkgbmVlZFxuICAgICAgLy8gbWVyZ2VkXG4gICAgICByZXMgPSBtZXJnZVRyZWUoYnJhbmNoLmlkcywgcGF0aC5pZHMpO1xuICAgICAgcmVzdHJlZS5wdXNoKHtwb3M6IGJyYW5jaC5wb3MsIGlkczogcmVzLnRyZWV9KTtcbiAgICAgIGNvbmZsaWN0cyA9IGNvbmZsaWN0cyB8fCByZXMuY29uZmxpY3RzO1xuICAgICAgbWVyZ2VkID0gdHJ1ZTtcbiAgICB9IGVsc2UgaWYgKGRvbnRFeHBhbmQgIT09IHRydWUpIHtcbiAgICAgIC8vIFRoZSBwYXRocyBzdGFydCBhdCBhIGRpZmZlcmVudCBwb3NpdGlvbiwgdGFrZSB0aGUgZWFybGllc3QgcGF0aCBhbmRcbiAgICAgIC8vIHRyYXZlcnNlIHVwIHVudGlsIGl0IGFzIGF0IHRoZSBzYW1lIHBvaW50IGZyb20gcm9vdCBhcyB0aGUgcGF0aCB3ZVxuICAgICAgLy8gd2FudCB0byBtZXJnZS4gIElmIHRoZSBrZXlzIG1hdGNoIHdlIHJldHVybiB0aGUgbG9uZ2VyIHBhdGggd2l0aCB0aGVcbiAgICAgIC8vIG90aGVyIG1lcmdlZCBBZnRlciBzdGVtbWluZyB3ZSBkb250IHdhbnQgdG8gZXhwYW5kIHRoZSB0cmVlc1xuXG4gICAgICB2YXIgdDEgPSBicmFuY2gucG9zIDwgcGF0aC5wb3MgPyBicmFuY2ggOiBwYXRoO1xuICAgICAgdmFyIHQyID0gYnJhbmNoLnBvcyA8IHBhdGgucG9zID8gcGF0aCA6IGJyYW5jaDtcbiAgICAgIHZhciBkaWZmID0gdDIucG9zIC0gdDEucG9zO1xuXG4gICAgICB2YXIgY2FuZGlkYXRlUGFyZW50cyA9IFtdO1xuXG4gICAgICB2YXIgdHJlZXMgPSBbXTtcbiAgICAgIHRyZWVzLnB1c2goe2lkczogdDEuaWRzLCBkaWZmOiBkaWZmLCBwYXJlbnQ6IG51bGwsIHBhcmVudElkeDogbnVsbH0pO1xuICAgICAgd2hpbGUgKHRyZWVzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgdmFyIGl0ZW0gPSB0cmVlcy5wb3AoKTtcbiAgICAgICAgaWYgKGl0ZW0uZGlmZiA9PT0gMCkge1xuICAgICAgICAgIGlmIChpdGVtLmlkc1swXSA9PT0gdDIuaWRzWzBdKSB7XG4gICAgICAgICAgICBjYW5kaWRhdGVQYXJlbnRzLnB1c2goaXRlbSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmICghaXRlbS5pZHMpIHtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICAvKmpzaGludCBsb29wZnVuYzp0cnVlICovXG4gICAgICAgIGl0ZW0uaWRzWzJdLmZvckVhY2goZnVuY3Rpb24gKGVsLCBpZHgpIHtcbiAgICAgICAgICB0cmVlcy5wdXNoKFxuICAgICAgICAgICAge2lkczogZWwsIGRpZmY6IGl0ZW0uZGlmZiAtIDEsIHBhcmVudDogaXRlbS5pZHMsIHBhcmVudElkeDogaWR4fSk7XG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICB2YXIgZWwgPSBjYW5kaWRhdGVQYXJlbnRzWzBdO1xuXG4gICAgICBpZiAoIWVsKSB7XG4gICAgICAgIHJlc3RyZWUucHVzaChicmFuY2gpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmVzID0gbWVyZ2VUcmVlKGVsLmlkcywgdDIuaWRzKTtcbiAgICAgICAgZWwucGFyZW50WzJdW2VsLnBhcmVudElkeF0gPSByZXMudHJlZTtcbiAgICAgICAgcmVzdHJlZS5wdXNoKHtwb3M6IHQxLnBvcywgaWRzOiB0MS5pZHN9KTtcbiAgICAgICAgY29uZmxpY3RzID0gY29uZmxpY3RzIHx8IHJlcy5jb25mbGljdHM7XG4gICAgICAgIG1lcmdlZCA9IHRydWU7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlc3RyZWUucHVzaChicmFuY2gpO1xuICAgIH1cbiAgfSk7XG5cbiAgLy8gV2UgZGlkbnQgZmluZFxuICBpZiAoIW1lcmdlZCkge1xuICAgIHJlc3RyZWUucHVzaChwYXRoKTtcbiAgfVxuXG4gIHJlc3RyZWUuc29ydChmdW5jdGlvbiAoYSwgYikge1xuICAgIHJldHVybiBhLnBvcyAtIGIucG9zO1xuICB9KTtcblxuICByZXR1cm4ge1xuICAgIHRyZWU6IHJlc3RyZWUsXG4gICAgY29uZmxpY3RzOiBjb25mbGljdHMgfHwgJ2ludGVybmFsX25vZGUnXG4gIH07XG59XG5cbi8vIFRvIGVuc3VyZSB3ZSBkb250IGdyb3cgdGhlIHJldmlzaW9uIHRyZWUgaW5maW5pdGVseSwgd2Ugc3RlbSBvbGQgcmV2aXNpb25zXG5mdW5jdGlvbiBzdGVtKHRyZWUsIGRlcHRoKSB7XG4gIC8vIEZpcnN0IHdlIGJyZWFrIG91dCB0aGUgdHJlZSBpbnRvIGEgY29tcGxldGUgbGlzdCBvZiByb290IHRvIGxlYWYgcGF0aHMsXG4gIC8vIHdlIGN1dCBvZmYgdGhlIHN0YXJ0IG9mIHRoZSBwYXRoIGFuZCBnZW5lcmF0ZSBhIG5ldyBzZXQgb2YgZmxhdCB0cmVlc1xuICB2YXIgc3RlbW1lZFBhdGhzID0gUG91Y2hNZXJnZS5yb290VG9MZWFmKHRyZWUpLm1hcChmdW5jdGlvbiAocGF0aCkge1xuICAgIHZhciBzdGVtbWVkID0gcGF0aC5pZHMuc2xpY2UoLWRlcHRoKTtcbiAgICByZXR1cm4ge1xuICAgICAgcG9zOiBwYXRoLnBvcyArIChwYXRoLmlkcy5sZW5ndGggLSBzdGVtbWVkLmxlbmd0aCksXG4gICAgICBpZHM6IHBhdGhUb1RyZWUoc3RlbW1lZClcbiAgICB9O1xuICB9KTtcbiAgLy8gVGhlbiB3ZSByZW1lcmdlIGFsbCB0aG9zZSBmbGF0IHRyZWVzIHRvZ2V0aGVyLCBlbnN1cmluZyB0aGF0IHdlIGRvbnRcbiAgLy8gY29ubmVjdCB0cmVlcyB0aGF0IHdvdWxkIGdvIGJleW9uZCB0aGUgZGVwdGggbGltaXRcbiAgcmV0dXJuIHN0ZW1tZWRQYXRocy5yZWR1Y2UoZnVuY3Rpb24gKHByZXYsIGN1cnJlbnQpIHtcbiAgICByZXR1cm4gZG9NZXJnZShwcmV2LCBjdXJyZW50LCB0cnVlKS50cmVlO1xuICB9LCBbc3RlbW1lZFBhdGhzLnNoaWZ0KCldKTtcbn1cblxudmFyIFBvdWNoTWVyZ2UgPSB7fTtcblxuUG91Y2hNZXJnZS5tZXJnZSA9IGZ1bmN0aW9uICh0cmVlLCBwYXRoLCBkZXB0aCkge1xuICAvLyBVZ2gsIG5pY2VyIHdheSB0byBub3QgbW9kaWZ5IGFyZ3VtZW50cyBpbiBwbGFjZT9cbiAgdHJlZSA9IGV4dGVuZCh0cnVlLCBbXSwgdHJlZSk7XG4gIHBhdGggPSBleHRlbmQodHJ1ZSwge30sIHBhdGgpO1xuICB2YXIgbmV3VHJlZSA9IGRvTWVyZ2UodHJlZSwgcGF0aCk7XG4gIHJldHVybiB7XG4gICAgdHJlZTogc3RlbShuZXdUcmVlLnRyZWUsIGRlcHRoKSxcbiAgICBjb25mbGljdHM6IG5ld1RyZWUuY29uZmxpY3RzXG4gIH07XG59O1xuXG4vLyBXZSBmZXRjaCBhbGwgbGVhZnMgb2YgdGhlIHJldmlzaW9uIHRyZWUsIGFuZCBzb3J0IHRoZW0gYmFzZWQgb24gdHJlZSBsZW5ndGhcbi8vIGFuZCB3aGV0aGVyIHRoZXkgd2VyZSBkZWxldGVkLCB1bmRlbGV0ZWQgZG9jdW1lbnRzIHdpdGggdGhlIGxvbmdlc3QgcmV2aXNpb25cbi8vIHRyZWUgKG1vc3QgZWRpdHMpIHdpblxuLy8gVGhlIGZpbmFsIHNvcnQgYWxnb3JpdGhtIGlzIHNsaWdodGx5IGRvY3VtZW50ZWQgaW4gYSBzaWRlYmFyIGhlcmU6XG4vLyBodHRwOi8vZ3VpZGUuY291Y2hkYi5vcmcvZHJhZnQvY29uZmxpY3RzLmh0bWxcblBvdWNoTWVyZ2Uud2lubmluZ1JldiA9IGZ1bmN0aW9uIChtZXRhZGF0YSkge1xuICB2YXIgbGVhZnMgPSBbXTtcbiAgUG91Y2hNZXJnZS50cmF2ZXJzZVJldlRyZWUobWV0YWRhdGEucmV2X3RyZWUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBmdW5jdGlvbiAoaXNMZWFmLCBwb3MsIGlkLCBzb21ldGhpbmcsIG9wdHMpIHtcbiAgICBpZiAoaXNMZWFmKSB7XG4gICAgICBsZWFmcy5wdXNoKHtwb3M6IHBvcywgaWQ6IGlkLCBkZWxldGVkOiAhIW9wdHMuZGVsZXRlZH0pO1xuICAgIH1cbiAgfSk7XG4gIGxlYWZzLnNvcnQoZnVuY3Rpb24gKGEsIGIpIHtcbiAgICBpZiAoYS5kZWxldGVkICE9PSBiLmRlbGV0ZWQpIHtcbiAgICAgIHJldHVybiBhLmRlbGV0ZWQgPiBiLmRlbGV0ZWQgPyAxIDogLTE7XG4gICAgfVxuICAgIGlmIChhLnBvcyAhPT0gYi5wb3MpIHtcbiAgICAgIHJldHVybiBiLnBvcyAtIGEucG9zO1xuICAgIH1cbiAgICByZXR1cm4gYS5pZCA8IGIuaWQgPyAxIDogLTE7XG4gIH0pO1xuXG4gIHJldHVybiBsZWFmc1swXS5wb3MgKyAnLScgKyBsZWFmc1swXS5pZDtcbn07XG5cbi8vIFByZXR0eSBtdWNoIGFsbCBiZWxvdyBjYW4gYmUgY29tYmluZWQgaW50byBhIGhpZ2hlciBvcmRlciBmdW5jdGlvbiB0b1xuLy8gdHJhdmVyc2UgcmV2aXNpb25zXG4vLyBUaGUgcmV0dXJuIHZhbHVlIGZyb20gdGhlIGNhbGxiYWNrIHdpbGwgYmUgcGFzc2VkIGFzIGNvbnRleHQgdG8gYWxsXG4vLyBjaGlsZHJlbiBvZiB0aGF0IG5vZGVcblBvdWNoTWVyZ2UudHJhdmVyc2VSZXZUcmVlID0gZnVuY3Rpb24gKHJldnMsIGNhbGxiYWNrKSB7XG4gIHZhciB0b1Zpc2l0ID0gcmV2cy5zbGljZSgpO1xuXG4gIHZhciBub2RlO1xuICB3aGlsZSAoKG5vZGUgPSB0b1Zpc2l0LnBvcCgpKSkge1xuICAgIHZhciBwb3MgPSBub2RlLnBvcztcbiAgICB2YXIgdHJlZSA9IG5vZGUuaWRzO1xuICAgIHZhciBicmFuY2hlcyA9IHRyZWVbMl07XG4gICAgdmFyIG5ld0N0eCA9XG4gICAgICBjYWxsYmFjayhicmFuY2hlcy5sZW5ndGggPT09IDAsIHBvcywgdHJlZVswXSwgbm9kZS5jdHgsIHRyZWVbMV0pO1xuICAgIGZvciAodmFyIGkgPSAwLCBsZW4gPSBicmFuY2hlcy5sZW5ndGg7IGkgPCBsZW47IGkrKykge1xuICAgICAgdG9WaXNpdC5wdXNoKHtwb3M6IHBvcyArIDEsIGlkczogYnJhbmNoZXNbaV0sIGN0eDogbmV3Q3R4fSk7XG4gICAgfVxuICB9XG59O1xuXG5Qb3VjaE1lcmdlLmNvbGxlY3RMZWF2ZXMgPSBmdW5jdGlvbiAocmV2cykge1xuICB2YXIgbGVhdmVzID0gW107XG4gIFBvdWNoTWVyZ2UudHJhdmVyc2VSZXZUcmVlKHJldnMsIGZ1bmN0aW9uIChpc0xlYWYsIHBvcywgaWQsIGFjYywgb3B0cykge1xuICAgIGlmIChpc0xlYWYpIHtcbiAgICAgIGxlYXZlcy5wdXNoKHtyZXY6IHBvcyArIFwiLVwiICsgaWQsIHBvczogcG9zLCBvcHRzOiBvcHRzfSk7XG4gICAgfVxuICB9KTtcbiAgbGVhdmVzLnNvcnQoZnVuY3Rpb24gKGEsIGIpIHtcbiAgICByZXR1cm4gYi5wb3MgLSBhLnBvcztcbiAgfSk7XG4gIGxlYXZlcy5mb3JFYWNoKGZ1bmN0aW9uIChsZWFmKSB7IGRlbGV0ZSBsZWFmLnBvczsgfSk7XG4gIHJldHVybiBsZWF2ZXM7XG59O1xuXG4vLyByZXR1cm5zIHJldnMgb2YgYWxsIGNvbmZsaWN0cyB0aGF0IGlzIGxlYXZlcyBzdWNoIHRoYXRcbi8vIDEuIGFyZSBub3QgZGVsZXRlZCBhbmRcbi8vIDIuIGFyZSBkaWZmZXJlbnQgdGhhbiB3aW5uaW5nIHJldmlzaW9uXG5Qb3VjaE1lcmdlLmNvbGxlY3RDb25mbGljdHMgPSBmdW5jdGlvbiAobWV0YWRhdGEpIHtcbiAgdmFyIHdpbiA9IFBvdWNoTWVyZ2Uud2lubmluZ1JldihtZXRhZGF0YSk7XG4gIHZhciBsZWF2ZXMgPSBQb3VjaE1lcmdlLmNvbGxlY3RMZWF2ZXMobWV0YWRhdGEucmV2X3RyZWUpO1xuICB2YXIgY29uZmxpY3RzID0gW107XG4gIGxlYXZlcy5mb3JFYWNoKGZ1bmN0aW9uIChsZWFmKSB7XG4gICAgaWYgKGxlYWYucmV2ICE9PSB3aW4gJiYgIWxlYWYub3B0cy5kZWxldGVkKSB7XG4gICAgICBjb25mbGljdHMucHVzaChsZWFmLnJldik7XG4gICAgfVxuICB9KTtcbiAgcmV0dXJuIGNvbmZsaWN0cztcbn07XG5cblBvdWNoTWVyZ2Uucm9vdFRvTGVhZiA9IGZ1bmN0aW9uICh0cmVlKSB7XG4gIHZhciBwYXRocyA9IFtdO1xuICBQb3VjaE1lcmdlLnRyYXZlcnNlUmV2VHJlZSh0cmVlLCBmdW5jdGlvbiAoaXNMZWFmLCBwb3MsIGlkLCBoaXN0b3J5LCBvcHRzKSB7XG4gICAgaGlzdG9yeSA9IGhpc3RvcnkgPyBoaXN0b3J5LnNsaWNlKDApIDogW107XG4gICAgaGlzdG9yeS5wdXNoKHtpZDogaWQsIG9wdHM6IG9wdHN9KTtcbiAgICBpZiAoaXNMZWFmKSB7XG4gICAgICB2YXIgcm9vdFBvcyA9IHBvcyArIDEgLSBoaXN0b3J5Lmxlbmd0aDtcbiAgICAgIHBhdGhzLnVuc2hpZnQoe3Bvczogcm9vdFBvcywgaWRzOiBoaXN0b3J5fSk7XG4gICAgfVxuICAgIHJldHVybiBoaXN0b3J5O1xuICB9KTtcbiAgcmV0dXJuIHBhdGhzO1xufTtcblxuXG5tb2R1bGUuZXhwb3J0cyA9IFBvdWNoTWVyZ2U7XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciB1dGlscyA9IHJlcXVpcmUoJy4vdXRpbHMnKTtcbnZhciBFRSA9IHJlcXVpcmUoJ2V2ZW50cycpLkV2ZW50RW1pdHRlcjtcbnZhciBDaGVja3BvaW50ZXIgPSByZXF1aXJlKCcuL2NoZWNrcG9pbnRlcicpO1xuXG52YXIgTUFYX1NJTVVMVEFORU9VU19SRVZTID0gNTA7XG52YXIgUkVUUllfREVGQVVMVCA9IGZhbHNlO1xuXG5mdW5jdGlvbiByYW5kb21OdW1iZXIobWluLCBtYXgpIHtcbiAgbWluID0gcGFyc2VJbnQobWluLCAxMCk7XG4gIG1heCA9IHBhcnNlSW50KG1heCwgMTApO1xuICBpZiAobWluICE9PSBtaW4pIHtcbiAgICBtaW4gPSAwO1xuICB9XG4gIGlmIChtYXggIT09IG1heCB8fCBtYXggPD0gbWluKSB7XG4gICAgbWF4ID0gKG1pbiB8fCAxKSA8PCAxOyAvL2RvdWJsaW5nXG4gIH0gZWxzZSB7XG4gICAgbWF4ID0gbWF4ICsgMTtcbiAgfVxuICB2YXIgcmF0aW8gPSBNYXRoLnJhbmRvbSgpO1xuICB2YXIgcmFuZ2UgPSBtYXggLSBtaW47XG5cbiAgcmV0dXJuIH5+KHJhbmdlICogcmF0aW8gKyBtaW4pOyAvLyB+fiBjb2VyY2VzIHRvIGFuIGludCwgYnV0IGZhc3QuXG59XG5cbmZ1bmN0aW9uIGRlZmF1bHRCYWNrT2ZmKG1pbikge1xuICB2YXIgbWF4ID0gMDtcbiAgaWYgKCFtaW4pIHtcbiAgICBtYXggPSAyMDAwO1xuICB9XG4gIHJldHVybiByYW5kb21OdW1iZXIobWluLCBtYXgpO1xufVxuXG5mdW5jdGlvbiBiYWNrT2ZmKHJlcElkLCBzcmMsIHRhcmdldCwgb3B0cywgcmV0dXJuVmFsdWUsIHJlc3VsdCwgZXJyb3IpIHtcbiAgaWYgKG9wdHMucmV0cnkgPT09IGZhbHNlKSB7XG4gICAgcmV0dXJuVmFsdWUuZW1pdCgnZXJyb3InLCBlcnJvcik7XG4gICAgcmV0dXJuVmFsdWUucmVtb3ZlQWxsTGlzdGVuZXJzKCk7XG4gICAgcmV0dXJuO1xuICB9XG4gIG9wdHMuZGVmYXVsdF9iYWNrX29mZiA9IG9wdHMuZGVmYXVsdF9iYWNrX29mZiB8fCAwO1xuICBvcHRzLnJldHJpZXMgPSBvcHRzLnJldHJpZXMgfHwgMDtcbiAgaWYgKHR5cGVvZiBvcHRzLmJhY2tfb2ZmX2Z1bmN0aW9uICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgb3B0cy5iYWNrX29mZl9mdW5jdGlvbiA9IGRlZmF1bHRCYWNrT2ZmO1xuICB9XG4gIG9wdHMucmV0cmllcysrO1xuICBpZiAob3B0cy5tYXhfcmV0cmllcyAmJiBvcHRzLnJldHJpZXMgPiBvcHRzLm1heF9yZXRyaWVzKSB7XG4gICAgcmV0dXJuVmFsdWUuZW1pdCgnZXJyb3InLCBuZXcgRXJyb3IoJ3RyaWVkICcgK1xuICAgICAgb3B0cy5yZXRyaWVzICsgJyB0aW1lcyBidXQgcmVwbGljYXRpb24gZmFpbGVkJykpO1xuICAgIHJldHVyblZhbHVlLnJlbW92ZUFsbExpc3RlbmVycygpO1xuICAgIHJldHVybjtcbiAgfVxuICByZXR1cm5WYWx1ZS5lbWl0KCdyZXF1ZXN0RXJyb3InLCBlcnJvcik7XG4gIGlmIChyZXR1cm5WYWx1ZS5zdGF0ZSA9PT0gJ2FjdGl2ZScpIHtcbiAgICByZXR1cm5WYWx1ZS5lbWl0KCdwYXVzZWQnLCBlcnJvcik7XG4gICAgcmV0dXJuVmFsdWUuc3RhdGUgPSAnc3RvcHBlZCc7XG4gICAgcmV0dXJuVmFsdWUub25jZSgnYWN0aXZlJywgZnVuY3Rpb24gKCkge1xuICAgICAgb3B0cy5jdXJyZW50X2JhY2tfb2ZmID0gb3B0cy5kZWZhdWx0X2JhY2tfb2ZmO1xuICAgIH0pO1xuICB9XG5cbiAgb3B0cy5jdXJyZW50X2JhY2tfb2ZmID0gb3B0cy5jdXJyZW50X2JhY2tfb2ZmIHx8IG9wdHMuZGVmYXVsdF9iYWNrX29mZjtcbiAgb3B0cy5jdXJyZW50X2JhY2tfb2ZmID0gb3B0cy5iYWNrX29mZl9mdW5jdGlvbihvcHRzLmN1cnJlbnRfYmFja19vZmYpO1xuICBzZXRUaW1lb3V0KGZ1bmN0aW9uICgpIHtcbiAgICByZXBsaWNhdGUocmVwSWQsIHNyYywgdGFyZ2V0LCBvcHRzLCByZXR1cm5WYWx1ZSk7XG4gIH0sIG9wdHMuY3VycmVudF9iYWNrX29mZik7XG59XG5cbi8vIFdlIGNyZWF0ZSBhIGJhc2ljIHByb21pc2Ugc28gdGhlIGNhbGxlciBjYW4gY2FuY2VsIHRoZSByZXBsaWNhdGlvbiBwb3NzaWJseVxuLy8gYmVmb3JlIHdlIGhhdmUgYWN0dWFsbHkgc3RhcnRlZCBsaXN0ZW5pbmcgdG8gY2hhbmdlcyBldGNcbnV0aWxzLmluaGVyaXRzKFJlcGxpY2F0aW9uLCBFRSk7XG5mdW5jdGlvbiBSZXBsaWNhdGlvbigpIHtcbiAgRUUuY2FsbCh0aGlzKTtcbiAgdGhpcy5jYW5jZWxsZWQgPSBmYWxzZTtcbiAgdGhpcy5zdGF0ZSA9ICdwZW5kaW5nJztcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICB2YXIgcHJvbWlzZSA9IG5ldyB1dGlscy5Qcm9taXNlKGZ1bmN0aW9uIChmdWxmaWxsLCByZWplY3QpIHtcbiAgICBzZWxmLm9uY2UoJ2NvbXBsZXRlJywgZnVsZmlsbCk7XG4gICAgc2VsZi5vbmNlKCdlcnJvcicsIHJlamVjdCk7XG4gIH0pO1xuICBzZWxmLnRoZW4gPSBmdW5jdGlvbiAocmVzb2x2ZSwgcmVqZWN0KSB7XG4gICAgcmV0dXJuIHByb21pc2UudGhlbihyZXNvbHZlLCByZWplY3QpO1xuICB9O1xuICBzZWxmW1wiY2F0Y2hcIl0gPSBmdW5jdGlvbiAocmVqZWN0KSB7XG4gICAgcmV0dXJuIHByb21pc2VbXCJjYXRjaFwiXShyZWplY3QpO1xuICB9O1xuICAvLyBBcyB3ZSBhbGxvdyBlcnJvciBoYW5kbGluZyB2aWEgXCJlcnJvclwiIGV2ZW50IGFzIHdlbGwsXG4gIC8vIHB1dCBhIHN0dWIgaW4gaGVyZSBzbyB0aGF0IHJlamVjdGluZyBuZXZlciB0aHJvd3MgVW5oYW5kbGVkRXJyb3IuXG4gIHNlbGZbXCJjYXRjaFwiXShmdW5jdGlvbiAoKSB7fSk7XG59XG5cblJlcGxpY2F0aW9uLnByb3RvdHlwZS5jYW5jZWwgPSBmdW5jdGlvbiAoKSB7XG4gIHRoaXMuY2FuY2VsbGVkID0gdHJ1ZTtcbiAgdGhpcy5zdGF0ZSA9ICdjYW5jZWxsZWQnO1xuICB0aGlzLmVtaXQoJ2NhbmNlbCcpO1xufTtcblxuUmVwbGljYXRpb24ucHJvdG90eXBlLnJlYWR5ID0gZnVuY3Rpb24gKHNyYywgdGFyZ2V0KSB7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgZnVuY3Rpb24gb25EZXN0cm95KCkge1xuICAgIHNlbGYuY2FuY2VsKCk7XG4gIH1cbiAgc3JjLm9uY2UoJ2Rlc3Ryb3llZCcsIG9uRGVzdHJveSk7XG4gIHRhcmdldC5vbmNlKCdkZXN0cm95ZWQnLCBvbkRlc3Ryb3kpO1xuICBmdW5jdGlvbiBjbGVhbnVwKCkge1xuICAgIHNyYy5yZW1vdmVMaXN0ZW5lcignZGVzdHJveWVkJywgb25EZXN0cm95KTtcbiAgICB0YXJnZXQucmVtb3ZlTGlzdGVuZXIoJ2Rlc3Ryb3llZCcsIG9uRGVzdHJveSk7XG4gIH1cbiAgdGhpcy50aGVuKGNsZWFudXAsIGNsZWFudXApO1xufTtcblxuXG4vLyBUT0RPOiBjaGVjayBDb3VjaERCJ3MgcmVwbGljYXRpb24gaWQgZ2VuZXJhdGlvblxuLy8gR2VuZXJhdGUgYSB1bmlxdWUgaWQgcGFydGljdWxhciB0byB0aGlzIHJlcGxpY2F0aW9uXG5mdW5jdGlvbiBnZW5SZXBsaWNhdGlvbklkKHNyYywgdGFyZ2V0LCBvcHRzKSB7XG4gIHZhciBmaWx0ZXJGdW4gPSBvcHRzLmZpbHRlciA/IG9wdHMuZmlsdGVyLnRvU3RyaW5nKCkgOiAnJztcbiAgcmV0dXJuIHNyYy5pZCgpLnRoZW4oZnVuY3Rpb24gKHNyY19pZCkge1xuICAgIHJldHVybiB0YXJnZXQuaWQoKS50aGVuKGZ1bmN0aW9uICh0YXJnZXRfaWQpIHtcbiAgICAgIHZhciBxdWVyeURhdGEgPSBzcmNfaWQgKyB0YXJnZXRfaWQgKyBmaWx0ZXJGdW4gK1xuICAgICAgICBKU09OLnN0cmluZ2lmeShvcHRzLnF1ZXJ5X3BhcmFtcykgKyBvcHRzLmRvY19pZHM7XG4gICAgICByZXR1cm4gdXRpbHMuTUQ1KHF1ZXJ5RGF0YSkudGhlbihmdW5jdGlvbiAobWQ1KSB7XG4gICAgICAgIC8vIGNhbid0IHVzZSBzdHJhaWdodC11cCBtZDUgYWxwaGFiZXQsIGJlY2F1c2VcbiAgICAgICAgLy8gdGhlIGNoYXIgJy8nIGlzIGludGVycHJldGVkIGFzIGJlaW5nIGZvciBhdHRhY2htZW50cyxcbiAgICAgICAgLy8gYW5kICsgaXMgYWxzbyBub3QgdXJsLXNhZmVcbiAgICAgICAgbWQ1ID0gbWQ1LnJlcGxhY2UoL1xcLy9nLCAnLicpLnJlcGxhY2UoL1xcKy9nLCAnXycpO1xuICAgICAgICByZXR1cm4gJ19sb2NhbC8nICsgbWQ1O1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH0pO1xufVxuXG5mdW5jdGlvbiByZXBsaWNhdGUocmVwSWQsIHNyYywgdGFyZ2V0LCBvcHRzLCByZXR1cm5WYWx1ZSwgcmVzdWx0KSB7XG4gIHZhciBiYXRjaGVzID0gW107ICAgICAgICAgICAgICAgLy8gbGlzdCBvZiBiYXRjaGVzIHRvIGJlIHByb2Nlc3NlZFxuICB2YXIgY3VycmVudEJhdGNoOyAgICAgICAgICAgICAgIC8vIHRoZSBiYXRjaCBjdXJyZW50bHkgYmVpbmcgcHJvY2Vzc2VkXG4gIHZhciBwZW5kaW5nQmF0Y2ggPSB7XG4gICAgc2VxOiAwLFxuICAgIGNoYW5nZXM6IFtdLFxuICAgIGRvY3M6IFtdXG4gIH07IC8vIG5leHQgYmF0Y2gsIG5vdCB5ZXQgcmVhZHkgdG8gYmUgcHJvY2Vzc2VkXG4gIHZhciB3cml0aW5nQ2hlY2twb2ludCA9IGZhbHNlOyAgLy8gdHJ1ZSB3aGlsZSBjaGVja3BvaW50IGlzIGJlaW5nIHdyaXR0ZW5cbiAgdmFyIGNoYW5nZXNDb21wbGV0ZWQgPSBmYWxzZTsgICAvLyB0cnVlIHdoZW4gYWxsIGNoYW5nZXMgcmVjZWl2ZWRcbiAgdmFyIHJlcGxpY2F0aW9uQ29tcGxldGVkID0gZmFsc2U7IC8vIHRydWUgd2hlbiByZXBsaWNhdGlvbiBoYXMgY29tcGxldGVkXG4gIHZhciBsYXN0X3NlcSA9IDA7XG4gIHZhciBjb250aW51b3VzID0gb3B0cy5jb250aW51b3VzIHx8IG9wdHMubGl2ZSB8fCBmYWxzZTtcbiAgdmFyIGJhdGNoX3NpemUgPSBvcHRzLmJhdGNoX3NpemUgfHwgMTAwO1xuICB2YXIgYmF0Y2hlc19saW1pdCA9IG9wdHMuYmF0Y2hlc19saW1pdCB8fCAxMDtcbiAgdmFyIGNoYW5nZXNQZW5kaW5nID0gZmFsc2U7ICAgICAvLyB0cnVlIHdoaWxlIHNyYy5jaGFuZ2VzIGlzIHJ1bm5pbmdcbiAgdmFyIGRvY19pZHMgPSBvcHRzLmRvY19pZHM7XG4gIHZhciBzdGF0ZSA9IHtcbiAgICBjYW5jZWxsZWQ6IGZhbHNlXG4gIH07XG4gIHZhciBjaGVja3BvaW50ZXIgPSBuZXcgQ2hlY2twb2ludGVyKHNyYywgdGFyZ2V0LCByZXBJZCwgc3RhdGUpO1xuICB2YXIgYWxsRXJyb3JzID0gW107XG4gIHZhciBjaGFuZ2VkRG9jcyA9IFtdO1xuXG4gIHJlc3VsdCA9IHJlc3VsdCB8fCB7XG4gICAgb2s6IHRydWUsXG4gICAgc3RhcnRfdGltZTogbmV3IERhdGUoKSxcbiAgICBkb2NzX3JlYWQ6IDAsXG4gICAgZG9jc193cml0dGVuOiAwLFxuICAgIGRvY193cml0ZV9mYWlsdXJlczogMCxcbiAgICBlcnJvcnM6IFtdXG4gIH07XG5cbiAgdmFyIGNoYW5nZXNPcHRzID0ge307XG4gIHJldHVyblZhbHVlLnJlYWR5KHNyYywgdGFyZ2V0KTtcblxuICBmdW5jdGlvbiB3cml0ZURvY3MoKSB7XG4gICAgaWYgKGN1cnJlbnRCYXRjaC5kb2NzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB2YXIgZG9jcyA9IGN1cnJlbnRCYXRjaC5kb2NzO1xuICAgIHJldHVybiB0YXJnZXQuYnVsa0RvY3Moe2RvY3M6IGRvY3MsIG5ld19lZGl0czogZmFsc2V9KS50aGVuKGZ1bmN0aW9uIChyZXMpIHtcbiAgICAgIGlmIChzdGF0ZS5jYW5jZWxsZWQpIHtcbiAgICAgICAgY29tcGxldGVSZXBsaWNhdGlvbigpO1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ2NhbmNlbGxlZCcpO1xuICAgICAgfVxuICAgICAgdmFyIGVycm9ycyA9IFtdO1xuICAgICAgdmFyIGVycm9yc0J5SWQgPSB7fTtcbiAgICAgIHJlcy5mb3JFYWNoKGZ1bmN0aW9uIChyZXMpIHtcbiAgICAgICAgaWYgKHJlcy5lcnJvcikge1xuICAgICAgICAgIHJlc3VsdC5kb2Nfd3JpdGVfZmFpbHVyZXMrKztcbiAgICAgICAgICBlcnJvcnMucHVzaChyZXMpO1xuICAgICAgICAgIGVycm9yc0J5SWRbcmVzLmlkXSA9IHJlcztcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICByZXN1bHQuZXJyb3JzID0gZXJyb3JzO1xuICAgICAgYWxsRXJyb3JzID0gYWxsRXJyb3JzLmNvbmNhdChlcnJvcnMpO1xuICAgICAgcmVzdWx0LmRvY3Nfd3JpdHRlbiArPSBjdXJyZW50QmF0Y2guZG9jcy5sZW5ndGggLSBlcnJvcnMubGVuZ3RoO1xuICAgICAgdmFyIG5vbjQwM3MgPSBlcnJvcnMuZmlsdGVyKGZ1bmN0aW9uIChlcnJvcikge1xuICAgICAgICByZXR1cm4gZXJyb3IubmFtZSAhPT0gJ3VuYXV0aG9yaXplZCcgJiYgZXJyb3IubmFtZSAhPT0gJ2ZvcmJpZGRlbic7XG4gICAgICB9KTtcblxuICAgICAgY2hhbmdlZERvY3MgPSBbXTtcbiAgICAgIGRvY3MuZm9yRWFjaChmdW5jdGlvbihkb2MpIHtcbiAgICAgICAgdmFyIGVycm9yID0gZXJyb3JzQnlJZFtkb2MuX2lkXTtcbiAgICAgICAgaWYgKGVycm9yKSB7XG4gICAgICAgICAgcmV0dXJuVmFsdWUuZW1pdCgnZGVuaWVkJywgdXRpbHMuY2xvbmUoZXJyb3IpKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjaGFuZ2VkRG9jcy5wdXNoKGRvYyk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBpZiAobm9uNDAzcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIHZhciBlcnJvciA9IG5ldyBFcnJvcignYnVsa0RvY3MgZXJyb3InKTtcbiAgICAgICAgZXJyb3Iub3RoZXJfZXJyb3JzID0gZXJyb3JzO1xuICAgICAgICBhYm9ydFJlcGxpY2F0aW9uKCd0YXJnZXQuYnVsa0RvY3MgZmFpbGVkIHRvIHdyaXRlIGRvY3MnLCBlcnJvcik7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignYnVsa1dyaXRlIHBhcnRpYWwgZmFpbHVyZScpO1xuICAgICAgfVxuICAgIH0sIGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgIHJlc3VsdC5kb2Nfd3JpdGVfZmFpbHVyZXMgKz0gZG9jcy5sZW5ndGg7XG4gICAgICB0aHJvdyBlcnI7XG4gICAgfSk7XG4gIH1cblxuICBmdW5jdGlvbiBwcm9jZXNzRGlmZkRvYyhpZCkge1xuICAgIHZhciBkaWZmcyA9IGN1cnJlbnRCYXRjaC5kaWZmcztcbiAgICB2YXIgYWxsTWlzc2luZyA9IGRpZmZzW2lkXS5taXNzaW5nO1xuICAgIC8vIGF2b2lkIHVybCB0b28gbG9uZyBlcnJvciBieSBiYXRjaGluZ1xuICAgIHZhciBtaXNzaW5nQmF0Y2hlcyA9IFtdO1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgYWxsTWlzc2luZy5sZW5ndGg7IGkgKz0gTUFYX1NJTVVMVEFORU9VU19SRVZTKSB7XG4gICAgICBtaXNzaW5nQmF0Y2hlcy5wdXNoKGFsbE1pc3Npbmcuc2xpY2UoaSwgTWF0aC5taW4oYWxsTWlzc2luZy5sZW5ndGgsXG4gICAgICAgIGkgKyBNQVhfU0lNVUxUQU5FT1VTX1JFVlMpKSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHV0aWxzLlByb21pc2UuYWxsKG1pc3NpbmdCYXRjaGVzLm1hcChmdW5jdGlvbiAobWlzc2luZykge1xuICAgICAgdmFyIG9wdHMgPSB7XG4gICAgICAgIHJldnM6IHRydWUsXG4gICAgICAgIG9wZW5fcmV2czogbWlzc2luZyxcbiAgICAgICAgYXR0YWNobWVudHM6IHRydWVcbiAgICAgIH07XG4gICAgICByZXR1cm4gc3JjLmdldChpZCwgb3B0cykudGhlbihmdW5jdGlvbiAoZG9jcykge1xuICAgICAgICBkb2NzLmZvckVhY2goZnVuY3Rpb24gKGRvYykge1xuICAgICAgICAgIGlmIChzdGF0ZS5jYW5jZWxsZWQpIHtcbiAgICAgICAgICAgIHJldHVybiBjb21wbGV0ZVJlcGxpY2F0aW9uKCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChkb2Mub2spIHtcbiAgICAgICAgICAgIHJlc3VsdC5kb2NzX3JlYWQrKztcbiAgICAgICAgICAgIGN1cnJlbnRCYXRjaC5wZW5kaW5nUmV2cysrO1xuICAgICAgICAgICAgY3VycmVudEJhdGNoLmRvY3MucHVzaChkb2Mub2spO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIGRlbGV0ZSBkaWZmc1tpZF07XG4gICAgICB9KTtcbiAgICB9KSk7XG4gIH1cblxuICBmdW5jdGlvbiBnZXRBbGxEb2NzKCkge1xuICAgIHZhciBkaWZmS2V5cyA9IE9iamVjdC5rZXlzKGN1cnJlbnRCYXRjaC5kaWZmcyk7XG4gICAgcmV0dXJuIHV0aWxzLlByb21pc2UuYWxsKGRpZmZLZXlzLm1hcChwcm9jZXNzRGlmZkRvYykpO1xuICB9XG5cblxuICBmdW5jdGlvbiBnZXRSZXZpc2lvbk9uZURvY3MoKSB7XG4gICAgLy8gZmlsdGVyIG91dCB0aGUgZ2VuZXJhdGlvbiAxIGRvY3MgYW5kIGdldCB0aGVtXG4gICAgLy8gbGVhdmluZyB0aGUgbm9uLWdlbmVyYXRpb24gb25lIGRvY3MgdG8gYmUgZ290IG90aGVyd2lzZVxuICAgIHZhciBpZHMgPSBPYmplY3Qua2V5cyhjdXJyZW50QmF0Y2guZGlmZnMpLmZpbHRlcihmdW5jdGlvbiAoaWQpIHtcbiAgICAgIHZhciBtaXNzaW5nID0gY3VycmVudEJhdGNoLmRpZmZzW2lkXS5taXNzaW5nO1xuICAgICAgcmV0dXJuIG1pc3NpbmcubGVuZ3RoID09PSAxICYmIG1pc3NpbmdbMF0uc2xpY2UoMCwgMikgPT09ICcxLSc7XG4gICAgfSk7XG4gICAgaWYgKCFpZHMubGVuZ3RoKSB7IC8vIG5vdGhpbmcgdG8gZmV0Y2hcbiAgICAgIHJldHVybiB1dGlscy5Qcm9taXNlLnJlc29sdmUoKTtcbiAgICB9XG4gICAgcmV0dXJuIHNyYy5hbGxEb2NzKHtcbiAgICAgIGtleXM6IGlkcyxcbiAgICAgIGluY2x1ZGVfZG9jczogdHJ1ZVxuICAgIH0pLnRoZW4oZnVuY3Rpb24gKHJlcykge1xuICAgICAgaWYgKHN0YXRlLmNhbmNlbGxlZCkge1xuICAgICAgICBjb21wbGV0ZVJlcGxpY2F0aW9uKCk7XG4gICAgICAgIHRocm93IChuZXcgRXJyb3IoJ2NhbmNlbGxlZCcpKTtcbiAgICAgIH1cbiAgICAgIHJlcy5yb3dzLmZvckVhY2goZnVuY3Rpb24gKHJvdykge1xuICAgICAgICBpZiAocm93LmRvYyAmJiAhcm93LmRlbGV0ZWQgJiZcbiAgICAgICAgICByb3cudmFsdWUucmV2LnNsaWNlKDAsIDIpID09PSAnMS0nICYmIChcbiAgICAgICAgICAgICFyb3cuZG9jLl9hdHRhY2htZW50cyB8fFxuICAgICAgICAgICAgT2JqZWN0LmtleXMocm93LmRvYy5fYXR0YWNobWVudHMpLmxlbmd0aCA9PT0gMFxuICAgICAgICAgIClcbiAgICAgICAgKSB7XG4gICAgICAgICAgcmVzdWx0LmRvY3NfcmVhZCsrO1xuICAgICAgICAgIGN1cnJlbnRCYXRjaC5wZW5kaW5nUmV2cysrO1xuICAgICAgICAgIGN1cnJlbnRCYXRjaC5kb2NzLnB1c2gocm93LmRvYyk7XG4gICAgICAgICAgZGVsZXRlIGN1cnJlbnRCYXRjaC5kaWZmc1tyb3cuaWRdO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGdldERvY3MoKSB7XG4gICAgcmV0dXJuIGdldFJldmlzaW9uT25lRG9jcygpLnRoZW4oZ2V0QWxsRG9jcyk7XG4gIH1cblxuICBmdW5jdGlvbiBmaW5pc2hCYXRjaCgpIHtcbiAgICB3cml0aW5nQ2hlY2twb2ludCA9IHRydWU7XG4gICAgcmV0dXJuIGNoZWNrcG9pbnRlci53cml0ZUNoZWNrcG9pbnQoY3VycmVudEJhdGNoLnNlcSkudGhlbihmdW5jdGlvbiAoKSB7XG4gICAgICB3cml0aW5nQ2hlY2twb2ludCA9IGZhbHNlO1xuICAgICAgaWYgKHN0YXRlLmNhbmNlbGxlZCkge1xuICAgICAgICBjb21wbGV0ZVJlcGxpY2F0aW9uKCk7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignY2FuY2VsbGVkJyk7XG4gICAgICB9XG4gICAgICByZXN1bHQubGFzdF9zZXEgPSBsYXN0X3NlcSA9IGN1cnJlbnRCYXRjaC5zZXE7XG4gICAgICB2YXIgb3V0UmVzdWx0ID0gdXRpbHMuY2xvbmUocmVzdWx0KTtcbiAgICAgIG91dFJlc3VsdC5kb2NzID0gY2hhbmdlZERvY3M7XG4gICAgICByZXR1cm5WYWx1ZS5lbWl0KCdjaGFuZ2UnLCBvdXRSZXN1bHQpO1xuICAgICAgY3VycmVudEJhdGNoID0gdW5kZWZpbmVkO1xuICAgICAgZ2V0Q2hhbmdlcygpO1xuICAgIH0pW1wiY2F0Y2hcIl0oZnVuY3Rpb24gKGVycikge1xuICAgICAgd3JpdGluZ0NoZWNrcG9pbnQgPSBmYWxzZTtcbiAgICAgIGFib3J0UmVwbGljYXRpb24oJ3dyaXRlQ2hlY2twb2ludCBjb21wbGV0ZWQgd2l0aCBlcnJvcicsIGVycik7XG4gICAgICB0aHJvdyBlcnI7XG4gICAgfSk7XG4gIH1cblxuICBmdW5jdGlvbiBnZXREaWZmcygpIHtcbiAgICB2YXIgZGlmZiA9IHt9O1xuICAgIGN1cnJlbnRCYXRjaC5jaGFuZ2VzLmZvckVhY2goZnVuY3Rpb24gKGNoYW5nZSkge1xuICAgICAgLy8gQ291Y2hiYXNlIFN5bmMgR2F0ZXdheSBlbWl0cyB0aGVzZSwgYnV0IHdlIGNhbiBpZ25vcmUgdGhlbVxuICAgICAgaWYgKGNoYW5nZS5pZCA9PT0gXCJfdXNlci9cIikge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBkaWZmW2NoYW5nZS5pZF0gPSBjaGFuZ2UuY2hhbmdlcy5tYXAoZnVuY3Rpb24gKHgpIHtcbiAgICAgICAgcmV0dXJuIHgucmV2O1xuICAgICAgfSk7XG4gICAgfSk7XG4gICAgcmV0dXJuIHRhcmdldC5yZXZzRGlmZihkaWZmKS50aGVuKGZ1bmN0aW9uIChkaWZmcykge1xuICAgICAgaWYgKHN0YXRlLmNhbmNlbGxlZCkge1xuICAgICAgICBjb21wbGV0ZVJlcGxpY2F0aW9uKCk7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignY2FuY2VsbGVkJyk7XG4gICAgICB9XG4gICAgICAvLyBjdXJyZW50QmF0Y2guZGlmZnMgZWxlbWVudHMgYXJlIGRlbGV0ZWQgYXMgdGhlIGRvY3VtZW50cyBhcmUgd3JpdHRlblxuICAgICAgY3VycmVudEJhdGNoLmRpZmZzID0gZGlmZnM7XG4gICAgICBjdXJyZW50QmF0Y2gucGVuZGluZ1JldnMgPSAwO1xuICAgIH0pO1xuICB9XG5cbiAgZnVuY3Rpb24gc3RhcnROZXh0QmF0Y2goKSB7XG4gICAgaWYgKHN0YXRlLmNhbmNlbGxlZCB8fCBjdXJyZW50QmF0Y2gpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKGJhdGNoZXMubGVuZ3RoID09PSAwKSB7XG4gICAgICBwcm9jZXNzUGVuZGluZ0JhdGNoKHRydWUpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjdXJyZW50QmF0Y2ggPSBiYXRjaGVzLnNoaWZ0KCk7XG4gICAgZ2V0RGlmZnMoKVxuICAgICAgLnRoZW4oZ2V0RG9jcylcbiAgICAgIC50aGVuKHdyaXRlRG9jcylcbiAgICAgIC50aGVuKGZpbmlzaEJhdGNoKVxuICAgICAgLnRoZW4oc3RhcnROZXh0QmF0Y2gpW1xuICAgICAgXCJjYXRjaFwiXShmdW5jdGlvbiAoZXJyKSB7XG4gICAgICAgIGFib3J0UmVwbGljYXRpb24oJ2JhdGNoIHByb2Nlc3NpbmcgdGVybWluYXRlZCB3aXRoIGVycm9yJywgZXJyKTtcbiAgICAgIH0pO1xuICB9XG5cblxuICBmdW5jdGlvbiBwcm9jZXNzUGVuZGluZ0JhdGNoKGltbWVkaWF0ZSkge1xuICAgIGlmIChwZW5kaW5nQmF0Y2guY2hhbmdlcy5sZW5ndGggPT09IDApIHtcbiAgICAgIGlmIChiYXRjaGVzLmxlbmd0aCA9PT0gMCAmJiAhY3VycmVudEJhdGNoKSB7XG4gICAgICAgIGlmICgoY29udGludW91cyAmJiBjaGFuZ2VzT3B0cy5saXZlKSB8fCBjaGFuZ2VzQ29tcGxldGVkKSB7XG4gICAgICAgICAgcmV0dXJuVmFsdWUuc3RhdGUgPSAncGVuZGluZyc7XG4gICAgICAgICAgcmV0dXJuVmFsdWUuZW1pdCgncGF1c2VkJyk7XG4gICAgICAgICAgcmV0dXJuVmFsdWUuZW1pdCgndXB0b2RhdGUnLCByZXN1bHQpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjaGFuZ2VzQ29tcGxldGVkKSB7XG4gICAgICAgICAgY29tcGxldGVSZXBsaWNhdGlvbigpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmIChcbiAgICAgIGltbWVkaWF0ZSB8fFxuICAgICAgY2hhbmdlc0NvbXBsZXRlZCB8fFxuICAgICAgcGVuZGluZ0JhdGNoLmNoYW5nZXMubGVuZ3RoID49IGJhdGNoX3NpemVcbiAgICApIHtcbiAgICAgIGJhdGNoZXMucHVzaChwZW5kaW5nQmF0Y2gpO1xuICAgICAgcGVuZGluZ0JhdGNoID0ge1xuICAgICAgICBzZXE6IDAsXG4gICAgICAgIGNoYW5nZXM6IFtdLFxuICAgICAgICBkb2NzOiBbXVxuICAgICAgfTtcbiAgICAgIGlmIChyZXR1cm5WYWx1ZS5zdGF0ZSA9PT0gJ3BlbmRpbmcnIHx8IHJldHVyblZhbHVlLnN0YXRlID09PSAnc3RvcHBlZCcpIHtcbiAgICAgICAgcmV0dXJuVmFsdWUuc3RhdGUgPSAnYWN0aXZlJztcbiAgICAgICAgcmV0dXJuVmFsdWUuZW1pdCgnYWN0aXZlJyk7XG4gICAgICB9XG4gICAgICBzdGFydE5leHRCYXRjaCgpO1xuICAgIH1cbiAgfVxuXG5cbiAgZnVuY3Rpb24gYWJvcnRSZXBsaWNhdGlvbihyZWFzb24sIGVycikge1xuICAgIGlmIChyZXBsaWNhdGlvbkNvbXBsZXRlZCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoIWVyci5tZXNzYWdlKSB7XG4gICAgICBlcnIubWVzc2FnZSA9IHJlYXNvbjtcbiAgICB9XG4gICAgcmVzdWx0Lm9rID0gZmFsc2U7XG4gICAgcmVzdWx0LnN0YXR1cyA9ICdhYm9ydGluZyc7XG4gICAgcmVzdWx0LmVycm9ycy5wdXNoKGVycik7XG4gICAgYWxsRXJyb3JzID0gYWxsRXJyb3JzLmNvbmNhdChlcnIpO1xuICAgIGJhdGNoZXMgPSBbXTtcbiAgICBwZW5kaW5nQmF0Y2ggPSB7XG4gICAgICBzZXE6IDAsXG4gICAgICBjaGFuZ2VzOiBbXSxcbiAgICAgIGRvY3M6IFtdXG4gICAgfTtcbiAgICBjb21wbGV0ZVJlcGxpY2F0aW9uKCk7XG4gIH1cblxuXG4gIGZ1bmN0aW9uIGNvbXBsZXRlUmVwbGljYXRpb24oKSB7XG4gICAgaWYgKHJlcGxpY2F0aW9uQ29tcGxldGVkKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmIChzdGF0ZS5jYW5jZWxsZWQpIHtcbiAgICAgIHJlc3VsdC5zdGF0dXMgPSAnY2FuY2VsbGVkJztcbiAgICAgIGlmICh3cml0aW5nQ2hlY2twb2ludCkge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgfVxuICAgIHJlc3VsdC5zdGF0dXMgPSByZXN1bHQuc3RhdHVzIHx8ICdjb21wbGV0ZSc7XG4gICAgcmVzdWx0LmVuZF90aW1lID0gbmV3IERhdGUoKTtcbiAgICByZXN1bHQubGFzdF9zZXEgPSBsYXN0X3NlcTtcbiAgICByZXBsaWNhdGlvbkNvbXBsZXRlZCA9IHN0YXRlLmNhbmNlbGxlZCA9IHRydWU7XG4gICAgdmFyIG5vbjQwM3MgPSBhbGxFcnJvcnMuZmlsdGVyKGZ1bmN0aW9uIChlcnJvcikge1xuICAgICAgcmV0dXJuIGVycm9yLm5hbWUgIT09ICd1bmF1dGhvcml6ZWQnICYmIGVycm9yLm5hbWUgIT09ICdmb3JiaWRkZW4nO1xuICAgIH0pO1xuICAgIGlmIChub240MDNzLmxlbmd0aCA+IDApIHtcbiAgICAgIHZhciBlcnJvciA9IGFsbEVycm9ycy5wb3AoKTtcbiAgICAgIGlmIChhbGxFcnJvcnMubGVuZ3RoID4gMCkge1xuICAgICAgICBlcnJvci5vdGhlcl9lcnJvcnMgPSBhbGxFcnJvcnM7XG4gICAgICB9XG4gICAgICBlcnJvci5yZXN1bHQgPSByZXN1bHQ7XG4gICAgICBiYWNrT2ZmKHJlcElkLCBzcmMsIHRhcmdldCwgb3B0cywgcmV0dXJuVmFsdWUsIHJlc3VsdCwgZXJyb3IpO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXN1bHQuZXJyb3JzID0gYWxsRXJyb3JzO1xuICAgICAgcmV0dXJuVmFsdWUuZW1pdCgnY29tcGxldGUnLCByZXN1bHQpO1xuICAgICAgcmV0dXJuVmFsdWUucmVtb3ZlQWxsTGlzdGVuZXJzKCk7XG4gICAgfVxuICB9XG5cblxuICBmdW5jdGlvbiBvbkNoYW5nZShjaGFuZ2UpIHtcbiAgICBpZiAoc3RhdGUuY2FuY2VsbGVkKSB7XG4gICAgICByZXR1cm4gY29tcGxldGVSZXBsaWNhdGlvbigpO1xuICAgIH1cbiAgICB2YXIgZmlsdGVyID0gdXRpbHMuZmlsdGVyQ2hhbmdlKG9wdHMpKGNoYW5nZSk7XG4gICAgaWYgKCFmaWx0ZXIpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKFxuICAgICAgcGVuZGluZ0JhdGNoLmNoYW5nZXMubGVuZ3RoID09PSAwICYmXG4gICAgICBiYXRjaGVzLmxlbmd0aCA9PT0gMCAmJlxuICAgICAgIWN1cnJlbnRCYXRjaFxuICAgICkge1xuICAgICAgcmV0dXJuVmFsdWUuZW1pdCgnb3V0b2ZkYXRlJywgcmVzdWx0KTtcbiAgICB9XG4gICAgcGVuZGluZ0JhdGNoLnNlcSA9IGNoYW5nZS5zZXE7XG4gICAgcGVuZGluZ0JhdGNoLmNoYW5nZXMucHVzaChjaGFuZ2UpO1xuICAgIHByb2Nlc3NQZW5kaW5nQmF0Y2goYmF0Y2hlcy5sZW5ndGggPT09IDApO1xuICB9XG5cblxuICBmdW5jdGlvbiBvbkNoYW5nZXNDb21wbGV0ZShjaGFuZ2VzKSB7XG4gICAgY2hhbmdlc1BlbmRpbmcgPSBmYWxzZTtcbiAgICBpZiAoc3RhdGUuY2FuY2VsbGVkKSB7XG4gICAgICByZXR1cm4gY29tcGxldGVSZXBsaWNhdGlvbigpO1xuICAgIH1cblxuICAgIC8vIGlmIG5vIHJlc3VsdHMgd2VyZSByZXR1cm5lZCB0aGVuIHdlJ3JlIGRvbmUsXG4gICAgLy8gZWxzZSBmZXRjaCBtb3JlXG4gICAgaWYgKGNoYW5nZXMucmVzdWx0cy5sZW5ndGggPiAwKSB7XG4gICAgICBjaGFuZ2VzT3B0cy5zaW5jZSA9IGNoYW5nZXMubGFzdF9zZXE7XG4gICAgICBnZXRDaGFuZ2VzKCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmIChjb250aW51b3VzKSB7XG4gICAgICAgIGNoYW5nZXNPcHRzLmxpdmUgPSB0cnVlO1xuICAgICAgICBnZXRDaGFuZ2VzKCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjaGFuZ2VzQ29tcGxldGVkID0gdHJ1ZTtcbiAgICAgIH1cbiAgICB9XG4gICAgcHJvY2Vzc1BlbmRpbmdCYXRjaCh0cnVlKTtcbiAgfVxuXG5cbiAgZnVuY3Rpb24gb25DaGFuZ2VzRXJyb3IoZXJyKSB7XG4gICAgY2hhbmdlc1BlbmRpbmcgPSBmYWxzZTtcbiAgICBpZiAoc3RhdGUuY2FuY2VsbGVkKSB7XG4gICAgICByZXR1cm4gY29tcGxldGVSZXBsaWNhdGlvbigpO1xuICAgIH1cbiAgICBhYm9ydFJlcGxpY2F0aW9uKCdjaGFuZ2VzIHJlamVjdGVkJywgZXJyKTtcbiAgfVxuXG5cbiAgZnVuY3Rpb24gZ2V0Q2hhbmdlcygpIHtcbiAgICBpZiAoIShcbiAgICAgICFjaGFuZ2VzUGVuZGluZyAmJlxuICAgICAgIWNoYW5nZXNDb21wbGV0ZWQgJiZcbiAgICAgIGJhdGNoZXMubGVuZ3RoIDwgYmF0Y2hlc19saW1pdFxuICAgICkpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY2hhbmdlc1BlbmRpbmcgPSB0cnVlO1xuICAgIGZ1bmN0aW9uIGFib3J0Q2hhbmdlcygpIHtcbiAgICAgIGNoYW5nZXMuY2FuY2VsKCk7XG4gICAgfVxuICAgIGZ1bmN0aW9uIHJlbW92ZUxpc3RlbmVyKCkge1xuICAgICAgcmV0dXJuVmFsdWUucmVtb3ZlTGlzdGVuZXIoJ2NhbmNlbCcsIGFib3J0Q2hhbmdlcyk7XG4gICAgfVxuICAgIHJldHVyblZhbHVlLm9uY2UoJ2NhbmNlbCcsIGFib3J0Q2hhbmdlcyk7XG4gICAgdmFyIGNoYW5nZXMgPSBzcmMuY2hhbmdlcyhjaGFuZ2VzT3B0cylcbiAgICAub24oJ2NoYW5nZScsIG9uQ2hhbmdlKTtcbiAgICBjaGFuZ2VzLnRoZW4ocmVtb3ZlTGlzdGVuZXIsIHJlbW92ZUxpc3RlbmVyKTtcbiAgICBjaGFuZ2VzLnRoZW4ob25DaGFuZ2VzQ29tcGxldGUpW1xuICAgIFwiY2F0Y2hcIl0ob25DaGFuZ2VzRXJyb3IpO1xuICB9XG5cblxuICBmdW5jdGlvbiBzdGFydENoYW5nZXMoKSB7XG4gICAgY2hlY2twb2ludGVyLmdldENoZWNrcG9pbnQoKS50aGVuKGZ1bmN0aW9uIChjaGVja3BvaW50KSB7XG4gICAgICBsYXN0X3NlcSA9IGNoZWNrcG9pbnQ7XG4gICAgICBjaGFuZ2VzT3B0cyA9IHtcbiAgICAgICAgc2luY2U6IGxhc3Rfc2VxLFxuICAgICAgICBsaW1pdDogYmF0Y2hfc2l6ZSxcbiAgICAgICAgYmF0Y2hfc2l6ZTogYmF0Y2hfc2l6ZSxcbiAgICAgICAgc3R5bGU6ICdhbGxfZG9jcycsXG4gICAgICAgIGRvY19pZHM6IGRvY19pZHMsXG4gICAgICAgIHJldHVybkRvY3M6IHRydWUgLy8gcmVxdWlyZWQgc28gd2Uga25vdyB3aGVuIHdlJ3JlIGRvbmVcbiAgICAgIH07XG4gICAgICBpZiAob3B0cy5maWx0ZXIpIHtcbiAgICAgICAgaWYgKHR5cGVvZiBvcHRzLmZpbHRlciAhPT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAvLyByZXF1aXJlZCBmb3IgdGhlIGNsaWVudC1zaWRlIGZpbHRlciBpbiBvbkNoYW5nZVxuICAgICAgICAgIGNoYW5nZXNPcHRzLmluY2x1ZGVfZG9jcyA9IHRydWU7XG4gICAgICAgIH0gZWxzZSB7IC8vIGRkb2MgZmlsdGVyXG4gICAgICAgICAgY2hhbmdlc09wdHMuZmlsdGVyID0gb3B0cy5maWx0ZXI7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmIChvcHRzLnF1ZXJ5X3BhcmFtcykge1xuICAgICAgICBjaGFuZ2VzT3B0cy5xdWVyeV9wYXJhbXMgPSBvcHRzLnF1ZXJ5X3BhcmFtcztcbiAgICAgIH1cbiAgICAgIGlmIChvcHRzLnZpZXcpIHtcbiAgICAgICAgY2hhbmdlc09wdHMudmlldyA9IG9wdHMudmlldztcbiAgICAgIH1cbiAgICAgIGdldENoYW5nZXMoKTtcbiAgICB9KVtcImNhdGNoXCJdKGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgIGFib3J0UmVwbGljYXRpb24oJ2dldENoZWNrcG9pbnQgcmVqZWN0ZWQgd2l0aCAnLCBlcnIpO1xuICAgIH0pO1xuICB9XG5cbiAgaWYgKHJldHVyblZhbHVlLmNhbmNlbGxlZCkgeyAvLyBjYW5jZWxsZWQgaW1tZWRpYXRlbHlcbiAgICBjb21wbGV0ZVJlcGxpY2F0aW9uKCk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgcmV0dXJuVmFsdWUub25jZSgnY2FuY2VsJywgY29tcGxldGVSZXBsaWNhdGlvbik7XG5cbiAgaWYgKHR5cGVvZiBvcHRzLm9uQ2hhbmdlID09PSAnZnVuY3Rpb24nKSB7XG4gICAgcmV0dXJuVmFsdWUub24oJ2NoYW5nZScsIG9wdHMub25DaGFuZ2UpO1xuICB9XG5cbiAgaWYgKHR5cGVvZiBvcHRzLmNvbXBsZXRlID09PSAnZnVuY3Rpb24nKSB7XG4gICAgcmV0dXJuVmFsdWUub25jZSgnZXJyb3InLCBvcHRzLmNvbXBsZXRlKTtcbiAgICByZXR1cm5WYWx1ZS5vbmNlKCdjb21wbGV0ZScsIGZ1bmN0aW9uIChyZXN1bHQpIHtcbiAgICAgIG9wdHMuY29tcGxldGUobnVsbCwgcmVzdWx0KTtcbiAgICB9KTtcbiAgfVxuXG4gIGlmICh0eXBlb2Ygb3B0cy5zaW5jZSA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBzdGFydENoYW5nZXMoKTtcbiAgfSBlbHNlIHtcbiAgICB3cml0aW5nQ2hlY2twb2ludCA9IHRydWU7XG4gICAgY2hlY2twb2ludGVyLndyaXRlQ2hlY2twb2ludChvcHRzLnNpbmNlKS50aGVuKGZ1bmN0aW9uICgpIHtcbiAgICAgIHdyaXRpbmdDaGVja3BvaW50ID0gZmFsc2U7XG4gICAgICBpZiAoc3RhdGUuY2FuY2VsbGVkKSB7XG4gICAgICAgIGNvbXBsZXRlUmVwbGljYXRpb24oKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgbGFzdF9zZXEgPSBvcHRzLnNpbmNlO1xuICAgICAgc3RhcnRDaGFuZ2VzKCk7XG4gICAgfSlbXCJjYXRjaFwiXShmdW5jdGlvbiAoZXJyKSB7XG4gICAgICB3cml0aW5nQ2hlY2twb2ludCA9IGZhbHNlO1xuICAgICAgYWJvcnRSZXBsaWNhdGlvbignd3JpdGVDaGVja3BvaW50IGNvbXBsZXRlZCB3aXRoIGVycm9yJywgZXJyKTtcbiAgICAgIHRocm93IGVycjtcbiAgICB9KTtcbiAgfVxufVxuXG5leHBvcnRzLnRvUG91Y2ggPSB0b1BvdWNoO1xuZnVuY3Rpb24gdG9Qb3VjaChkYiwgb3B0cykge1xuICB2YXIgUG91Y2hDb25zdHJ1Y3RvciA9IG9wdHMuUG91Y2hDb25zdHJ1Y3RvcjtcbiAgaWYgKHR5cGVvZiBkYiA9PT0gJ3N0cmluZycpIHtcbiAgICByZXR1cm4gbmV3IFBvdWNoQ29uc3RydWN0b3IoZGIsIG9wdHMpO1xuICB9IGVsc2UgaWYgKGRiLnRoZW4pIHtcbiAgICByZXR1cm4gZGI7XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIHV0aWxzLlByb21pc2UucmVzb2x2ZShkYik7XG4gIH1cbn1cblxuXG5leHBvcnRzLnJlcGxpY2F0ZSA9IHJlcGxpY2F0ZVdyYXBwZXI7XG5mdW5jdGlvbiByZXBsaWNhdGVXcmFwcGVyKHNyYywgdGFyZ2V0LCBvcHRzLCBjYWxsYmFjaykge1xuICBpZiAodHlwZW9mIG9wdHMgPT09ICdmdW5jdGlvbicpIHtcbiAgICBjYWxsYmFjayA9IG9wdHM7XG4gICAgb3B0cyA9IHt9O1xuICB9XG4gIGlmICh0eXBlb2Ygb3B0cyA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBvcHRzID0ge307XG4gIH1cbiAgaWYgKCFvcHRzLmNvbXBsZXRlKSB7XG4gICAgb3B0cy5jb21wbGV0ZSA9IGNhbGxiYWNrIHx8IGZ1bmN0aW9uICgpIHt9O1xuICB9XG4gIG9wdHMgPSB1dGlscy5jbG9uZShvcHRzKTtcbiAgb3B0cy5jb250aW51b3VzID0gb3B0cy5jb250aW51b3VzIHx8IG9wdHMubGl2ZTtcbiAgb3B0cy5yZXRyeSA9ICgncmV0cnknIGluIG9wdHMpID8gb3B0cy5yZXRyeSA6IFJFVFJZX0RFRkFVTFQ7XG4gIC8qanNoaW50IHZhbGlkdGhpczp0cnVlICovXG4gIG9wdHMuUG91Y2hDb25zdHJ1Y3RvciA9IG9wdHMuUG91Y2hDb25zdHJ1Y3RvciB8fCB0aGlzO1xuICB2YXIgcmVwbGljYXRlUmV0ID0gbmV3IFJlcGxpY2F0aW9uKG9wdHMpO1xuICB0b1BvdWNoKHNyYywgb3B0cykudGhlbihmdW5jdGlvbiAoc3JjKSB7XG4gICAgcmV0dXJuIHRvUG91Y2godGFyZ2V0LCBvcHRzKS50aGVuKGZ1bmN0aW9uICh0YXJnZXQpIHtcbiAgICAgIHJldHVybiBnZW5SZXBsaWNhdGlvbklkKHNyYywgdGFyZ2V0LCBvcHRzKS50aGVuKGZ1bmN0aW9uIChyZXBJZCkge1xuICAgICAgICByZXBsaWNhdGUocmVwSWQsIHNyYywgdGFyZ2V0LCBvcHRzLCByZXBsaWNhdGVSZXQpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH0pW1wiY2F0Y2hcIl0oZnVuY3Rpb24gKGVycikge1xuICAgIHJlcGxpY2F0ZVJldC5lbWl0KCdlcnJvcicsIGVycik7XG4gICAgb3B0cy5jb21wbGV0ZShlcnIpO1xuICB9KTtcbiAgcmV0dXJuIHJlcGxpY2F0ZVJldDtcbn1cbiIsIlwidXNlIHN0cmljdFwiO1xuXG52YXIgUG91Y2hEQiA9IHJlcXVpcmUoXCIuL2NvbnN0cnVjdG9yXCIpO1xudmFyIHV0aWxzID0gcmVxdWlyZSgnLi91dGlscycpO1xudmFyIFByb21pc2UgPSB1dGlscy5Qcm9taXNlO1xudmFyIEV2ZW50RW1pdHRlciA9IHJlcXVpcmUoJ2V2ZW50cycpLkV2ZW50RW1pdHRlcjtcblBvdWNoREIuYWRhcHRlcnMgPSB7fTtcblBvdWNoREIucHJlZmVycmVkQWRhcHRlcnMgPSByZXF1aXJlKCcuL2FkYXB0ZXJzL3ByZWZlcnJlZEFkYXB0ZXJzLmpzJyk7XG5cblBvdWNoREIucHJlZml4ID0gJ19wb3VjaF8nO1xuXG52YXIgZXZlbnRFbWl0dGVyID0gbmV3IEV2ZW50RW1pdHRlcigpO1xuXG52YXIgZXZlbnRFbWl0dGVyTWV0aG9kcyA9IFtcbiAgJ29uJyxcbiAgJ2FkZExpc3RlbmVyJyxcbiAgJ2VtaXQnLFxuICAnbGlzdGVuZXJzJyxcbiAgJ29uY2UnLFxuICAncmVtb3ZlQWxsTGlzdGVuZXJzJyxcbiAgJ3JlbW92ZUxpc3RlbmVyJyxcbiAgJ3NldE1heExpc3RlbmVycydcbl07XG5cbmV2ZW50RW1pdHRlck1ldGhvZHMuZm9yRWFjaChmdW5jdGlvbiAobWV0aG9kKSB7XG4gIFBvdWNoREJbbWV0aG9kXSA9IGV2ZW50RW1pdHRlclttZXRob2RdLmJpbmQoZXZlbnRFbWl0dGVyKTtcbn0pO1xuUG91Y2hEQi5zZXRNYXhMaXN0ZW5lcnMoMCk7XG5Qb3VjaERCLnBhcnNlQWRhcHRlciA9IGZ1bmN0aW9uIChuYW1lLCBvcHRzKSB7XG4gIHZhciBtYXRjaCA9IG5hbWUubWF0Y2goLyhbYS16XFwtXSopOlxcL1xcLyguKikvKTtcbiAgdmFyIGFkYXB0ZXIsIGFkYXB0ZXJOYW1lO1xuICBpZiAobWF0Y2gpIHtcbiAgICAvLyB0aGUgaHR0cCBhZGFwdGVyIGV4cGVjdHMgdGhlIGZ1bGx5IHF1YWxpZmllZCBuYW1lXG4gICAgbmFtZSA9IC9odHRwKHM/KS8udGVzdChtYXRjaFsxXSkgPyBtYXRjaFsxXSArICc6Ly8nICsgbWF0Y2hbMl0gOiBtYXRjaFsyXTtcbiAgICBhZGFwdGVyID0gbWF0Y2hbMV07XG4gICAgaWYgKCFQb3VjaERCLmFkYXB0ZXJzW2FkYXB0ZXJdLnZhbGlkKCkpIHtcbiAgICAgIHRocm93ICdJbnZhbGlkIGFkYXB0ZXInO1xuICAgIH1cbiAgICByZXR1cm4ge25hbWU6IG5hbWUsIGFkYXB0ZXI6IG1hdGNoWzFdfTtcbiAgfVxuXG4gIC8vIGNoZWNrIGZvciBicm93c2VycyB0aGF0IGhhdmUgYmVlbiB1cGdyYWRlZCBmcm9tIHdlYnNxbC1vbmx5IHRvIHdlYnNxbCtpZGJcbiAgdmFyIHNraXBJZGIgPSAnaWRiJyBpbiBQb3VjaERCLmFkYXB0ZXJzICYmICd3ZWJzcWwnIGluIFBvdWNoREIuYWRhcHRlcnMgJiZcbiAgICB1dGlscy5oYXNMb2NhbFN0b3JhZ2UoKSAmJlxuICAgIGxvY2FsU3RvcmFnZVsnX3BvdWNoX193ZWJzcWxkYl8nICsgUG91Y2hEQi5wcmVmaXggKyBuYW1lXTtcblxuICBpZiAodHlwZW9mIG9wdHMgIT09ICd1bmRlZmluZWQnICYmIG9wdHMuZGIpIHtcbiAgICBhZGFwdGVyTmFtZSA9ICdsZXZlbGRiJztcbiAgfSBlbHNlIHtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IFBvdWNoREIucHJlZmVycmVkQWRhcHRlcnMubGVuZ3RoOyArK2kpIHtcbiAgICAgIGFkYXB0ZXJOYW1lID0gUG91Y2hEQi5wcmVmZXJyZWRBZGFwdGVyc1tpXTtcbiAgICAgIGlmIChhZGFwdGVyTmFtZSBpbiBQb3VjaERCLmFkYXB0ZXJzKSB7XG4gICAgICAgIGlmIChza2lwSWRiICYmIGFkYXB0ZXJOYW1lID09PSAnaWRiJykge1xuICAgICAgICAgIGNvbnRpbnVlOyAvLyBrZWVwIHVzaW5nIHdlYnNxbCB0byBhdm9pZCB1c2VyIGRhdGEgbG9zc1xuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGFkYXB0ZXIgPSBQb3VjaERCLmFkYXB0ZXJzW2FkYXB0ZXJOYW1lXTtcbiAgaWYgKGFkYXB0ZXJOYW1lICYmIGFkYXB0ZXIpIHtcbiAgICB2YXIgdXNlX3ByZWZpeCA9ICd1c2VfcHJlZml4JyBpbiBhZGFwdGVyID8gYWRhcHRlci51c2VfcHJlZml4IDogdHJ1ZTtcblxuICAgIHJldHVybiB7XG4gICAgICBuYW1lOiB1c2VfcHJlZml4ID8gUG91Y2hEQi5wcmVmaXggKyBuYW1lIDogbmFtZSxcbiAgICAgIGFkYXB0ZXI6IGFkYXB0ZXJOYW1lXG4gICAgfTtcbiAgfVxuXG4gIHRocm93ICdObyB2YWxpZCBhZGFwdGVyIGZvdW5kJztcbn07XG5cblBvdWNoREIuZGVzdHJveSA9IHV0aWxzLnRvUHJvbWlzZShmdW5jdGlvbiAobmFtZSwgb3B0cywgY2FsbGJhY2spIHtcblxuICBpZiAodHlwZW9mIG9wdHMgPT09ICdmdW5jdGlvbicgfHwgdHlwZW9mIG9wdHMgPT09ICd1bmRlZmluZWQnKSB7XG4gICAgY2FsbGJhY2sgPSBvcHRzO1xuICAgIG9wdHMgPSB7fTtcbiAgfVxuICBpZiAobmFtZSAmJiB0eXBlb2YgbmFtZSA9PT0gJ29iamVjdCcpIHtcbiAgICBvcHRzID0gbmFtZTtcbiAgICBuYW1lID0gdW5kZWZpbmVkO1xuICB9XG5cbiAgaWYgKCFvcHRzLmludGVybmFsKSB7XG4gICAgY29uc29sZS5sb2coJ1BvdWNoREIuZGVzdHJveSgpIGlzIGRlcHJlY2F0ZWQgYW5kIHdpbGwgYmUgcmVtb3ZlZC4gJyArXG4gICAgICAgICAgICAgICAgJ1BsZWFzZSB1c2UgZGIuZGVzdHJveSgpIGluc3RlYWQuJyk7XG4gIH1cblxuICB2YXIgYmFja2VuZCA9IFBvdWNoREIucGFyc2VBZGFwdGVyKG9wdHMubmFtZSB8fCBuYW1lLCBvcHRzKTtcbiAgdmFyIGRiTmFtZSA9IGJhY2tlbmQubmFtZTtcbiAgdmFyIGFkYXB0ZXIgPSBQb3VjaERCLmFkYXB0ZXJzW2JhY2tlbmQuYWRhcHRlcl07XG4gIHZhciB1c2VQcmVmaXggPSAndXNlX3ByZWZpeCcgaW4gYWRhcHRlciA/IGFkYXB0ZXIudXNlX3ByZWZpeCA6IHRydWU7XG4gIHZhciBiYXNlTmFtZSA9IHVzZVByZWZpeCA/XG4gICAgZGJOYW1lLnJlcGxhY2UobmV3IFJlZ0V4cCgnXicgKyBQb3VjaERCLnByZWZpeCksICcnKSA6IGRiTmFtZTtcbiAgdmFyIGZ1bGxOYW1lID0gKGJhY2tlbmQuYWRhcHRlciA9PT0gJ2h0dHAnIHx8IGJhY2tlbmQuYWRhcHRlciA9PT0gJ2h0dHBzJyA/XG4gICAgICAnJyA6IChvcHRzLnByZWZpeCB8fCAnJykpICsgZGJOYW1lO1xuICBmdW5jdGlvbiBkZXN0cm95RGIoKSB7XG4gICAgLy8gY2FsbCBkZXN0cm95IG1ldGhvZCBvZiB0aGUgcGFydGljdWxhciBhZGFwdG9yXG4gICAgYWRhcHRlci5kZXN0cm95KGZ1bGxOYW1lLCBvcHRzLCBmdW5jdGlvbiAoZXJyLCByZXNwKSB7XG4gICAgICBpZiAoZXJyKSB7XG4gICAgICAgIGNhbGxiYWNrKGVycik7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBQb3VjaERCLmVtaXQoJ2Rlc3Ryb3llZCcsIG5hbWUpO1xuICAgICAgICAvL3NvIHdlIGRvbid0IGhhdmUgdG8gc2lmdCB0aHJvdWdoIGFsbCBkYm5hbWVzXG4gICAgICAgIFBvdWNoREIuZW1pdChuYW1lLCAnZGVzdHJveWVkJyk7XG4gICAgICAgIGNhbGxiYWNrKG51bGwsIHJlc3AgfHwgeyAnb2snOiB0cnVlIH0pO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgdmFyIGNyZWF0ZU9wdHMgPSB1dGlscy5leHRlbmQodHJ1ZSwge30sIG9wdHMsIHthZGFwdGVyIDogYmFja2VuZC5hZGFwdGVyfSk7XG4gIG5ldyBQb3VjaERCKGJhc2VOYW1lLCBjcmVhdGVPcHRzLCBmdW5jdGlvbiAoZXJyLCBkYikge1xuICAgIGlmIChlcnIpIHtcbiAgICAgIHJldHVybiBjYWxsYmFjayhlcnIpO1xuICAgIH1cbiAgICBkYi5nZXQoJ19sb2NhbC9fcG91Y2hfZGVwZW5kZW50RGJzJywgZnVuY3Rpb24gKGVyciwgbG9jYWxEb2MpIHtcbiAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgaWYgKGVyci5zdGF0dXMgIT09IDQwNCkge1xuICAgICAgICAgIHJldHVybiBjYWxsYmFjayhlcnIpO1xuICAgICAgICB9IGVsc2UgeyAvLyBubyBkZXBlbmRlbmNpZXNcbiAgICAgICAgICByZXR1cm4gZGVzdHJveURiKCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHZhciBkZXBlbmRlbnREYnMgPSBsb2NhbERvYy5kZXBlbmRlbnREYnM7XG4gICAgICB2YXIgZGVsZXRlZE1hcCA9IE9iamVjdC5rZXlzKGRlcGVuZGVudERicykubWFwKGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgIHZhciB0cnVlTmFtZSA9IHVzZVByZWZpeCA/XG4gICAgICAgICAgbmFtZS5yZXBsYWNlKG5ldyBSZWdFeHAoJ14nICsgUG91Y2hEQi5wcmVmaXgpLCAnJykgOiBuYW1lO1xuICAgICAgICB2YXIgc3ViT3B0cyA9IHV0aWxzLmV4dGVuZCh0cnVlLCBvcHRzLCBkYi5fX29wdHMgfHwge30pO1xuICAgICAgICByZXR1cm4gZGIuY29uc3RydWN0b3IuZGVzdHJveSh0cnVlTmFtZSwgc3ViT3B0cyk7XG4gICAgICB9KTtcbiAgICAgIFByb21pc2UuYWxsKGRlbGV0ZWRNYXApLnRoZW4oZGVzdHJveURiLCBmdW5jdGlvbiAoZXJyb3IpIHtcbiAgICAgICAgY2FsbGJhY2soZXJyb3IpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH0pO1xufSk7XG5cblBvdWNoREIuYWRhcHRlciA9IGZ1bmN0aW9uIChpZCwgb2JqKSB7XG4gIGlmIChvYmoudmFsaWQoKSkge1xuICAgIFBvdWNoREIuYWRhcHRlcnNbaWRdID0gb2JqO1xuICB9XG59O1xuXG5Qb3VjaERCLnBsdWdpbiA9IGZ1bmN0aW9uIChvYmopIHtcbiAgT2JqZWN0LmtleXMob2JqKS5mb3JFYWNoKGZ1bmN0aW9uIChpZCkge1xuICAgIFBvdWNoREIucHJvdG90eXBlW2lkXSA9IG9ialtpZF07XG4gIH0pO1xufTtcblxuUG91Y2hEQi5kZWZhdWx0cyA9IGZ1bmN0aW9uIChkZWZhdWx0T3B0cykge1xuICBmdW5jdGlvbiBQb3VjaEFsdChuYW1lLCBvcHRzLCBjYWxsYmFjaykge1xuICAgIGlmICh0eXBlb2Ygb3B0cyA9PT0gJ2Z1bmN0aW9uJyB8fCB0eXBlb2Ygb3B0cyA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgIGNhbGxiYWNrID0gb3B0cztcbiAgICAgIG9wdHMgPSB7fTtcbiAgICB9XG4gICAgaWYgKG5hbWUgJiYgdHlwZW9mIG5hbWUgPT09ICdvYmplY3QnKSB7XG4gICAgICBvcHRzID0gbmFtZTtcbiAgICAgIG5hbWUgPSB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgb3B0cyA9IHV0aWxzLmV4dGVuZCh0cnVlLCB7fSwgZGVmYXVsdE9wdHMsIG9wdHMpO1xuICAgIFBvdWNoREIuY2FsbCh0aGlzLCBuYW1lLCBvcHRzLCBjYWxsYmFjayk7XG4gIH1cblxuICB1dGlscy5pbmhlcml0cyhQb3VjaEFsdCwgUG91Y2hEQik7XG5cbiAgUG91Y2hBbHQuZGVzdHJveSA9IHV0aWxzLnRvUHJvbWlzZShmdW5jdGlvbiAobmFtZSwgb3B0cywgY2FsbGJhY2spIHtcbiAgICBpZiAodHlwZW9mIG9wdHMgPT09ICdmdW5jdGlvbicgfHwgdHlwZW9mIG9wdHMgPT09ICd1bmRlZmluZWQnKSB7XG4gICAgICBjYWxsYmFjayA9IG9wdHM7XG4gICAgICBvcHRzID0ge307XG4gICAgfVxuXG4gICAgaWYgKG5hbWUgJiYgdHlwZW9mIG5hbWUgPT09ICdvYmplY3QnKSB7XG4gICAgICBvcHRzID0gbmFtZTtcbiAgICAgIG5hbWUgPSB1bmRlZmluZWQ7XG4gICAgfVxuICAgIG9wdHMgPSB1dGlscy5leHRlbmQodHJ1ZSwge30sIGRlZmF1bHRPcHRzLCBvcHRzKTtcbiAgICByZXR1cm4gUG91Y2hEQi5kZXN0cm95KG5hbWUsIG9wdHMsIGNhbGxiYWNrKTtcbiAgfSk7XG5cbiAgZXZlbnRFbWl0dGVyTWV0aG9kcy5mb3JFYWNoKGZ1bmN0aW9uIChtZXRob2QpIHtcbiAgICBQb3VjaEFsdFttZXRob2RdID0gZXZlbnRFbWl0dGVyW21ldGhvZF0uYmluZChldmVudEVtaXR0ZXIpO1xuICB9KTtcbiAgUG91Y2hBbHQuc2V0TWF4TGlzdGVuZXJzKDApO1xuXG4gIFBvdWNoQWx0LnByZWZlcnJlZEFkYXB0ZXJzID0gUG91Y2hEQi5wcmVmZXJyZWRBZGFwdGVycy5zbGljZSgpO1xuICBPYmplY3Qua2V5cyhQb3VjaERCKS5mb3JFYWNoKGZ1bmN0aW9uIChrZXkpIHtcbiAgICBpZiAoIShrZXkgaW4gUG91Y2hBbHQpKSB7XG4gICAgICBQb3VjaEFsdFtrZXldID0gUG91Y2hEQltrZXldO1xuICAgIH1cbiAgfSk7XG5cbiAgcmV0dXJuIFBvdWNoQWx0O1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBQb3VjaERCO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzJyk7XG52YXIgcmVwbGljYXRpb24gPSByZXF1aXJlKCcuL3JlcGxpY2F0ZScpO1xudmFyIHJlcGxpY2F0ZSA9IHJlcGxpY2F0aW9uLnJlcGxpY2F0ZTtcbnZhciBFRSA9IHJlcXVpcmUoJ2V2ZW50cycpLkV2ZW50RW1pdHRlcjtcblxudXRpbHMuaW5oZXJpdHMoU3luYywgRUUpO1xubW9kdWxlLmV4cG9ydHMgPSBzeW5jO1xuZnVuY3Rpb24gc3luYyhzcmMsIHRhcmdldCwgb3B0cywgY2FsbGJhY2spIHtcbiAgaWYgKHR5cGVvZiBvcHRzID09PSAnZnVuY3Rpb24nKSB7XG4gICAgY2FsbGJhY2sgPSBvcHRzO1xuICAgIG9wdHMgPSB7fTtcbiAgfVxuICBpZiAodHlwZW9mIG9wdHMgPT09ICd1bmRlZmluZWQnKSB7XG4gICAgb3B0cyA9IHt9O1xuICB9XG4gIG9wdHMgPSB1dGlscy5jbG9uZShvcHRzKTtcbiAgLypqc2hpbnQgdmFsaWR0aGlzOnRydWUgKi9cbiAgb3B0cy5Qb3VjaENvbnN0cnVjdG9yID0gb3B0cy5Qb3VjaENvbnN0cnVjdG9yIHx8IHRoaXM7XG4gIHNyYyA9IHJlcGxpY2F0aW9uLnRvUG91Y2goc3JjLCBvcHRzKTtcbiAgdGFyZ2V0ID0gcmVwbGljYXRpb24udG9Qb3VjaCh0YXJnZXQsIG9wdHMpO1xuICByZXR1cm4gbmV3IFN5bmMoc3JjLCB0YXJnZXQsIG9wdHMsIGNhbGxiYWNrKTtcbn1cblxuZnVuY3Rpb24gU3luYyhzcmMsIHRhcmdldCwgb3B0cywgY2FsbGJhY2spIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICB0aGlzLmNhbmNlbGVkID0gZmFsc2U7XG5cbiAgdmFyIG9uQ2hhbmdlLCBjb21wbGV0ZTtcbiAgaWYgKCdvbkNoYW5nZScgaW4gb3B0cykge1xuICAgIG9uQ2hhbmdlID0gb3B0cy5vbkNoYW5nZTtcbiAgICBkZWxldGUgb3B0cy5vbkNoYW5nZTtcbiAgfVxuICBpZiAodHlwZW9mIGNhbGxiYWNrID09PSAnZnVuY3Rpb24nICYmICFvcHRzLmNvbXBsZXRlKSB7XG4gICAgY29tcGxldGUgPSBjYWxsYmFjaztcbiAgfSBlbHNlIGlmICgnY29tcGxldGUnIGluIG9wdHMpIHtcbiAgICBjb21wbGV0ZSA9IG9wdHMuY29tcGxldGU7XG4gICAgZGVsZXRlIG9wdHMuY29tcGxldGU7XG4gIH1cblxuICB0aGlzLnB1c2ggPSByZXBsaWNhdGUoc3JjLCB0YXJnZXQsIG9wdHMpO1xuICB0aGlzLnB1bGwgPSByZXBsaWNhdGUodGFyZ2V0LCBzcmMsIG9wdHMpO1xuXG4gIHZhciBlbWl0dGVkQ2FuY2VsID0gZmFsc2U7XG4gIGZ1bmN0aW9uIG9uQ2FuY2VsKGRhdGEpIHtcbiAgICBpZiAoIWVtaXR0ZWRDYW5jZWwpIHtcbiAgICAgIGVtaXR0ZWRDYW5jZWwgPSB0cnVlO1xuICAgICAgc2VsZi5lbWl0KCdjYW5jZWwnLCBkYXRhKTtcbiAgICB9XG4gIH1cbiAgZnVuY3Rpb24gcHVsbENoYW5nZShjaGFuZ2UpIHtcbiAgICBzZWxmLmVtaXQoJ2NoYW5nZScsIHtcbiAgICAgIGRpcmVjdGlvbjogJ3B1bGwnLFxuICAgICAgY2hhbmdlOiBjaGFuZ2VcbiAgICB9KTtcbiAgfVxuICBmdW5jdGlvbiBwdXNoQ2hhbmdlKGNoYW5nZSkge1xuICAgIHNlbGYuZW1pdCgnY2hhbmdlJywge1xuICAgICAgZGlyZWN0aW9uOiAncHVzaCcsXG4gICAgICBjaGFuZ2U6IGNoYW5nZVxuICAgIH0pO1xuICB9XG4gIGZ1bmN0aW9uIHB1c2hEZW5pZWQoZG9jKSB7XG4gICAgc2VsZi5lbWl0KCdkZW5pZWQnLCB7XG4gICAgICBkaXJlY3Rpb246ICdwdXNoJyxcbiAgICAgIGRvYzogZG9jXG4gICAgfSk7XG4gIH1cbiAgZnVuY3Rpb24gcHVsbERlbmllZChkb2MpIHtcbiAgICBzZWxmLmVtaXQoJ2RlbmllZCcsIHtcbiAgICAgIGRpcmVjdGlvbjogJ3B1bGwnLFxuICAgICAgZG9jOiBkb2NcbiAgICB9KTtcbiAgfVxuXG4gIHZhciBsaXN0ZW5lcnMgPSB7fTtcbiAgdmFyIHJlbW92ZWQgPSB7fTtcblxuICBmdW5jdGlvbiByZW1vdmVBbGwodHlwZSkgeyAvLyB0eXBlIGlzICdwdXNoJyBvciAncHVsbCdcbiAgICByZXR1cm4gZnVuY3Rpb24gKGV2ZW50LCBmdW5jKSB7XG4gICAgICB2YXIgaXNDaGFuZ2UgPSBldmVudCA9PT0gJ2NoYW5nZScgJiZcbiAgICAgICAgKGZ1bmMgPT09IHB1bGxDaGFuZ2UgfHwgZnVuYyA9PT0gcHVzaENoYW5nZSk7XG4gICAgICB2YXIgaXNDYW5jZWwgPSBldmVudCA9PT0gJ2NhbmNlbCcgJiYgZnVuYyA9PT0gb25DYW5jZWw7XG4gICAgICB2YXIgaXNPdGhlckV2ZW50ID0gZXZlbnQgaW4gbGlzdGVuZXJzICYmIGZ1bmMgPT09IGxpc3RlbmVyc1tldmVudF07XG5cbiAgICAgIGlmIChpc0NoYW5nZSB8fCBpc0NhbmNlbCB8fCBpc090aGVyRXZlbnQpIHtcbiAgICAgICAgaWYgKCEoZXZlbnQgaW4gcmVtb3ZlZCkpIHtcbiAgICAgICAgICByZW1vdmVkW2V2ZW50XSA9IHt9O1xuICAgICAgICB9XG4gICAgICAgIHJlbW92ZWRbZXZlbnRdW3R5cGVdID0gdHJ1ZTtcbiAgICAgICAgaWYgKE9iamVjdC5rZXlzKHJlbW92ZWRbZXZlbnRdKS5sZW5ndGggPT09IDIpIHtcbiAgICAgICAgICAvLyBib3RoIHB1c2ggYW5kIHB1bGwgaGF2ZSBhc2tlZCB0byBiZSByZW1vdmVkXG4gICAgICAgICAgc2VsZi5yZW1vdmVBbGxMaXN0ZW5lcnMoZXZlbnQpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfTtcbiAgfVxuXG4gIGlmIChvcHRzLmxpdmUpIHtcbiAgICB0aGlzLnB1c2gub24oJ2NvbXBsZXRlJywgc2VsZi5wdWxsLmNhbmNlbC5iaW5kKHNlbGYucHVsbCkpO1xuICAgIHRoaXMucHVsbC5vbignY29tcGxldGUnLCBzZWxmLnB1c2guY2FuY2VsLmJpbmQoc2VsZi5wdXNoKSk7XG4gIH1cblxuICB0aGlzLm9uKCduZXdMaXN0ZW5lcicsIGZ1bmN0aW9uIChldmVudCkge1xuICAgIGlmIChldmVudCA9PT0gJ2NoYW5nZScpIHtcbiAgICAgIHNlbGYucHVsbC5vbignY2hhbmdlJywgcHVsbENoYW5nZSk7XG4gICAgICBzZWxmLnB1c2gub24oJ2NoYW5nZScsIHB1c2hDaGFuZ2UpO1xuICAgIH0gZWxzZSBpZiAoZXZlbnQgPT09ICdkZW5pZWQnKSB7XG4gICAgICBzZWxmLnB1bGwub24oJ2RlbmllZCcsIHB1bGxEZW5pZWQpO1xuICAgICAgc2VsZi5wdXNoLm9uKCdkZW5pZWQnLCBwdXNoRGVuaWVkKTtcbiAgICB9IGVsc2UgaWYgKGV2ZW50ID09PSAnY2FuY2VsJykge1xuICAgICAgc2VsZi5wdWxsLm9uKCdjYW5jZWwnLCBvbkNhbmNlbCk7XG4gICAgICBzZWxmLnB1c2gub24oJ2NhbmNlbCcsIG9uQ2FuY2VsKTtcbiAgICB9IGVsc2UgaWYgKGV2ZW50ICE9PSAnZXJyb3InICYmXG4gICAgICBldmVudCAhPT0gJ3JlbW92ZUxpc3RlbmVyJyAmJlxuICAgICAgZXZlbnQgIT09ICdjb21wbGV0ZScgJiYgIShldmVudCBpbiBsaXN0ZW5lcnMpKSB7XG4gICAgICBsaXN0ZW5lcnNbZXZlbnRdID0gZnVuY3Rpb24gKGUpIHtcbiAgICAgICAgc2VsZi5lbWl0KGV2ZW50LCBlKTtcbiAgICAgIH07XG4gICAgICBzZWxmLnB1bGwub24oZXZlbnQsIGxpc3RlbmVyc1tldmVudF0pO1xuICAgICAgc2VsZi5wdXNoLm9uKGV2ZW50LCBsaXN0ZW5lcnNbZXZlbnRdKTtcbiAgICB9XG4gIH0pO1xuXG4gIHRoaXMub24oJ3JlbW92ZUxpc3RlbmVyJywgZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgaWYgKGV2ZW50ID09PSAnY2hhbmdlJykge1xuICAgICAgc2VsZi5wdWxsLnJlbW92ZUxpc3RlbmVyKCdjaGFuZ2UnLCBwdWxsQ2hhbmdlKTtcbiAgICAgIHNlbGYucHVzaC5yZW1vdmVMaXN0ZW5lcignY2hhbmdlJywgcHVzaENoYW5nZSk7XG4gICAgfSBlbHNlIGlmIChldmVudCA9PT0gJ2NhbmNlbCcpIHtcbiAgICAgIHNlbGYucHVsbC5yZW1vdmVMaXN0ZW5lcignY2FuY2VsJywgb25DYW5jZWwpO1xuICAgICAgc2VsZi5wdXNoLnJlbW92ZUxpc3RlbmVyKCdjYW5jZWwnLCBvbkNhbmNlbCk7XG4gICAgfSBlbHNlIGlmIChldmVudCBpbiBsaXN0ZW5lcnMpIHtcbiAgICAgIGlmICh0eXBlb2YgbGlzdGVuZXJzW2V2ZW50XSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICBzZWxmLnB1bGwucmVtb3ZlTGlzdGVuZXIoZXZlbnQsIGxpc3RlbmVyc1tldmVudF0pO1xuICAgICAgICBzZWxmLnB1c2gucmVtb3ZlTGlzdGVuZXIoZXZlbnQsIGxpc3RlbmVyc1tldmVudF0pO1xuICAgICAgICBkZWxldGUgbGlzdGVuZXJzW2V2ZW50XTtcbiAgICAgIH1cbiAgICB9XG4gIH0pO1xuXG4gIHRoaXMucHVsbC5vbigncmVtb3ZlTGlzdGVuZXInLCByZW1vdmVBbGwoJ3B1bGwnKSk7XG4gIHRoaXMucHVzaC5vbigncmVtb3ZlTGlzdGVuZXInLCByZW1vdmVBbGwoJ3B1c2gnKSk7XG5cbiAgdmFyIHByb21pc2UgPSB1dGlscy5Qcm9taXNlLmFsbChbXG4gICAgdGhpcy5wdXNoLFxuICAgIHRoaXMucHVsbFxuICBdKS50aGVuKGZ1bmN0aW9uIChyZXNwKSB7XG4gICAgdmFyIG91dCA9IHtcbiAgICAgIHB1c2g6IHJlc3BbMF0sXG4gICAgICBwdWxsOiByZXNwWzFdXG4gICAgfTtcbiAgICBzZWxmLmVtaXQoJ2NvbXBsZXRlJywgb3V0KTtcbiAgICBpZiAoY29tcGxldGUpIHtcbiAgICAgIGNvbXBsZXRlKG51bGwsIG91dCk7XG4gICAgfVxuICAgIHNlbGYucmVtb3ZlQWxsTGlzdGVuZXJzKCk7XG4gICAgcmV0dXJuIG91dDtcbiAgfSwgZnVuY3Rpb24gKGVycikge1xuICAgIHNlbGYuY2FuY2VsKCk7XG4gICAgc2VsZi5lbWl0KCdlcnJvcicsIGVycik7XG4gICAgaWYgKGNvbXBsZXRlKSB7XG4gICAgICBjb21wbGV0ZShlcnIpO1xuICAgIH1cbiAgICBzZWxmLnJlbW92ZUFsbExpc3RlbmVycygpO1xuICAgIHRocm93IGVycjtcbiAgfSk7XG5cbiAgdGhpcy50aGVuID0gZnVuY3Rpb24gKHN1Y2Nlc3MsIGVycikge1xuICAgIHJldHVybiBwcm9taXNlLnRoZW4oc3VjY2VzcywgZXJyKTtcbiAgfTtcblxuICB0aGlzW1wiY2F0Y2hcIl0gPSBmdW5jdGlvbiAoZXJyKSB7XG4gICAgcmV0dXJuIHByb21pc2VbXCJjYXRjaFwiXShlcnIpO1xuICB9O1xufVxuXG5TeW5jLnByb3RvdHlwZS5jYW5jZWwgPSBmdW5jdGlvbiAoKSB7XG4gIGlmICghdGhpcy5jYW5jZWxlZCkge1xuICAgIHRoaXMuY2FuY2VsZWQgPSB0cnVlO1xuICAgIHRoaXMucHVzaC5jYW5jZWwoKTtcbiAgICB0aGlzLnB1bGwuY2FuY2VsKCk7XG4gIH1cbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gVGFza1F1ZXVlO1xuXG5mdW5jdGlvbiBUYXNrUXVldWUoKSB7XG4gIHRoaXMuaXNSZWFkeSA9IGZhbHNlO1xuICB0aGlzLmZhaWxlZCA9IGZhbHNlO1xuICB0aGlzLnF1ZXVlID0gW107XG59XG5cblRhc2tRdWV1ZS5wcm90b3R5cGUuZXhlY3V0ZSA9IGZ1bmN0aW9uICgpIHtcbiAgdmFyIGQsIGZ1bmM7XG4gIGlmICh0aGlzLmZhaWxlZCkge1xuICAgIHdoaWxlICgoZCA9IHRoaXMucXVldWUuc2hpZnQoKSkpIHtcbiAgICAgIGlmICh0eXBlb2YgZCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICBkKHRoaXMuZmFpbGVkKTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBmdW5jID0gZC5wYXJhbWV0ZXJzW2QucGFyYW1ldGVycy5sZW5ndGggLSAxXTtcbiAgICAgIGlmICh0eXBlb2YgZnVuYyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICBmdW5jKHRoaXMuZmFpbGVkKTtcbiAgICAgIH0gZWxzZSBpZiAoZC5uYW1lID09PSAnY2hhbmdlcycgJiYgdHlwZW9mIGZ1bmMuY29tcGxldGUgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgZnVuYy5jb21wbGV0ZSh0aGlzLmZhaWxlZCk7XG4gICAgICB9XG4gICAgfVxuICB9IGVsc2UgaWYgKHRoaXMuaXNSZWFkeSkge1xuICAgIHdoaWxlICgoZCA9IHRoaXMucXVldWUuc2hpZnQoKSkpIHtcblxuICAgICAgaWYgKHR5cGVvZiBkID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIGQoKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGQudGFzayA9IHRoaXMuZGJbZC5uYW1lXS5hcHBseSh0aGlzLmRiLCBkLnBhcmFtZXRlcnMpO1xuICAgICAgfVxuICAgIH1cbiAgfVxufTtcblxuVGFza1F1ZXVlLnByb3RvdHlwZS5mYWlsID0gZnVuY3Rpb24gKGVycikge1xuICB0aGlzLmZhaWxlZCA9IGVycjtcbiAgdGhpcy5leGVjdXRlKCk7XG59O1xuXG5UYXNrUXVldWUucHJvdG90eXBlLnJlYWR5ID0gZnVuY3Rpb24gKGRiKSB7XG4gIGlmICh0aGlzLmZhaWxlZCkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfSBlbHNlIGlmIChhcmd1bWVudHMubGVuZ3RoID09PSAwKSB7XG4gICAgcmV0dXJuIHRoaXMuaXNSZWFkeTtcbiAgfVxuICB0aGlzLmlzUmVhZHkgPSBkYiA/IHRydWU6IGZhbHNlO1xuICB0aGlzLmRiID0gZGI7XG4gIHRoaXMuZXhlY3V0ZSgpO1xufTtcblxuVGFza1F1ZXVlLnByb3RvdHlwZS5hZGRUYXNrID0gZnVuY3Rpb24gKG5hbWUsIHBhcmFtZXRlcnMpIHtcbiAgaWYgKHR5cGVvZiBuYW1lID09PSAnZnVuY3Rpb24nKSB7XG4gICAgdGhpcy5xdWV1ZS5wdXNoKG5hbWUpO1xuICAgIGlmICh0aGlzLmZhaWxlZCkge1xuICAgICAgdGhpcy5leGVjdXRlKCk7XG4gICAgfVxuICB9IGVsc2Uge1xuICAgIHZhciB0YXNrID0geyBuYW1lOiBuYW1lLCBwYXJhbWV0ZXJzOiBwYXJhbWV0ZXJzIH07XG4gICAgdGhpcy5xdWV1ZS5wdXNoKHRhc2spO1xuICAgIGlmICh0aGlzLmZhaWxlZCkge1xuICAgICAgdGhpcy5leGVjdXRlKCk7XG4gICAgfVxuICAgIHJldHVybiB0YXNrO1xuICB9XG59O1xuIiwiLypqc2hpbnQgc3RyaWN0OiBmYWxzZSAqL1xuLypnbG9iYWwgY2hyb21lICovXG52YXIgbWVyZ2UgPSByZXF1aXJlKCcuL21lcmdlJyk7XG5leHBvcnRzLmV4dGVuZCA9IHJlcXVpcmUoJ3BvdWNoZGItZXh0ZW5kJyk7XG5leHBvcnRzLmFqYXggPSByZXF1aXJlKCcuL2RlcHMvYWpheCcpO1xuZXhwb3J0cy5jcmVhdGVCbG9iID0gcmVxdWlyZSgnLi9kZXBzL2Jsb2InKTtcbmV4cG9ydHMudXVpZCA9IHJlcXVpcmUoJy4vZGVwcy91dWlkJyk7XG5leHBvcnRzLmdldEFyZ3VtZW50cyA9IHJlcXVpcmUoJ2FyZ3NhcnJheScpO1xudmFyIGJ1ZmZlciA9IHJlcXVpcmUoJy4vZGVwcy9idWZmZXInKTtcbnZhciBlcnJvcnMgPSByZXF1aXJlKCcuL2RlcHMvZXJyb3JzJyk7XG52YXIgRXZlbnRFbWl0dGVyID0gcmVxdWlyZSgnZXZlbnRzJykuRXZlbnRFbWl0dGVyO1xudmFyIGNvbGxlY3Rpb25zID0gcmVxdWlyZSgncG91Y2hkYi1jb2xsZWN0aW9ucycpO1xuZXhwb3J0cy5NYXAgPSBjb2xsZWN0aW9ucy5NYXA7XG5leHBvcnRzLlNldCA9IGNvbGxlY3Rpb25zLlNldDtcbnZhciBwYXJzZURvYyA9IHJlcXVpcmUoJy4vZGVwcy9wYXJzZS1kb2MnKTtcblxuaWYgKHR5cGVvZiBnbG9iYWwuUHJvbWlzZSA9PT0gJ2Z1bmN0aW9uJykge1xuICBleHBvcnRzLlByb21pc2UgPSBnbG9iYWwuUHJvbWlzZTtcbn0gZWxzZSB7XG4gIGV4cG9ydHMuUHJvbWlzZSA9IHJlcXVpcmUoJ2JsdWViaXJkJyk7XG59XG52YXIgUHJvbWlzZSA9IGV4cG9ydHMuUHJvbWlzZTtcblxuZXhwb3J0cy5sYXN0SW5kZXhPZiA9IGZ1bmN0aW9uIChzdHIsIGNoYXIpIHtcbiAgZm9yICh2YXIgaSA9IHN0ci5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgIGlmIChzdHIuY2hhckF0KGkpID09PSBjaGFyKSB7XG4gICAgICByZXR1cm4gaTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIC0xO1xufTtcblxuZXhwb3J0cy5jbG9uZSA9IGZ1bmN0aW9uIChvYmopIHtcbiAgcmV0dXJuIGV4cG9ydHMuZXh0ZW5kKHRydWUsIHt9LCBvYmopO1xufTtcblxuLy8gbGlrZSB1bmRlcnNjb3JlL2xvZGFzaCBfLnBpY2soKVxuZXhwb3J0cy5waWNrID0gZnVuY3Rpb24gKG9iaiwgYXJyKSB7XG4gIHZhciByZXMgPSB7fTtcbiAgZm9yICh2YXIgaSA9IDAsIGxlbiA9IGFyci5sZW5ndGg7IGkgPCBsZW47IGkrKykge1xuICAgIHZhciBwcm9wID0gYXJyW2ldO1xuICAgIHJlc1twcm9wXSA9IG9ialtwcm9wXTtcbiAgfVxuICByZXR1cm4gcmVzO1xufTtcblxuZXhwb3J0cy5pbmhlcml0cyA9IHJlcXVpcmUoJ2luaGVyaXRzJyk7XG5cbmZ1bmN0aW9uIGlzQ2hyb21lQXBwKCkge1xuICByZXR1cm4gKHR5cGVvZiBjaHJvbWUgIT09IFwidW5kZWZpbmVkXCIgJiZcbiAgICAgICAgICB0eXBlb2YgY2hyb21lLnN0b3JhZ2UgIT09IFwidW5kZWZpbmVkXCIgJiZcbiAgICAgICAgICB0eXBlb2YgY2hyb21lLnN0b3JhZ2UubG9jYWwgIT09IFwidW5kZWZpbmVkXCIpO1xufVxuXG4vLyBQcmV0dHkgZHVtYiBuYW1lIGZvciBhIGZ1bmN0aW9uLCBqdXN0IHdyYXBzIGNhbGxiYWNrIGNhbGxzIHNvIHdlIGRvbnRcbi8vIHRvIGlmIChjYWxsYmFjaykgY2FsbGJhY2soKSBldmVyeXdoZXJlXG5leHBvcnRzLmNhbGwgPSBleHBvcnRzLmdldEFyZ3VtZW50cyhmdW5jdGlvbiAoYXJncykge1xuICBpZiAoIWFyZ3MubGVuZ3RoKSB7XG4gICAgcmV0dXJuO1xuICB9XG4gIHZhciBmdW4gPSBhcmdzLnNoaWZ0KCk7XG4gIGlmICh0eXBlb2YgZnVuID09PSAnZnVuY3Rpb24nKSB7XG4gICAgZnVuLmFwcGx5KHRoaXMsIGFyZ3MpO1xuICB9XG59KTtcblxuZXhwb3J0cy5pc0xvY2FsSWQgPSBmdW5jdGlvbiAoaWQpIHtcbiAgcmV0dXJuICgvXl9sb2NhbC8pLnRlc3QoaWQpO1xufTtcblxuLy8gY2hlY2sgaWYgYSBzcGVjaWZpYyByZXZpc2lvbiBvZiBhIGRvYyBoYXMgYmVlbiBkZWxldGVkXG4vLyAgLSBtZXRhZGF0YTogdGhlIG1ldGFkYXRhIG9iamVjdCBmcm9tIHRoZSBkb2Mgc3RvcmVcbi8vICAtIHJldjogKG9wdGlvbmFsKSB0aGUgcmV2aXNpb24gdG8gY2hlY2suIGRlZmF1bHRzIHRvIHdpbm5pbmcgcmV2aXNpb25cbmV4cG9ydHMuaXNEZWxldGVkID0gZnVuY3Rpb24gKG1ldGFkYXRhLCByZXYpIHtcbiAgaWYgKCFyZXYpIHtcbiAgICByZXYgPSBtZXJnZS53aW5uaW5nUmV2KG1ldGFkYXRhKTtcbiAgfVxuICB2YXIgZGFzaEluZGV4ID0gcmV2LmluZGV4T2YoJy0nKTtcbiAgaWYgKGRhc2hJbmRleCAhPT0gLTEpIHtcbiAgICByZXYgPSByZXYuc3Vic3RyaW5nKGRhc2hJbmRleCArIDEpO1xuICB9XG4gIHZhciBkZWxldGVkID0gZmFsc2U7XG4gIG1lcmdlLnRyYXZlcnNlUmV2VHJlZShtZXRhZGF0YS5yZXZfdHJlZSxcbiAgZnVuY3Rpb24gKGlzTGVhZiwgcG9zLCBpZCwgYWNjLCBvcHRzKSB7XG4gICAgaWYgKGlkID09PSByZXYpIHtcbiAgICAgIGRlbGV0ZWQgPSAhIW9wdHMuZGVsZXRlZDtcbiAgICB9XG4gIH0pO1xuXG4gIHJldHVybiBkZWxldGVkO1xufTtcblxuZXhwb3J0cy5yZXZFeGlzdHMgPSBmdW5jdGlvbiAobWV0YWRhdGEsIHJldikge1xuICB2YXIgZm91bmQgPSBmYWxzZTtcbiAgbWVyZ2UudHJhdmVyc2VSZXZUcmVlKG1ldGFkYXRhLnJldl90cmVlLCBmdW5jdGlvbiAobGVhZiwgcG9zLCBpZCkge1xuICAgIGlmICgocG9zICsgJy0nICsgaWQpID09PSByZXYpIHtcbiAgICAgIGZvdW5kID0gdHJ1ZTtcbiAgICB9XG4gIH0pO1xuICByZXR1cm4gZm91bmQ7XG59O1xuXG5leHBvcnRzLmZpbHRlckNoYW5nZSA9IGZ1bmN0aW9uIGZpbHRlckNoYW5nZShvcHRzKSB7XG4gIHZhciByZXEgPSB7fTtcbiAgdmFyIGhhc0ZpbHRlciA9IG9wdHMuZmlsdGVyICYmIHR5cGVvZiBvcHRzLmZpbHRlciA9PT0gJ2Z1bmN0aW9uJztcbiAgcmVxLnF1ZXJ5ID0gb3B0cy5xdWVyeV9wYXJhbXM7XG5cbiAgcmV0dXJuIGZ1bmN0aW9uIGZpbHRlcihjaGFuZ2UpIHtcbiAgICBpZiAoIWNoYW5nZS5kb2MpIHtcbiAgICAgIC8vIENTRyBzZW5kcyBldmVudHMgb24gdGhlIGNoYW5nZXMgZmVlZCB0aGF0IGRvbid0IGhhdmUgZG9jdW1lbnRzLFxuICAgICAgLy8gdGhpcyBoYWNrIG1ha2VzIGEgd2hvbGUgbG90IG9mIGV4aXN0aW5nIGNvZGUgcm9idXN0LlxuICAgICAgY2hhbmdlLmRvYyA9IHt9O1xuICAgIH1cbiAgICBpZiAob3B0cy5maWx0ZXIgJiYgaGFzRmlsdGVyICYmICFvcHRzLmZpbHRlci5jYWxsKHRoaXMsIGNoYW5nZS5kb2MsIHJlcSkpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgaWYgKCFvcHRzLmluY2x1ZGVfZG9jcykge1xuICAgICAgZGVsZXRlIGNoYW5nZS5kb2M7XG4gICAgfSBlbHNlIGlmICghb3B0cy5hdHRhY2htZW50cykge1xuICAgICAgZm9yICh2YXIgYXR0IGluIGNoYW5nZS5kb2MuX2F0dGFjaG1lbnRzKSB7XG4gICAgICAgIGlmIChjaGFuZ2UuZG9jLl9hdHRhY2htZW50cy5oYXNPd25Qcm9wZXJ0eShhdHQpKSB7XG4gICAgICAgICAgY2hhbmdlLmRvYy5fYXR0YWNobWVudHNbYXR0XS5zdHViID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gdHJ1ZTtcbiAgfTtcbn07XG5cbmV4cG9ydHMucGFyc2VEb2MgPSBwYXJzZURvYy5wYXJzZURvYztcbmV4cG9ydHMuaW52YWxpZElkRXJyb3IgPSBwYXJzZURvYy5pbnZhbGlkSWRFcnJvcjtcblxuZXhwb3J0cy5pc0NvcmRvdmEgPSBmdW5jdGlvbiAoKSB7XG4gIHJldHVybiAodHlwZW9mIGNvcmRvdmEgIT09IFwidW5kZWZpbmVkXCIgfHxcbiAgICAgICAgICB0eXBlb2YgUGhvbmVHYXAgIT09IFwidW5kZWZpbmVkXCIgfHxcbiAgICAgICAgICB0eXBlb2YgcGhvbmVnYXAgIT09IFwidW5kZWZpbmVkXCIpO1xufTtcblxuZXhwb3J0cy5oYXNMb2NhbFN0b3JhZ2UgPSBmdW5jdGlvbiAoKSB7XG4gIGlmIChpc0Nocm9tZUFwcCgpKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIHRyeSB7XG4gICAgcmV0dXJuIGxvY2FsU3RvcmFnZTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufTtcbmV4cG9ydHMuQ2hhbmdlcyA9IENoYW5nZXM7XG5leHBvcnRzLmluaGVyaXRzKENoYW5nZXMsIEV2ZW50RW1pdHRlcik7XG5mdW5jdGlvbiBDaGFuZ2VzKCkge1xuICBpZiAoISh0aGlzIGluc3RhbmNlb2YgQ2hhbmdlcykpIHtcbiAgICByZXR1cm4gbmV3IENoYW5nZXMoKTtcbiAgfVxuICB2YXIgc2VsZiA9IHRoaXM7XG4gIEV2ZW50RW1pdHRlci5jYWxsKHRoaXMpO1xuICB0aGlzLmlzQ2hyb21lID0gaXNDaHJvbWVBcHAoKTtcbiAgdGhpcy5saXN0ZW5lcnMgPSB7fTtcbiAgdGhpcy5oYXNMb2NhbCA9IGZhbHNlO1xuICBpZiAoIXRoaXMuaXNDaHJvbWUpIHtcbiAgICB0aGlzLmhhc0xvY2FsID0gZXhwb3J0cy5oYXNMb2NhbFN0b3JhZ2UoKTtcbiAgfVxuICBpZiAodGhpcy5pc0Nocm9tZSkge1xuICAgIGNocm9tZS5zdG9yYWdlLm9uQ2hhbmdlZC5hZGRMaXN0ZW5lcihmdW5jdGlvbiAoZSkge1xuICAgICAgLy8gbWFrZSBzdXJlIGl0J3MgZXZlbnQgYWRkcmVzc2VkIHRvIHVzXG4gICAgICBpZiAoZS5kYl9uYW1lICE9IG51bGwpIHtcbiAgICAgICAgLy9vYmplY3Qgb25seSBoYXMgb2xkVmFsdWUsIG5ld1ZhbHVlIG1lbWJlcnNcbiAgICAgICAgc2VsZi5lbWl0KGUuZGJOYW1lLm5ld1ZhbHVlKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfSBlbHNlIGlmICh0aGlzLmhhc0xvY2FsKSB7XG4gICAgaWYgKHR5cGVvZiBhZGRFdmVudExpc3RlbmVyICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgYWRkRXZlbnRMaXN0ZW5lcihcInN0b3JhZ2VcIiwgZnVuY3Rpb24gKGUpIHtcbiAgICAgICAgc2VsZi5lbWl0KGUua2V5KTtcbiAgICAgIH0pO1xuICAgIH0gZWxzZSB7IC8vIG9sZCBJRVxuICAgICAgd2luZG93LmF0dGFjaEV2ZW50KFwic3RvcmFnZVwiLCBmdW5jdGlvbiAoZSkge1xuICAgICAgICBzZWxmLmVtaXQoZS5rZXkpO1xuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbn1cbkNoYW5nZXMucHJvdG90eXBlLmFkZExpc3RlbmVyID0gZnVuY3Rpb24gKGRiTmFtZSwgaWQsIGRiLCBvcHRzKSB7XG4gIGlmICh0aGlzLmxpc3RlbmVyc1tpZF0pIHtcbiAgICByZXR1cm47XG4gIH1cbiAgdmFyIHNlbGYgPSB0aGlzO1xuICB2YXIgaW5wcm9ncmVzcyA9IGZhbHNlO1xuICBmdW5jdGlvbiBldmVudEZ1bmN0aW9uKCkge1xuICAgIGlmICghc2VsZi5saXN0ZW5lcnNbaWRdKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmIChpbnByb2dyZXNzKSB7XG4gICAgICBpbnByb2dyZXNzID0gJ3dhaXRpbmcnO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpbnByb2dyZXNzID0gdHJ1ZTtcbiAgICBkYi5jaGFuZ2VzKHtcbiAgICAgIHN0eWxlOiBvcHRzLnN0eWxlLFxuICAgICAgaW5jbHVkZV9kb2NzOiBvcHRzLmluY2x1ZGVfZG9jcyxcbiAgICAgIGF0dGFjaG1lbnRzOiBvcHRzLmF0dGFjaG1lbnRzLFxuICAgICAgY29uZmxpY3RzOiBvcHRzLmNvbmZsaWN0cyxcbiAgICAgIGNvbnRpbnVvdXM6IGZhbHNlLFxuICAgICAgZGVzY2VuZGluZzogZmFsc2UsXG4gICAgICBmaWx0ZXI6IG9wdHMuZmlsdGVyLFxuICAgICAgZG9jX2lkczogb3B0cy5kb2NfaWRzLFxuICAgICAgdmlldzogb3B0cy52aWV3LFxuICAgICAgc2luY2U6IG9wdHMuc2luY2UsXG4gICAgICBxdWVyeV9wYXJhbXM6IG9wdHMucXVlcnlfcGFyYW1zXG4gICAgfSkub24oJ2NoYW5nZScsIGZ1bmN0aW9uIChjKSB7XG4gICAgICBpZiAoYy5zZXEgPiBvcHRzLnNpbmNlICYmICFvcHRzLmNhbmNlbGxlZCkge1xuICAgICAgICBvcHRzLnNpbmNlID0gYy5zZXE7XG4gICAgICAgIGV4cG9ydHMuY2FsbChvcHRzLm9uQ2hhbmdlLCBjKTtcbiAgICAgIH1cbiAgICB9KS5vbignY29tcGxldGUnLCBmdW5jdGlvbiAoKSB7XG4gICAgICBpZiAoaW5wcm9ncmVzcyA9PT0gJ3dhaXRpbmcnKSB7XG4gICAgICAgIHByb2Nlc3MubmV4dFRpY2soZnVuY3Rpb24gKCkge1xuICAgICAgICAgIHNlbGYubm90aWZ5KGRiTmFtZSk7XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgaW5wcm9ncmVzcyA9IGZhbHNlO1xuICAgIH0pLm9uKCdlcnJvcicsIGZ1bmN0aW9uICgpIHtcbiAgICAgIGlucHJvZ3Jlc3MgPSBmYWxzZTtcbiAgICB9KTtcbiAgfVxuICB0aGlzLmxpc3RlbmVyc1tpZF0gPSBldmVudEZ1bmN0aW9uO1xuICB0aGlzLm9uKGRiTmFtZSwgZXZlbnRGdW5jdGlvbik7XG59O1xuXG5DaGFuZ2VzLnByb3RvdHlwZS5yZW1vdmVMaXN0ZW5lciA9IGZ1bmN0aW9uIChkYk5hbWUsIGlkKSB7XG4gIGlmICghKGlkIGluIHRoaXMubGlzdGVuZXJzKSkge1xuICAgIHJldHVybjtcbiAgfVxuICBFdmVudEVtaXR0ZXIucHJvdG90eXBlLnJlbW92ZUxpc3RlbmVyLmNhbGwodGhpcywgZGJOYW1lLFxuICAgIHRoaXMubGlzdGVuZXJzW2lkXSk7XG59O1xuXG5cbkNoYW5nZXMucHJvdG90eXBlLm5vdGlmeUxvY2FsV2luZG93cyA9IGZ1bmN0aW9uIChkYk5hbWUpIHtcbiAgLy9kbyBhIHVzZWxlc3MgY2hhbmdlIG9uIGEgc3RvcmFnZSB0aGluZ1xuICAvL2luIG9yZGVyIHRvIGdldCBvdGhlciB3aW5kb3dzJ3MgbGlzdGVuZXJzIHRvIGFjdGl2YXRlXG4gIGlmICh0aGlzLmlzQ2hyb21lKSB7XG4gICAgY2hyb21lLnN0b3JhZ2UubG9jYWwuc2V0KHtkYk5hbWU6IGRiTmFtZX0pO1xuICB9IGVsc2UgaWYgKHRoaXMuaGFzTG9jYWwpIHtcbiAgICBsb2NhbFN0b3JhZ2VbZGJOYW1lXSA9IChsb2NhbFN0b3JhZ2VbZGJOYW1lXSA9PT0gXCJhXCIpID8gXCJiXCIgOiBcImFcIjtcbiAgfVxufTtcblxuQ2hhbmdlcy5wcm90b3R5cGUubm90aWZ5ID0gZnVuY3Rpb24gKGRiTmFtZSkge1xuICB0aGlzLmVtaXQoZGJOYW1lKTtcbiAgdGhpcy5ub3RpZnlMb2NhbFdpbmRvd3MoZGJOYW1lKTtcbn07XG5cbmlmICh0eXBlb2YgYXRvYiA9PT0gJ2Z1bmN0aW9uJykge1xuICBleHBvcnRzLmF0b2IgPSBmdW5jdGlvbiAoc3RyKSB7XG4gICAgcmV0dXJuIGF0b2Ioc3RyKTtcbiAgfTtcbn0gZWxzZSB7XG4gIGV4cG9ydHMuYXRvYiA9IGZ1bmN0aW9uIChzdHIpIHtcbiAgICB2YXIgYmFzZTY0ID0gbmV3IGJ1ZmZlcihzdHIsICdiYXNlNjQnKTtcbiAgICAvLyBOb2RlLmpzIHdpbGwganVzdCBza2lwIHRoZSBjaGFyYWN0ZXJzIGl0IGNhbid0IGVuY29kZSBpbnN0ZWFkIG9mXG4gICAgLy8gdGhyb3dpbmcgYW5kIGV4Y2VwdGlvblxuICAgIGlmIChiYXNlNjQudG9TdHJpbmcoJ2Jhc2U2NCcpICE9PSBzdHIpIHtcbiAgICAgIHRocm93IChcIkNhbm5vdCBiYXNlNjQgZW5jb2RlIGZ1bGwgc3RyaW5nXCIpO1xuICAgIH1cbiAgICByZXR1cm4gYmFzZTY0LnRvU3RyaW5nKCdiaW5hcnknKTtcbiAgfTtcbn1cblxuaWYgKHR5cGVvZiBidG9hID09PSAnZnVuY3Rpb24nKSB7XG4gIGV4cG9ydHMuYnRvYSA9IGZ1bmN0aW9uIChzdHIpIHtcbiAgICByZXR1cm4gYnRvYShzdHIpO1xuICB9O1xufSBlbHNlIHtcbiAgZXhwb3J0cy5idG9hID0gZnVuY3Rpb24gKHN0cikge1xuICAgIHJldHVybiBuZXcgYnVmZmVyKHN0ciwgJ2JpbmFyeScpLnRvU3RyaW5nKCdiYXNlNjQnKTtcbiAgfTtcbn1cblxuLy8gRnJvbSBodHRwOi8vc3RhY2tvdmVyZmxvdy5jb20vcXVlc3Rpb25zLzE0OTY3NjQ3LyAoY29udGludWVzIG9uIG5leHQgbGluZSlcbi8vIGVuY29kZS1kZWNvZGUtaW1hZ2Utd2l0aC1iYXNlNjQtYnJlYWtzLWltYWdlICgyMDEzLTA0LTIxKVxuZXhwb3J0cy5maXhCaW5hcnkgPSBmdW5jdGlvbiAoYmluKSB7XG4gIGlmICghcHJvY2Vzcy5icm93c2VyKSB7XG4gICAgLy8gZG9uJ3QgbmVlZCB0byBkbyB0aGlzIGluIE5vZGVcbiAgICByZXR1cm4gYmluO1xuICB9XG5cbiAgdmFyIGxlbmd0aCA9IGJpbi5sZW5ndGg7XG4gIHZhciBidWYgPSBuZXcgQXJyYXlCdWZmZXIobGVuZ3RoKTtcbiAgdmFyIGFyciA9IG5ldyBVaW50OEFycmF5KGJ1Zik7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICBhcnJbaV0gPSBiaW4uY2hhckNvZGVBdChpKTtcbiAgfVxuICByZXR1cm4gYnVmO1xufTtcblxuLy8gc2hpbSBmb3IgYnJvd3NlcnMgdGhhdCBkb24ndCBzdXBwb3J0IGl0XG5leHBvcnRzLnJlYWRBc0JpbmFyeVN0cmluZyA9IGZ1bmN0aW9uIChibG9iLCBjYWxsYmFjaykge1xuICB2YXIgcmVhZGVyID0gbmV3IEZpbGVSZWFkZXIoKTtcbiAgdmFyIGhhc0JpbmFyeVN0cmluZyA9IHR5cGVvZiByZWFkZXIucmVhZEFzQmluYXJ5U3RyaW5nID09PSAnZnVuY3Rpb24nO1xuICByZWFkZXIub25sb2FkZW5kID0gZnVuY3Rpb24gKGUpIHtcbiAgICB2YXIgcmVzdWx0ID0gZS50YXJnZXQucmVzdWx0IHx8ICcnO1xuICAgIGlmIChoYXNCaW5hcnlTdHJpbmcpIHtcbiAgICAgIHJldHVybiBjYWxsYmFjayhyZXN1bHQpO1xuICAgIH1cbiAgICBjYWxsYmFjayhleHBvcnRzLmFycmF5QnVmZmVyVG9CaW5hcnlTdHJpbmcocmVzdWx0KSk7XG4gIH07XG4gIGlmIChoYXNCaW5hcnlTdHJpbmcpIHtcbiAgICByZWFkZXIucmVhZEFzQmluYXJ5U3RyaW5nKGJsb2IpO1xuICB9IGVsc2Uge1xuICAgIHJlYWRlci5yZWFkQXNBcnJheUJ1ZmZlcihibG9iKTtcbiAgfVxufTtcblxuLy8gc2ltcGxpZmllZCBBUEkuIHVuaXZlcnNhbCBicm93c2VyIHN1cHBvcnQgaXMgYXNzdW1lZFxuZXhwb3J0cy5yZWFkQXNBcnJheUJ1ZmZlciA9IGZ1bmN0aW9uIChibG9iLCBjYWxsYmFjaykge1xuICB2YXIgcmVhZGVyID0gbmV3IEZpbGVSZWFkZXIoKTtcbiAgcmVhZGVyLm9ubG9hZGVuZCA9IGZ1bmN0aW9uIChlKSB7XG4gICAgdmFyIHJlc3VsdCA9IGUudGFyZ2V0LnJlc3VsdCB8fCBuZXcgQXJyYXlCdWZmZXIoMCk7XG4gICAgY2FsbGJhY2socmVzdWx0KTtcbiAgfTtcbiAgcmVhZGVyLnJlYWRBc0FycmF5QnVmZmVyKGJsb2IpO1xufTtcblxuZXhwb3J0cy5vbmNlID0gZnVuY3Rpb24gKGZ1bikge1xuICB2YXIgY2FsbGVkID0gZmFsc2U7XG4gIHJldHVybiBleHBvcnRzLmdldEFyZ3VtZW50cyhmdW5jdGlvbiAoYXJncykge1xuICAgIGlmIChjYWxsZWQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignb25jZSBjYWxsZWQgIG1vcmUgdGhhbiBvbmNlJyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNhbGxlZCA9IHRydWU7XG4gICAgICBmdW4uYXBwbHkodGhpcywgYXJncyk7XG4gICAgfVxuICB9KTtcbn07XG5cbmV4cG9ydHMudG9Qcm9taXNlID0gZnVuY3Rpb24gKGZ1bmMpIHtcbiAgLy9jcmVhdGUgdGhlIGZ1bmN0aW9uIHdlIHdpbGwgYmUgcmV0dXJuaW5nXG4gIHJldHVybiBleHBvcnRzLmdldEFyZ3VtZW50cyhmdW5jdGlvbiAoYXJncykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICB2YXIgdGVtcENCID1cbiAgICAgICh0eXBlb2YgYXJnc1thcmdzLmxlbmd0aCAtIDFdID09PSAnZnVuY3Rpb24nKSA/IGFyZ3MucG9wKCkgOiBmYWxzZTtcbiAgICAvLyBpZiB0aGUgbGFzdCBhcmd1bWVudCBpcyBhIGZ1bmN0aW9uLCBhc3N1bWUgaXRzIGEgY2FsbGJhY2tcbiAgICB2YXIgdXNlZENCO1xuICAgIGlmICh0ZW1wQ0IpIHtcbiAgICAgIC8vIGlmIGl0IHdhcyBhIGNhbGxiYWNrLCBjcmVhdGUgYSBuZXcgY2FsbGJhY2sgd2hpY2ggY2FsbHMgaXQsXG4gICAgICAvLyBidXQgZG8gc28gYXN5bmMgc28gd2UgZG9uJ3QgdHJhcCBhbnkgZXJyb3JzXG4gICAgICB1c2VkQ0IgPSBmdW5jdGlvbiAoZXJyLCByZXNwKSB7XG4gICAgICAgIHByb2Nlc3MubmV4dFRpY2soZnVuY3Rpb24gKCkge1xuICAgICAgICAgIHRlbXBDQihlcnIsIHJlc3ApO1xuICAgICAgICB9KTtcbiAgICAgIH07XG4gICAgfVxuICAgIHZhciBwcm9taXNlID0gbmV3IFByb21pc2UoZnVuY3Rpb24gKGZ1bGZpbGwsIHJlamVjdCkge1xuICAgICAgdmFyIHJlc3A7XG4gICAgICB0cnkge1xuICAgICAgICB2YXIgY2FsbGJhY2sgPSBleHBvcnRzLm9uY2UoZnVuY3Rpb24gKGVyciwgbWVzZykge1xuICAgICAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgICAgIHJlamVjdChlcnIpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBmdWxmaWxsKG1lc2cpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIC8vIGNyZWF0ZSBhIGNhbGxiYWNrIGZvciB0aGlzIGludm9jYXRpb25cbiAgICAgICAgLy8gYXBwbHkgdGhlIGZ1bmN0aW9uIGluIHRoZSBvcmlnIGNvbnRleHRcbiAgICAgICAgYXJncy5wdXNoKGNhbGxiYWNrKTtcbiAgICAgICAgcmVzcCA9IGZ1bmMuYXBwbHkoc2VsZiwgYXJncyk7XG4gICAgICAgIGlmIChyZXNwICYmIHR5cGVvZiByZXNwLnRoZW4gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICBmdWxmaWxsKHJlc3ApO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIHJlamVjdChlKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICAvLyBpZiB0aGVyZSBpcyBhIGNhbGxiYWNrLCBjYWxsIGl0IGJhY2tcbiAgICBpZiAodXNlZENCKSB7XG4gICAgICBwcm9taXNlLnRoZW4oZnVuY3Rpb24gKHJlc3VsdCkge1xuICAgICAgICB1c2VkQ0IobnVsbCwgcmVzdWx0KTtcbiAgICAgIH0sIHVzZWRDQik7XG4gICAgfVxuICAgIHByb21pc2UuY2FuY2VsID0gZnVuY3Rpb24gKCkge1xuICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfTtcbiAgICByZXR1cm4gcHJvbWlzZTtcbiAgfSk7XG59O1xuXG5leHBvcnRzLmFkYXB0ZXJGdW4gPSBmdW5jdGlvbiAobmFtZSwgY2FsbGJhY2spIHtcbiAgdmFyIGxvZyA9IHJlcXVpcmUoJ2RlYnVnJykoJ3BvdWNoZGI6YXBpJyk7XG5cbiAgZnVuY3Rpb24gbG9nQXBpQ2FsbChzZWxmLCBuYW1lLCBhcmdzKSB7XG4gICAgaWYgKCFsb2cuZW5hYmxlZCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB2YXIgbG9nQXJncyA9IFtzZWxmLl9kYl9uYW1lLCBuYW1lXTtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGFyZ3MubGVuZ3RoIC0gMTsgaSsrKSB7XG4gICAgICBsb2dBcmdzLnB1c2goYXJnc1tpXSk7XG4gICAgfVxuICAgIGxvZy5hcHBseShudWxsLCBsb2dBcmdzKTtcblxuICAgIC8vIG92ZXJyaWRlIHRoZSBjYWxsYmFjayBpdHNlbGYgdG8gbG9nIHRoZSByZXNwb25zZVxuICAgIHZhciBvcmlnQ2FsbGJhY2sgPSBhcmdzW2FyZ3MubGVuZ3RoIC0gMV07XG4gICAgYXJnc1thcmdzLmxlbmd0aCAtIDFdID0gZnVuY3Rpb24gKGVyciwgcmVzKSB7XG4gICAgICB2YXIgcmVzcG9uc2VBcmdzID0gW3NlbGYuX2RiX25hbWUsIG5hbWVdO1xuICAgICAgcmVzcG9uc2VBcmdzID0gcmVzcG9uc2VBcmdzLmNvbmNhdChcbiAgICAgICAgZXJyID8gWydlcnJvcicsIGVycl0gOiBbJ3N1Y2Nlc3MnLCByZXNdXG4gICAgICApO1xuICAgICAgbG9nLmFwcGx5KG51bGwsIHJlc3BvbnNlQXJncyk7XG4gICAgICBvcmlnQ2FsbGJhY2soZXJyLCByZXMpO1xuICAgIH07XG4gIH1cblxuXG4gIHJldHVybiBleHBvcnRzLnRvUHJvbWlzZShleHBvcnRzLmdldEFyZ3VtZW50cyhmdW5jdGlvbiAoYXJncykge1xuICAgIGlmICh0aGlzLl9jbG9zZWQpIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChuZXcgRXJyb3IoJ2RhdGFiYXNlIGlzIGNsb3NlZCcpKTtcbiAgICB9XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIGxvZ0FwaUNhbGwoc2VsZiwgbmFtZSwgYXJncyk7XG4gICAgaWYgKCF0aGlzLnRhc2txdWV1ZS5pc1JlYWR5KSB7XG4gICAgICByZXR1cm4gbmV3IGV4cG9ydHMuUHJvbWlzZShmdW5jdGlvbiAoZnVsZmlsbCwgcmVqZWN0KSB7XG4gICAgICAgIHNlbGYudGFza3F1ZXVlLmFkZFRhc2soZnVuY3Rpb24gKGZhaWxlZCkge1xuICAgICAgICAgIGlmIChmYWlsZWQpIHtcbiAgICAgICAgICAgIHJlamVjdChmYWlsZWQpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBmdWxmaWxsKHNlbGZbbmFtZV0uYXBwbHkoc2VsZiwgYXJncykpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9XG4gICAgcmV0dXJuIGNhbGxiYWNrLmFwcGx5KHRoaXMsIGFyZ3MpO1xuICB9KSk7XG59O1xuXG4vL0Nhbid0IGZpbmQgb3JpZ2luYWwgcG9zdCwgYnV0IHRoaXMgaXMgY2xvc2Vcbi8vaHR0cDovL3N0YWNrb3ZlcmZsb3cuY29tL3F1ZXN0aW9ucy82OTY1MTA3LyAoY29udGludWVzIG9uIG5leHQgbGluZSlcbi8vY29udmVydGluZy1iZXR3ZWVuLXN0cmluZ3MtYW5kLWFycmF5YnVmZmVyc1xuZXhwb3J0cy5hcnJheUJ1ZmZlclRvQmluYXJ5U3RyaW5nID0gZnVuY3Rpb24gKGJ1ZmZlcikge1xuICB2YXIgYmluYXJ5ID0gXCJcIjtcbiAgdmFyIGJ5dGVzID0gbmV3IFVpbnQ4QXJyYXkoYnVmZmVyKTtcbiAgdmFyIGxlbmd0aCA9IGJ5dGVzLmJ5dGVMZW5ndGg7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICBiaW5hcnkgKz0gU3RyaW5nLmZyb21DaGFyQ29kZShieXRlc1tpXSk7XG4gIH1cbiAgcmV0dXJuIGJpbmFyeTtcbn07XG5cbmV4cG9ydHMuY2FuY2VsbGFibGVGdW4gPSBmdW5jdGlvbiAoZnVuLCBzZWxmLCBvcHRzKSB7XG5cbiAgb3B0cyA9IG9wdHMgPyBleHBvcnRzLmNsb25lKHRydWUsIHt9LCBvcHRzKSA6IHt9O1xuXG4gIHZhciBlbWl0dGVyID0gbmV3IEV2ZW50RW1pdHRlcigpO1xuICB2YXIgb2xkQ29tcGxldGUgPSBvcHRzLmNvbXBsZXRlIHx8IGZ1bmN0aW9uICgpIHsgfTtcbiAgdmFyIGNvbXBsZXRlID0gb3B0cy5jb21wbGV0ZSA9IGV4cG9ydHMub25jZShmdW5jdGlvbiAoZXJyLCByZXNwKSB7XG4gICAgaWYgKGVycikge1xuICAgICAgb2xkQ29tcGxldGUoZXJyKTtcbiAgICB9IGVsc2Uge1xuICAgICAgZW1pdHRlci5lbWl0KCdlbmQnLCByZXNwKTtcbiAgICAgIG9sZENvbXBsZXRlKG51bGwsIHJlc3ApO1xuICAgIH1cbiAgICBlbWl0dGVyLnJlbW92ZUFsbExpc3RlbmVycygpO1xuICB9KTtcbiAgdmFyIG9sZE9uQ2hhbmdlID0gb3B0cy5vbkNoYW5nZSB8fCBmdW5jdGlvbiAoKSB7fTtcbiAgdmFyIGxhc3RDaGFuZ2UgPSAwO1xuICBzZWxmLm9uKCdkZXN0cm95ZWQnLCBmdW5jdGlvbiAoKSB7XG4gICAgZW1pdHRlci5yZW1vdmVBbGxMaXN0ZW5lcnMoKTtcbiAgfSk7XG4gIG9wdHMub25DaGFuZ2UgPSBmdW5jdGlvbiAoY2hhbmdlKSB7XG4gICAgb2xkT25DaGFuZ2UoY2hhbmdlKTtcbiAgICBpZiAoY2hhbmdlLnNlcSA8PSBsYXN0Q2hhbmdlKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGxhc3RDaGFuZ2UgPSBjaGFuZ2Uuc2VxO1xuICAgIGVtaXR0ZXIuZW1pdCgnY2hhbmdlJywgY2hhbmdlKTtcbiAgICBpZiAoY2hhbmdlLmRlbGV0ZWQpIHtcbiAgICAgIGVtaXR0ZXIuZW1pdCgnZGVsZXRlJywgY2hhbmdlKTtcbiAgICB9IGVsc2UgaWYgKGNoYW5nZS5jaGFuZ2VzLmxlbmd0aCA9PT0gMSAmJlxuICAgICAgY2hhbmdlLmNoYW5nZXNbMF0ucmV2LnNsaWNlKDAsIDEpID09PSAnMS0nKSB7XG4gICAgICBlbWl0dGVyLmVtaXQoJ2NyZWF0ZScsIGNoYW5nZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGVtaXR0ZXIuZW1pdCgndXBkYXRlJywgY2hhbmdlKTtcbiAgICB9XG4gIH07XG4gIHZhciBwcm9taXNlID0gbmV3IFByb21pc2UoZnVuY3Rpb24gKGZ1bGZpbGwsIHJlamVjdCkge1xuICAgIG9wdHMuY29tcGxldGUgPSBmdW5jdGlvbiAoZXJyLCByZXMpIHtcbiAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgcmVqZWN0KGVycik7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBmdWxmaWxsKHJlcyk7XG4gICAgICB9XG4gICAgfTtcbiAgfSk7XG5cbiAgcHJvbWlzZS50aGVuKGZ1bmN0aW9uIChyZXN1bHQpIHtcbiAgICBjb21wbGV0ZShudWxsLCByZXN1bHQpO1xuICB9LCBjb21wbGV0ZSk7XG5cbiAgLy8gdGhpcyBuZWVkcyB0byBiZSBvdmVyd3JpZGRlbiBieSBjYWxsZXIsIGRvbnQgZmlyZSBjb21wbGV0ZSB1bnRpbFxuICAvLyB0aGUgdGFzayBpcyByZWFkeVxuICBwcm9taXNlLmNhbmNlbCA9IGZ1bmN0aW9uICgpIHtcbiAgICBwcm9taXNlLmlzQ2FuY2VsbGVkID0gdHJ1ZTtcbiAgICBpZiAoc2VsZi50YXNrcXVldWUuaXNSZWFkeSkge1xuICAgICAgb3B0cy5jb21wbGV0ZShudWxsLCB7c3RhdHVzOiAnY2FuY2VsbGVkJ30pO1xuICAgIH1cbiAgfTtcblxuICBpZiAoIXNlbGYudGFza3F1ZXVlLmlzUmVhZHkpIHtcbiAgICBzZWxmLnRhc2txdWV1ZS5hZGRUYXNrKGZ1bmN0aW9uICgpIHtcbiAgICAgIGlmIChwcm9taXNlLmlzQ2FuY2VsbGVkKSB7XG4gICAgICAgIG9wdHMuY29tcGxldGUobnVsbCwge3N0YXR1czogJ2NhbmNlbGxlZCd9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGZ1bihzZWxmLCBvcHRzLCBwcm9taXNlKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfSBlbHNlIHtcbiAgICBmdW4oc2VsZiwgb3B0cywgcHJvbWlzZSk7XG4gIH1cbiAgcHJvbWlzZS5vbiA9IGVtaXR0ZXIub24uYmluZChlbWl0dGVyKTtcbiAgcHJvbWlzZS5vbmNlID0gZW1pdHRlci5vbmNlLmJpbmQoZW1pdHRlcik7XG4gIHByb21pc2UuYWRkTGlzdGVuZXIgPSBlbWl0dGVyLmFkZExpc3RlbmVyLmJpbmQoZW1pdHRlcik7XG4gIHByb21pc2UucmVtb3ZlTGlzdGVuZXIgPSBlbWl0dGVyLnJlbW92ZUxpc3RlbmVyLmJpbmQoZW1pdHRlcik7XG4gIHByb21pc2UucmVtb3ZlQWxsTGlzdGVuZXJzID0gZW1pdHRlci5yZW1vdmVBbGxMaXN0ZW5lcnMuYmluZChlbWl0dGVyKTtcbiAgcHJvbWlzZS5zZXRNYXhMaXN0ZW5lcnMgPSBlbWl0dGVyLnNldE1heExpc3RlbmVycy5iaW5kKGVtaXR0ZXIpO1xuICBwcm9taXNlLmxpc3RlbmVycyA9IGVtaXR0ZXIubGlzdGVuZXJzLmJpbmQoZW1pdHRlcik7XG4gIHByb21pc2UuZW1pdCA9IGVtaXR0ZXIuZW1pdC5iaW5kKGVtaXR0ZXIpO1xuICByZXR1cm4gcHJvbWlzZTtcbn07XG5cbmV4cG9ydHMuTUQ1ID0gZXhwb3J0cy50b1Byb21pc2UocmVxdWlyZSgnLi9kZXBzL21kNScpKTtcblxuLy8gZGVzaWduZWQgdG8gZ2l2ZSBpbmZvIHRvIGJyb3dzZXIgdXNlcnMsIHdobyBhcmUgZGlzdHVyYmVkXG4vLyB3aGVuIHRoZXkgc2VlIDQwNHMgaW4gdGhlIGNvbnNvbGVcbmV4cG9ydHMuZXhwbGFpbjQwNCA9IGZ1bmN0aW9uIChzdHIpIHtcbiAgaWYgKHByb2Nlc3MuYnJvd3NlciAmJiAnY29uc29sZScgaW4gZ2xvYmFsICYmICdpbmZvJyBpbiBjb25zb2xlKSB7XG4gICAgY29uc29sZS5pbmZvKCdUaGUgYWJvdmUgNDA0IGlzIHRvdGFsbHkgbm9ybWFsLiAnICsgc3RyKTtcbiAgfVxufTtcblxuZXhwb3J0cy5pbmZvID0gZnVuY3Rpb24gKHN0cikge1xuICBpZiAodHlwZW9mIGNvbnNvbGUgIT09ICd1bmRlZmluZWQnICYmICdpbmZvJyBpbiBjb25zb2xlKSB7XG4gICAgY29uc29sZS5pbmZvKHN0cik7XG4gIH1cbn07XG5cbmV4cG9ydHMucGFyc2VVcmkgPSByZXF1aXJlKCcuL2RlcHMvcGFyc2UtdXJpJyk7XG5cbmV4cG9ydHMuY29tcGFyZSA9IGZ1bmN0aW9uIChsZWZ0LCByaWdodCkge1xuICByZXR1cm4gbGVmdCA8IHJpZ2h0ID8gLTEgOiBsZWZ0ID4gcmlnaHQgPyAxIDogMDtcbn07XG5cbmV4cG9ydHMudXBkYXRlRG9jID0gZnVuY3Rpb24gdXBkYXRlRG9jKHByZXYsIGRvY0luZm8sIHJlc3VsdHMsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpLCBjYiwgd3JpdGVEb2MsIG5ld0VkaXRzKSB7XG5cbiAgaWYgKGV4cG9ydHMucmV2RXhpc3RzKHByZXYsIGRvY0luZm8ubWV0YWRhdGEucmV2KSkge1xuICAgIHJlc3VsdHNbaV0gPSBkb2NJbmZvO1xuICAgIHJldHVybiBjYigpO1xuICB9XG5cbiAgLy8gVE9ETzogc29tZSBvZiB0aGVzZSBjYW4gYmUgcHJlLWNhbGN1bGF0ZWQsIGJ1dCBpdCdzIHNhZmVyIHRvIGp1c3RcbiAgLy8gY2FsbCBtZXJnZS53aW5uaW5nUmV2KCkgYW5kIGV4cG9ydHMuaXNEZWxldGVkKCkgYWxsIG92ZXIgYWdhaW5cbiAgdmFyIHByZXZpb3VzV2lubmluZ1JldiA9IG1lcmdlLndpbm5pbmdSZXYocHJldik7XG4gIHZhciBwcmV2aW91c2x5RGVsZXRlZCA9IGV4cG9ydHMuaXNEZWxldGVkKHByZXYsIHByZXZpb3VzV2lubmluZ1Jldik7XG4gIHZhciBkZWxldGVkID0gZXhwb3J0cy5pc0RlbGV0ZWQoZG9jSW5mby5tZXRhZGF0YSk7XG4gIHZhciBpc1Jvb3QgPSAvXjEtLy50ZXN0KGRvY0luZm8ubWV0YWRhdGEucmV2KTtcblxuICBpZiAocHJldmlvdXNseURlbGV0ZWQgJiYgIWRlbGV0ZWQgJiYgbmV3RWRpdHMgJiYgaXNSb290KSB7XG4gICAgdmFyIG5ld0RvYyA9IGRvY0luZm8uZGF0YTtcbiAgICBuZXdEb2MuX3JldiA9IHByZXZpb3VzV2lubmluZ1JldjtcbiAgICBuZXdEb2MuX2lkID0gZG9jSW5mby5tZXRhZGF0YS5pZDtcbiAgICBkb2NJbmZvID0gZXhwb3J0cy5wYXJzZURvYyhuZXdEb2MsIG5ld0VkaXRzKTtcbiAgfVxuXG4gIHZhciBtZXJnZWQgPSBtZXJnZS5tZXJnZShwcmV2LnJldl90cmVlLCBkb2NJbmZvLm1ldGFkYXRhLnJldl90cmVlWzBdLCAxMDAwKTtcblxuICB2YXIgaW5Db25mbGljdCA9IG5ld0VkaXRzICYmICgoKHByZXZpb3VzbHlEZWxldGVkICYmIGRlbGV0ZWQpIHx8XG4gICAgKCFwcmV2aW91c2x5RGVsZXRlZCAmJiBtZXJnZWQuY29uZmxpY3RzICE9PSAnbmV3X2xlYWYnKSB8fFxuICAgIChwcmV2aW91c2x5RGVsZXRlZCAmJiAhZGVsZXRlZCAmJiBtZXJnZWQuY29uZmxpY3RzID09PSAnbmV3X2JyYW5jaCcpKSk7XG5cbiAgaWYgKGluQ29uZmxpY3QpIHtcbiAgICB2YXIgZXJyID0gZXJyb3JzLmVycm9yKGVycm9ycy5SRVZfQ09ORkxJQ1QpO1xuICAgIHJlc3VsdHNbaV0gPSBlcnI7XG4gICAgcmV0dXJuIGNiKCk7XG4gIH1cblxuICB2YXIgbmV3UmV2ID0gZG9jSW5mby5tZXRhZGF0YS5yZXY7XG4gIGRvY0luZm8ubWV0YWRhdGEucmV2X3RyZWUgPSBtZXJnZWQudHJlZTtcbiAgaWYgKHByZXYucmV2X21hcCkge1xuICAgIGRvY0luZm8ubWV0YWRhdGEucmV2X21hcCA9IHByZXYucmV2X21hcDsgLy8gdXNlZCBieSBsZXZlbGRiXG4gIH1cblxuICAvLyByZWNhbGN1bGF0ZVxuICB2YXIgd2lubmluZ1JldiA9IG1lcmdlLndpbm5pbmdSZXYoZG9jSW5mby5tZXRhZGF0YSk7XG4gIHZhciB3aW5uaW5nUmV2SXNEZWxldGVkID0gZXhwb3J0cy5pc0RlbGV0ZWQoZG9jSW5mby5tZXRhZGF0YSwgd2lubmluZ1Jldik7XG5cbiAgLy8gY2FsY3VsYXRlIHRoZSB0b3RhbCBudW1iZXIgb2YgZG9jdW1lbnRzIHRoYXQgd2VyZSBhZGRlZC9yZW1vdmVkLFxuICAvLyBmcm9tIHRoZSBwZXJzcGVjdGl2ZSBvZiB0b3RhbF9yb3dzL2RvY19jb3VudFxuICB2YXIgZGVsdGEgPSAocHJldmlvdXNseURlbGV0ZWQgPT09IHdpbm5pbmdSZXZJc0RlbGV0ZWQpID8gMCA6XG4gICAgICBwcmV2aW91c2x5RGVsZXRlZCA8IHdpbm5pbmdSZXZJc0RlbGV0ZWQgPyAtMSA6IDE7XG5cbiAgdmFyIG5ld1JldklzRGVsZXRlZCA9IGV4cG9ydHMuaXNEZWxldGVkKGRvY0luZm8ubWV0YWRhdGEsIG5ld1Jldik7XG5cbiAgd3JpdGVEb2MoZG9jSW5mbywgd2lubmluZ1Jldiwgd2lubmluZ1JldklzRGVsZXRlZCwgbmV3UmV2SXNEZWxldGVkLFxuICAgIHRydWUsIGRlbHRhLCBpLCBjYik7XG59O1xuXG5leHBvcnRzLnByb2Nlc3NEb2NzID0gZnVuY3Rpb24gcHJvY2Vzc0RvY3MoZG9jSW5mb3MsIGFwaSwgZmV0Y2hlZERvY3MsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdHgsIHJlc3VsdHMsIHdyaXRlRG9jLCBvcHRzLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG92ZXJhbGxDYWxsYmFjaykge1xuXG4gIGlmICghZG9jSW5mb3MubGVuZ3RoKSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgZnVuY3Rpb24gaW5zZXJ0RG9jKGRvY0luZm8sIHJlc3VsdHNJZHgsIGNhbGxiYWNrKSB7XG4gICAgLy8gQ2FudCBpbnNlcnQgbmV3IGRlbGV0ZWQgZG9jdW1lbnRzXG4gICAgdmFyIHdpbm5pbmdSZXYgPSBtZXJnZS53aW5uaW5nUmV2KGRvY0luZm8ubWV0YWRhdGEpO1xuICAgIHZhciBkZWxldGVkID0gZXhwb3J0cy5pc0RlbGV0ZWQoZG9jSW5mby5tZXRhZGF0YSwgd2lubmluZ1Jldik7XG4gICAgaWYgKCd3YXNfZGVsZXRlJyBpbiBvcHRzICYmIGRlbGV0ZWQpIHtcbiAgICAgIHJlc3VsdHNbcmVzdWx0c0lkeF0gPSBlcnJvcnMuZXJyb3IoZXJyb3JzLk1JU1NJTkdfRE9DLCAnZGVsZXRlZCcpO1xuICAgICAgcmV0dXJuIGNhbGxiYWNrKCk7XG4gICAgfVxuXG4gICAgdmFyIGRlbHRhID0gZGVsZXRlZCA/IDAgOiAxO1xuXG4gICAgd3JpdGVEb2MoZG9jSW5mbywgd2lubmluZ1JldiwgZGVsZXRlZCwgZGVsZXRlZCwgZmFsc2UsXG4gICAgICBkZWx0YSwgcmVzdWx0c0lkeCwgY2FsbGJhY2spO1xuICB9XG5cbiAgdmFyIG5ld0VkaXRzID0gb3B0cy5uZXdfZWRpdHM7XG4gIHZhciBpZHNUb0RvY3MgPSBuZXcgZXhwb3J0cy5NYXAoKTtcblxuICB2YXIgZG9jc0RvbmUgPSAwO1xuICB2YXIgZG9jc1RvRG8gPSBkb2NJbmZvcy5sZW5ndGg7XG5cbiAgZnVuY3Rpb24gY2hlY2tBbGxEb2NzRG9uZSgpIHtcbiAgICBpZiAoKytkb2NzRG9uZSA9PT0gZG9jc1RvRG8gJiYgb3ZlcmFsbENhbGxiYWNrKSB7XG4gICAgICBvdmVyYWxsQ2FsbGJhY2soKTtcbiAgICB9XG4gIH1cblxuICBkb2NJbmZvcy5mb3JFYWNoKGZ1bmN0aW9uIChjdXJyZW50RG9jLCByZXN1bHRzSWR4KSB7XG5cbiAgICBpZiAoY3VycmVudERvYy5faWQgJiYgZXhwb3J0cy5pc0xvY2FsSWQoY3VycmVudERvYy5faWQpKSB7XG4gICAgICBhcGlbY3VycmVudERvYy5fZGVsZXRlZCA/ICdfcmVtb3ZlTG9jYWwnIDogJ19wdXRMb2NhbCddKFxuICAgICAgICBjdXJyZW50RG9jLCB7Y3R4OiB0eH0sIGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgICAgICBpZiAoZXJyKSB7XG4gICAgICAgICAgICByZXN1bHRzW3Jlc3VsdHNJZHhdID0gZXJyO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByZXN1bHRzW3Jlc3VsdHNJZHhdID0ge29rOiB0cnVlfTtcbiAgICAgICAgICB9XG4gICAgICAgICAgY2hlY2tBbGxEb2NzRG9uZSgpO1xuICAgICAgICB9KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgaWQgPSBjdXJyZW50RG9jLm1ldGFkYXRhLmlkO1xuICAgIGlmIChpZHNUb0RvY3MuaGFzKGlkKSkge1xuICAgICAgZG9jc1RvRG8tLTsgLy8gZHVwbGljYXRlXG4gICAgICBpZHNUb0RvY3MuZ2V0KGlkKS5wdXNoKFtjdXJyZW50RG9jLCByZXN1bHRzSWR4XSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGlkc1RvRG9jcy5zZXQoaWQsIFtbY3VycmVudERvYywgcmVzdWx0c0lkeF1dKTtcbiAgICB9XG4gIH0pO1xuXG4gIC8vIGluIHRoZSBjYXNlIG9mIG5ld19lZGl0cywgdGhlIHVzZXIgY2FuIHByb3ZpZGUgbXVsdGlwbGUgZG9jc1xuICAvLyB3aXRoIHRoZSBzYW1lIGlkLiB0aGVzZSBuZWVkIHRvIGJlIHByb2Nlc3NlZCBzZXF1ZW50aWFsbHlcbiAgaWRzVG9Eb2NzLmZvckVhY2goZnVuY3Rpb24gKGRvY3MsIGlkKSB7XG4gICAgdmFyIG51bURvbmUgPSAwO1xuXG4gICAgZnVuY3Rpb24gZG9jV3JpdHRlbigpIHtcbiAgICAgIGlmICgrK251bURvbmUgPCBkb2NzLmxlbmd0aCkge1xuICAgICAgICBuZXh0RG9jKCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjaGVja0FsbERvY3NEb25lKCk7XG4gICAgICB9XG4gICAgfVxuICAgIGZ1bmN0aW9uIG5leHREb2MoKSB7XG4gICAgICB2YXIgdmFsdWUgPSBkb2NzW251bURvbmVdO1xuICAgICAgdmFyIGN1cnJlbnREb2MgPSB2YWx1ZVswXTtcbiAgICAgIHZhciByZXN1bHRzSWR4ID0gdmFsdWVbMV07XG5cbiAgICAgIGlmIChmZXRjaGVkRG9jcy5oYXMoaWQpKSB7XG4gICAgICAgIGV4cG9ydHMudXBkYXRlRG9jKGZldGNoZWREb2NzLmdldChpZCksIGN1cnJlbnREb2MsIHJlc3VsdHMsXG4gICAgICAgICAgcmVzdWx0c0lkeCwgZG9jV3JpdHRlbiwgd3JpdGVEb2MsIG5ld0VkaXRzKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGluc2VydERvYyhjdXJyZW50RG9jLCByZXN1bHRzSWR4LCBkb2NXcml0dGVuKTtcbiAgICAgIH1cbiAgICB9XG4gICAgbmV4dERvYygpO1xuICB9KTtcbn07XG5cbmV4cG9ydHMucHJlcHJvY2Vzc0F0dGFjaG1lbnRzID0gZnVuY3Rpb24gcHJlcHJvY2Vzc0F0dGFjaG1lbnRzKFxuICAgIGRvY0luZm9zLCBibG9iVHlwZSwgY2FsbGJhY2spIHtcblxuICBpZiAoIWRvY0luZm9zLmxlbmd0aCkge1xuICAgIHJldHVybiBjYWxsYmFjaygpO1xuICB9XG5cbiAgdmFyIGRvY3YgPSAwO1xuXG4gIGZ1bmN0aW9uIHBhcnNlQmFzZTY0KGRhdGEpIHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGV4cG9ydHMuYXRvYihkYXRhKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICB2YXIgZXJyID0gZXJyb3JzLmVycm9yKGVycm9ycy5CQURfQVJHLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnQXR0YWNobWVudHMgbmVlZCB0byBiZSBiYXNlNjQgZW5jb2RlZCcpO1xuICAgICAgcmV0dXJuIHtlcnJvcjogZXJyfTtcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBwcmVwcm9jZXNzQXR0YWNobWVudChhdHQsIGNhbGxiYWNrKSB7XG4gICAgaWYgKGF0dC5zdHViKSB7XG4gICAgICByZXR1cm4gY2FsbGJhY2soKTtcbiAgICB9XG4gICAgaWYgKHR5cGVvZiBhdHQuZGF0YSA9PT0gJ3N0cmluZycpIHtcbiAgICAgIC8vIGlucHV0IGlzIGEgYmFzZTY0IHN0cmluZ1xuXG4gICAgICB2YXIgYXNCaW5hcnkgPSBwYXJzZUJhc2U2NChhdHQuZGF0YSk7XG4gICAgICBpZiAoYXNCaW5hcnkuZXJyb3IpIHtcbiAgICAgICAgcmV0dXJuIGNhbGxiYWNrKGFzQmluYXJ5LmVycm9yKTtcbiAgICAgIH1cblxuICAgICAgYXR0Lmxlbmd0aCA9IGFzQmluYXJ5Lmxlbmd0aDtcbiAgICAgIGlmIChibG9iVHlwZSA9PT0gJ2Jsb2InKSB7XG4gICAgICAgIGF0dC5kYXRhID0gZXhwb3J0cy5jcmVhdGVCbG9iKFtleHBvcnRzLmZpeEJpbmFyeShhc0JpbmFyeSldLFxuICAgICAgICAgIHt0eXBlOiBhdHQuY29udGVudF90eXBlfSk7XG4gICAgICB9IGVsc2UgaWYgKGJsb2JUeXBlID09PSAnYmFzZTY0Jykge1xuICAgICAgICBhdHQuZGF0YSA9IGV4cG9ydHMuYnRvYShhc0JpbmFyeSk7XG4gICAgICB9IGVsc2UgeyAvLyBiaW5hcnlcbiAgICAgICAgYXR0LmRhdGEgPSBhc0JpbmFyeTtcbiAgICAgIH1cbiAgICAgIGV4cG9ydHMuTUQ1KGFzQmluYXJ5KS50aGVuKGZ1bmN0aW9uIChyZXN1bHQpIHtcbiAgICAgICAgYXR0LmRpZ2VzdCA9ICdtZDUtJyArIHJlc3VsdDtcbiAgICAgICAgY2FsbGJhY2soKTtcbiAgICAgIH0pO1xuICAgIH0gZWxzZSB7IC8vIGlucHV0IGlzIGEgYmxvYlxuICAgICAgZXhwb3J0cy5yZWFkQXNBcnJheUJ1ZmZlcihhdHQuZGF0YSwgZnVuY3Rpb24gKGJ1ZmYpIHtcbiAgICAgICAgaWYgKGJsb2JUeXBlID09PSAnYmluYXJ5Jykge1xuICAgICAgICAgIGF0dC5kYXRhID0gZXhwb3J0cy5hcnJheUJ1ZmZlclRvQmluYXJ5U3RyaW5nKGJ1ZmYpO1xuICAgICAgICB9IGVsc2UgaWYgKGJsb2JUeXBlID09PSAnYmFzZTY0Jykge1xuICAgICAgICAgIGF0dC5kYXRhID0gZXhwb3J0cy5idG9hKGV4cG9ydHMuYXJyYXlCdWZmZXJUb0JpbmFyeVN0cmluZyhidWZmKSk7XG4gICAgICAgIH1cbiAgICAgICAgZXhwb3J0cy5NRDUoYnVmZikudGhlbihmdW5jdGlvbiAocmVzdWx0KSB7XG4gICAgICAgICAgYXR0LmRpZ2VzdCA9ICdtZDUtJyArIHJlc3VsdDtcbiAgICAgICAgICBhdHQubGVuZ3RoID0gYnVmZi5ieXRlTGVuZ3RoO1xuICAgICAgICAgIGNhbGxiYWNrKCk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgdmFyIG92ZXJhbGxFcnI7XG5cbiAgZG9jSW5mb3MuZm9yRWFjaChmdW5jdGlvbiAoZG9jSW5mbykge1xuICAgIHZhciBhdHRhY2htZW50cyA9IGRvY0luZm8uZGF0YSAmJiBkb2NJbmZvLmRhdGEuX2F0dGFjaG1lbnRzID9cbiAgICAgIE9iamVjdC5rZXlzKGRvY0luZm8uZGF0YS5fYXR0YWNobWVudHMpIDogW107XG4gICAgdmFyIHJlY3YgPSAwO1xuXG4gICAgaWYgKCFhdHRhY2htZW50cy5sZW5ndGgpIHtcbiAgICAgIHJldHVybiBkb25lKCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcHJvY2Vzc2VkQXR0YWNobWVudChlcnIpIHtcbiAgICAgIG92ZXJhbGxFcnIgPSBlcnI7XG4gICAgICByZWN2Kys7XG4gICAgICBpZiAocmVjdiA9PT0gYXR0YWNobWVudHMubGVuZ3RoKSB7XG4gICAgICAgIGRvbmUoKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBmb3IgKHZhciBrZXkgaW4gZG9jSW5mby5kYXRhLl9hdHRhY2htZW50cykge1xuICAgICAgaWYgKGRvY0luZm8uZGF0YS5fYXR0YWNobWVudHMuaGFzT3duUHJvcGVydHkoa2V5KSkge1xuICAgICAgICBwcmVwcm9jZXNzQXR0YWNobWVudChkb2NJbmZvLmRhdGEuX2F0dGFjaG1lbnRzW2tleV0sXG4gICAgICAgICAgcHJvY2Vzc2VkQXR0YWNobWVudCk7XG4gICAgICB9XG4gICAgfVxuICB9KTtcblxuICBmdW5jdGlvbiBkb25lKCkge1xuICAgIGRvY3YrKztcbiAgICBpZiAoZG9jSW5mb3MubGVuZ3RoID09PSBkb2N2KSB7XG4gICAgICBpZiAob3ZlcmFsbEVycikge1xuICAgICAgICBjYWxsYmFjayhvdmVyYWxsRXJyKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNhbGxiYWNrKCk7XG4gICAgICB9XG4gICAgfVxuICB9XG59O1xuXG4vLyBjb21wYWN0IGEgdHJlZSBieSBtYXJraW5nIGl0cyBub24tbGVhZnMgYXMgbWlzc2luZyxcbi8vIGFuZCByZXR1cm4gYSBsaXN0IG9mIHJldnMgdG8gZGVsZXRlXG5leHBvcnRzLmNvbXBhY3RUcmVlID0gZnVuY3Rpb24gY29tcGFjdFRyZWUobWV0YWRhdGEpIHtcbiAgdmFyIHJldnMgPSBbXTtcbiAgbWVyZ2UudHJhdmVyc2VSZXZUcmVlKG1ldGFkYXRhLnJldl90cmVlLCBmdW5jdGlvbiAoaXNMZWFmLCBwb3MsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldkhhc2gsIGN0eCwgb3B0cykge1xuICAgIGlmIChvcHRzLnN0YXR1cyA9PT0gJ2F2YWlsYWJsZScgJiYgIWlzTGVhZikge1xuICAgICAgcmV2cy5wdXNoKHBvcyArICctJyArIHJldkhhc2gpO1xuICAgICAgb3B0cy5zdGF0dXMgPSAnbWlzc2luZyc7XG4gICAgfVxuICB9KTtcbiAgcmV0dXJuIHJldnM7XG59O1xuXG52YXIgdnV2dXplbGEgPSByZXF1aXJlKCd2dXZ1emVsYScpO1xuXG5leHBvcnRzLnNhZmVKc29uUGFyc2UgPSBmdW5jdGlvbiBzYWZlSnNvblBhcnNlKHN0cikge1xuICB0cnkge1xuICAgIHJldHVybiBKU09OLnBhcnNlKHN0cik7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICByZXR1cm4gdnV2dXplbGEucGFyc2Uoc3RyKTtcbiAgfVxufTtcblxuZXhwb3J0cy5zYWZlSnNvblN0cmluZ2lmeSA9IGZ1bmN0aW9uIHNhZmVKc29uU3RyaW5naWZ5KGpzb24pIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkoanNvbik7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICByZXR1cm4gdnV2dXplbGEuc3RyaW5naWZ5KGpzb24pO1xuICB9XG59O1xuIiwibW9kdWxlLmV4cG9ydHMgPSBcIjMuNC4wXCI7XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gYXJnc0FycmF5O1xuXG5mdW5jdGlvbiBhcmdzQXJyYXkoZnVuKSB7XG4gIHJldHVybiBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIGxlbiA9IGFyZ3VtZW50cy5sZW5ndGg7XG4gICAgaWYgKGxlbikge1xuICAgICAgdmFyIGFyZ3MgPSBbXTtcbiAgICAgIHZhciBpID0gLTE7XG4gICAgICB3aGlsZSAoKytpIDwgbGVuKSB7XG4gICAgICAgIGFyZ3NbaV0gPSBhcmd1bWVudHNbaV07XG4gICAgICB9XG4gICAgICByZXR1cm4gZnVuLmNhbGwodGhpcywgYXJncyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiBmdW4uY2FsbCh0aGlzLCBbXSk7XG4gICAgfVxuICB9O1xufSIsIlxuLyoqXG4gKiBUaGlzIGlzIHRoZSB3ZWIgYnJvd3NlciBpbXBsZW1lbnRhdGlvbiBvZiBgZGVidWcoKWAuXG4gKlxuICogRXhwb3NlIGBkZWJ1ZygpYCBhcyB0aGUgbW9kdWxlLlxuICovXG5cbmV4cG9ydHMgPSBtb2R1bGUuZXhwb3J0cyA9IHJlcXVpcmUoJy4vZGVidWcnKTtcbmV4cG9ydHMubG9nID0gbG9nO1xuZXhwb3J0cy5mb3JtYXRBcmdzID0gZm9ybWF0QXJncztcbmV4cG9ydHMuc2F2ZSA9IHNhdmU7XG5leHBvcnRzLmxvYWQgPSBsb2FkO1xuZXhwb3J0cy51c2VDb2xvcnMgPSB1c2VDb2xvcnM7XG5cbi8qKlxuICogVXNlIGNocm9tZS5zdG9yYWdlLmxvY2FsIGlmIHdlIGFyZSBpbiBhbiBhcHBcbiAqL1xuXG52YXIgc3RvcmFnZTtcblxuaWYgKHR5cGVvZiBjaHJvbWUgIT09ICd1bmRlZmluZWQnICYmIHR5cGVvZiBjaHJvbWUuc3RvcmFnZSAhPT0gJ3VuZGVmaW5lZCcpXG4gIHN0b3JhZ2UgPSBjaHJvbWUuc3RvcmFnZS5sb2NhbDtcbmVsc2VcbiAgc3RvcmFnZSA9IGxvY2Fsc3RvcmFnZSgpO1xuXG4vKipcbiAqIENvbG9ycy5cbiAqL1xuXG5leHBvcnRzLmNvbG9ycyA9IFtcbiAgJ2xpZ2h0c2VhZ3JlZW4nLFxuICAnZm9yZXN0Z3JlZW4nLFxuICAnZ29sZGVucm9kJyxcbiAgJ2RvZGdlcmJsdWUnLFxuICAnZGFya29yY2hpZCcsXG4gICdjcmltc29uJ1xuXTtcblxuLyoqXG4gKiBDdXJyZW50bHkgb25seSBXZWJLaXQtYmFzZWQgV2ViIEluc3BlY3RvcnMsIEZpcmVmb3ggPj0gdjMxLFxuICogYW5kIHRoZSBGaXJlYnVnIGV4dGVuc2lvbiAoYW55IEZpcmVmb3ggdmVyc2lvbikgYXJlIGtub3duXG4gKiB0byBzdXBwb3J0IFwiJWNcIiBDU1MgY3VzdG9taXphdGlvbnMuXG4gKlxuICogVE9ETzogYWRkIGEgYGxvY2FsU3RvcmFnZWAgdmFyaWFibGUgdG8gZXhwbGljaXRseSBlbmFibGUvZGlzYWJsZSBjb2xvcnNcbiAqL1xuXG5mdW5jdGlvbiB1c2VDb2xvcnMoKSB7XG4gIC8vIGlzIHdlYmtpdD8gaHR0cDovL3N0YWNrb3ZlcmZsb3cuY29tL2EvMTY0NTk2MDYvMzc2NzczXG4gIHJldHVybiAoJ1dlYmtpdEFwcGVhcmFuY2UnIGluIGRvY3VtZW50LmRvY3VtZW50RWxlbWVudC5zdHlsZSkgfHxcbiAgICAvLyBpcyBmaXJlYnVnPyBodHRwOi8vc3RhY2tvdmVyZmxvdy5jb20vYS8zOTgxMjAvMzc2NzczXG4gICAgKHdpbmRvdy5jb25zb2xlICYmIChjb25zb2xlLmZpcmVidWcgfHwgKGNvbnNvbGUuZXhjZXB0aW9uICYmIGNvbnNvbGUudGFibGUpKSkgfHxcbiAgICAvLyBpcyBmaXJlZm94ID49IHYzMT9cbiAgICAvLyBodHRwczovL2RldmVsb3Blci5tb3ppbGxhLm9yZy9lbi1VUy9kb2NzL1Rvb2xzL1dlYl9Db25zb2xlI1N0eWxpbmdfbWVzc2FnZXNcbiAgICAobmF2aWdhdG9yLnVzZXJBZ2VudC50b0xvd2VyQ2FzZSgpLm1hdGNoKC9maXJlZm94XFwvKFxcZCspLykgJiYgcGFyc2VJbnQoUmVnRXhwLiQxLCAxMCkgPj0gMzEpO1xufVxuXG4vKipcbiAqIE1hcCAlaiB0byBgSlNPTi5zdHJpbmdpZnkoKWAsIHNpbmNlIG5vIFdlYiBJbnNwZWN0b3JzIGRvIHRoYXQgYnkgZGVmYXVsdC5cbiAqL1xuXG5leHBvcnRzLmZvcm1hdHRlcnMuaiA9IGZ1bmN0aW9uKHYpIHtcbiAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KHYpO1xufTtcblxuXG4vKipcbiAqIENvbG9yaXplIGxvZyBhcmd1bWVudHMgaWYgZW5hYmxlZC5cbiAqXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbmZ1bmN0aW9uIGZvcm1hdEFyZ3MoKSB7XG4gIHZhciBhcmdzID0gYXJndW1lbnRzO1xuICB2YXIgdXNlQ29sb3JzID0gdGhpcy51c2VDb2xvcnM7XG5cbiAgYXJnc1swXSA9ICh1c2VDb2xvcnMgPyAnJWMnIDogJycpXG4gICAgKyB0aGlzLm5hbWVzcGFjZVxuICAgICsgKHVzZUNvbG9ycyA/ICcgJWMnIDogJyAnKVxuICAgICsgYXJnc1swXVxuICAgICsgKHVzZUNvbG9ycyA/ICclYyAnIDogJyAnKVxuICAgICsgJysnICsgZXhwb3J0cy5odW1hbml6ZSh0aGlzLmRpZmYpO1xuXG4gIGlmICghdXNlQ29sb3JzKSByZXR1cm4gYXJncztcblxuICB2YXIgYyA9ICdjb2xvcjogJyArIHRoaXMuY29sb3I7XG4gIGFyZ3MgPSBbYXJnc1swXSwgYywgJ2NvbG9yOiBpbmhlcml0J10uY29uY2F0KEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3MsIDEpKTtcblxuICAvLyB0aGUgZmluYWwgXCIlY1wiIGlzIHNvbWV3aGF0IHRyaWNreSwgYmVjYXVzZSB0aGVyZSBjb3VsZCBiZSBvdGhlclxuICAvLyBhcmd1bWVudHMgcGFzc2VkIGVpdGhlciBiZWZvcmUgb3IgYWZ0ZXIgdGhlICVjLCBzbyB3ZSBuZWVkIHRvXG4gIC8vIGZpZ3VyZSBvdXQgdGhlIGNvcnJlY3QgaW5kZXggdG8gaW5zZXJ0IHRoZSBDU1MgaW50b1xuICB2YXIgaW5kZXggPSAwO1xuICB2YXIgbGFzdEMgPSAwO1xuICBhcmdzWzBdLnJlcGxhY2UoLyVbYS16JV0vZywgZnVuY3Rpb24obWF0Y2gpIHtcbiAgICBpZiAoJyUlJyA9PT0gbWF0Y2gpIHJldHVybjtcbiAgICBpbmRleCsrO1xuICAgIGlmICgnJWMnID09PSBtYXRjaCkge1xuICAgICAgLy8gd2Ugb25seSBhcmUgaW50ZXJlc3RlZCBpbiB0aGUgKmxhc3QqICVjXG4gICAgICAvLyAodGhlIHVzZXIgbWF5IGhhdmUgcHJvdmlkZWQgdGhlaXIgb3duKVxuICAgICAgbGFzdEMgPSBpbmRleDtcbiAgICB9XG4gIH0pO1xuXG4gIGFyZ3Muc3BsaWNlKGxhc3RDLCAwLCBjKTtcbiAgcmV0dXJuIGFyZ3M7XG59XG5cbi8qKlxuICogSW52b2tlcyBgY29uc29sZS5sb2coKWAgd2hlbiBhdmFpbGFibGUuXG4gKiBOby1vcCB3aGVuIGBjb25zb2xlLmxvZ2AgaXMgbm90IGEgXCJmdW5jdGlvblwiLlxuICpcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuZnVuY3Rpb24gbG9nKCkge1xuICAvLyB0aGlzIGhhY2tlcnkgaXMgcmVxdWlyZWQgZm9yIElFOC85LCB3aGVyZVxuICAvLyB0aGUgYGNvbnNvbGUubG9nYCBmdW5jdGlvbiBkb2Vzbid0IGhhdmUgJ2FwcGx5J1xuICByZXR1cm4gJ29iamVjdCcgPT09IHR5cGVvZiBjb25zb2xlXG4gICAgJiYgY29uc29sZS5sb2dcbiAgICAmJiBGdW5jdGlvbi5wcm90b3R5cGUuYXBwbHkuY2FsbChjb25zb2xlLmxvZywgY29uc29sZSwgYXJndW1lbnRzKTtcbn1cblxuLyoqXG4gKiBTYXZlIGBuYW1lc3BhY2VzYC5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gbmFtZXNwYWNlc1xuICogQGFwaSBwcml2YXRlXG4gKi9cblxuZnVuY3Rpb24gc2F2ZShuYW1lc3BhY2VzKSB7XG4gIHRyeSB7XG4gICAgaWYgKG51bGwgPT0gbmFtZXNwYWNlcykge1xuICAgICAgc3RvcmFnZS5yZW1vdmVJdGVtKCdkZWJ1ZycpO1xuICAgIH0gZWxzZSB7XG4gICAgICBzdG9yYWdlLmRlYnVnID0gbmFtZXNwYWNlcztcbiAgICB9XG4gIH0gY2F0Y2goZSkge31cbn1cblxuLyoqXG4gKiBMb2FkIGBuYW1lc3BhY2VzYC5cbiAqXG4gKiBAcmV0dXJuIHtTdHJpbmd9IHJldHVybnMgdGhlIHByZXZpb3VzbHkgcGVyc2lzdGVkIGRlYnVnIG1vZGVzXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5mdW5jdGlvbiBsb2FkKCkge1xuICB2YXIgcjtcbiAgdHJ5IHtcbiAgICByID0gc3RvcmFnZS5kZWJ1ZztcbiAgfSBjYXRjaChlKSB7fVxuICByZXR1cm4gcjtcbn1cblxuLyoqXG4gKiBFbmFibGUgbmFtZXNwYWNlcyBsaXN0ZWQgaW4gYGxvY2FsU3RvcmFnZS5kZWJ1Z2AgaW5pdGlhbGx5LlxuICovXG5cbmV4cG9ydHMuZW5hYmxlKGxvYWQoKSk7XG5cbi8qKlxuICogTG9jYWxzdG9yYWdlIGF0dGVtcHRzIHRvIHJldHVybiB0aGUgbG9jYWxzdG9yYWdlLlxuICpcbiAqIFRoaXMgaXMgbmVjZXNzYXJ5IGJlY2F1c2Ugc2FmYXJpIHRocm93c1xuICogd2hlbiBhIHVzZXIgZGlzYWJsZXMgY29va2llcy9sb2NhbHN0b3JhZ2VcbiAqIGFuZCB5b3UgYXR0ZW1wdCB0byBhY2Nlc3MgaXQuXG4gKlxuICogQHJldHVybiB7TG9jYWxTdG9yYWdlfVxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuZnVuY3Rpb24gbG9jYWxzdG9yYWdlKCl7XG4gIHRyeSB7XG4gICAgcmV0dXJuIHdpbmRvdy5sb2NhbFN0b3JhZ2U7XG4gIH0gY2F0Y2ggKGUpIHt9XG59XG4iLCJcbi8qKlxuICogVGhpcyBpcyB0aGUgY29tbW9uIGxvZ2ljIGZvciBib3RoIHRoZSBOb2RlLmpzIGFuZCB3ZWIgYnJvd3NlclxuICogaW1wbGVtZW50YXRpb25zIG9mIGBkZWJ1ZygpYC5cbiAqXG4gKiBFeHBvc2UgYGRlYnVnKClgIGFzIHRoZSBtb2R1bGUuXG4gKi9cblxuZXhwb3J0cyA9IG1vZHVsZS5leHBvcnRzID0gZGVidWc7XG5leHBvcnRzLmNvZXJjZSA9IGNvZXJjZTtcbmV4cG9ydHMuZGlzYWJsZSA9IGRpc2FibGU7XG5leHBvcnRzLmVuYWJsZSA9IGVuYWJsZTtcbmV4cG9ydHMuZW5hYmxlZCA9IGVuYWJsZWQ7XG5leHBvcnRzLmh1bWFuaXplID0gcmVxdWlyZSgnbXMnKTtcblxuLyoqXG4gKiBUaGUgY3VycmVudGx5IGFjdGl2ZSBkZWJ1ZyBtb2RlIG5hbWVzLCBhbmQgbmFtZXMgdG8gc2tpcC5cbiAqL1xuXG5leHBvcnRzLm5hbWVzID0gW107XG5leHBvcnRzLnNraXBzID0gW107XG5cbi8qKlxuICogTWFwIG9mIHNwZWNpYWwgXCIlblwiIGhhbmRsaW5nIGZ1bmN0aW9ucywgZm9yIHRoZSBkZWJ1ZyBcImZvcm1hdFwiIGFyZ3VtZW50LlxuICpcbiAqIFZhbGlkIGtleSBuYW1lcyBhcmUgYSBzaW5nbGUsIGxvd2VyY2FzZWQgbGV0dGVyLCBpLmUuIFwiblwiLlxuICovXG5cbmV4cG9ydHMuZm9ybWF0dGVycyA9IHt9O1xuXG4vKipcbiAqIFByZXZpb3VzbHkgYXNzaWduZWQgY29sb3IuXG4gKi9cblxudmFyIHByZXZDb2xvciA9IDA7XG5cbi8qKlxuICogUHJldmlvdXMgbG9nIHRpbWVzdGFtcC5cbiAqL1xuXG52YXIgcHJldlRpbWU7XG5cbi8qKlxuICogU2VsZWN0IGEgY29sb3IuXG4gKlxuICogQHJldHVybiB7TnVtYmVyfVxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuZnVuY3Rpb24gc2VsZWN0Q29sb3IoKSB7XG4gIHJldHVybiBleHBvcnRzLmNvbG9yc1twcmV2Q29sb3IrKyAlIGV4cG9ydHMuY29sb3JzLmxlbmd0aF07XG59XG5cbi8qKlxuICogQ3JlYXRlIGEgZGVidWdnZXIgd2l0aCB0aGUgZ2l2ZW4gYG5hbWVzcGFjZWAuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IG5hbWVzcGFjZVxuICogQHJldHVybiB7RnVuY3Rpb259XG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbmZ1bmN0aW9uIGRlYnVnKG5hbWVzcGFjZSkge1xuXG4gIC8vIGRlZmluZSB0aGUgYGRpc2FibGVkYCB2ZXJzaW9uXG4gIGZ1bmN0aW9uIGRpc2FibGVkKCkge1xuICB9XG4gIGRpc2FibGVkLmVuYWJsZWQgPSBmYWxzZTtcblxuICAvLyBkZWZpbmUgdGhlIGBlbmFibGVkYCB2ZXJzaW9uXG4gIGZ1bmN0aW9uIGVuYWJsZWQoKSB7XG5cbiAgICB2YXIgc2VsZiA9IGVuYWJsZWQ7XG5cbiAgICAvLyBzZXQgYGRpZmZgIHRpbWVzdGFtcFxuICAgIHZhciBjdXJyID0gK25ldyBEYXRlKCk7XG4gICAgdmFyIG1zID0gY3VyciAtIChwcmV2VGltZSB8fCBjdXJyKTtcbiAgICBzZWxmLmRpZmYgPSBtcztcbiAgICBzZWxmLnByZXYgPSBwcmV2VGltZTtcbiAgICBzZWxmLmN1cnIgPSBjdXJyO1xuICAgIHByZXZUaW1lID0gY3VycjtcblxuICAgIC8vIGFkZCB0aGUgYGNvbG9yYCBpZiBub3Qgc2V0XG4gICAgaWYgKG51bGwgPT0gc2VsZi51c2VDb2xvcnMpIHNlbGYudXNlQ29sb3JzID0gZXhwb3J0cy51c2VDb2xvcnMoKTtcbiAgICBpZiAobnVsbCA9PSBzZWxmLmNvbG9yICYmIHNlbGYudXNlQ29sb3JzKSBzZWxmLmNvbG9yID0gc2VsZWN0Q29sb3IoKTtcblxuICAgIHZhciBhcmdzID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzKTtcblxuICAgIGFyZ3NbMF0gPSBleHBvcnRzLmNvZXJjZShhcmdzWzBdKTtcblxuICAgIGlmICgnc3RyaW5nJyAhPT0gdHlwZW9mIGFyZ3NbMF0pIHtcbiAgICAgIC8vIGFueXRoaW5nIGVsc2UgbGV0J3MgaW5zcGVjdCB3aXRoICVvXG4gICAgICBhcmdzID0gWyclbyddLmNvbmNhdChhcmdzKTtcbiAgICB9XG5cbiAgICAvLyBhcHBseSBhbnkgYGZvcm1hdHRlcnNgIHRyYW5zZm9ybWF0aW9uc1xuICAgIHZhciBpbmRleCA9IDA7XG4gICAgYXJnc1swXSA9IGFyZ3NbMF0ucmVwbGFjZSgvJShbYS16JV0pL2csIGZ1bmN0aW9uKG1hdGNoLCBmb3JtYXQpIHtcbiAgICAgIC8vIGlmIHdlIGVuY291bnRlciBhbiBlc2NhcGVkICUgdGhlbiBkb24ndCBpbmNyZWFzZSB0aGUgYXJyYXkgaW5kZXhcbiAgICAgIGlmIChtYXRjaCA9PT0gJyUlJykgcmV0dXJuIG1hdGNoO1xuICAgICAgaW5kZXgrKztcbiAgICAgIHZhciBmb3JtYXR0ZXIgPSBleHBvcnRzLmZvcm1hdHRlcnNbZm9ybWF0XTtcbiAgICAgIGlmICgnZnVuY3Rpb24nID09PSB0eXBlb2YgZm9ybWF0dGVyKSB7XG4gICAgICAgIHZhciB2YWwgPSBhcmdzW2luZGV4XTtcbiAgICAgICAgbWF0Y2ggPSBmb3JtYXR0ZXIuY2FsbChzZWxmLCB2YWwpO1xuXG4gICAgICAgIC8vIG5vdyB3ZSBuZWVkIHRvIHJlbW92ZSBgYXJnc1tpbmRleF1gIHNpbmNlIGl0J3MgaW5saW5lZCBpbiB0aGUgYGZvcm1hdGBcbiAgICAgICAgYXJncy5zcGxpY2UoaW5kZXgsIDEpO1xuICAgICAgICBpbmRleC0tO1xuICAgICAgfVxuICAgICAgcmV0dXJuIG1hdGNoO1xuICAgIH0pO1xuXG4gICAgaWYgKCdmdW5jdGlvbicgPT09IHR5cGVvZiBleHBvcnRzLmZvcm1hdEFyZ3MpIHtcbiAgICAgIGFyZ3MgPSBleHBvcnRzLmZvcm1hdEFyZ3MuYXBwbHkoc2VsZiwgYXJncyk7XG4gICAgfVxuICAgIHZhciBsb2dGbiA9IGVuYWJsZWQubG9nIHx8IGV4cG9ydHMubG9nIHx8IGNvbnNvbGUubG9nLmJpbmQoY29uc29sZSk7XG4gICAgbG9nRm4uYXBwbHkoc2VsZiwgYXJncyk7XG4gIH1cbiAgZW5hYmxlZC5lbmFibGVkID0gdHJ1ZTtcblxuICB2YXIgZm4gPSBleHBvcnRzLmVuYWJsZWQobmFtZXNwYWNlKSA/IGVuYWJsZWQgOiBkaXNhYmxlZDtcblxuICBmbi5uYW1lc3BhY2UgPSBuYW1lc3BhY2U7XG5cbiAgcmV0dXJuIGZuO1xufVxuXG4vKipcbiAqIEVuYWJsZXMgYSBkZWJ1ZyBtb2RlIGJ5IG5hbWVzcGFjZXMuIFRoaXMgY2FuIGluY2x1ZGUgbW9kZXNcbiAqIHNlcGFyYXRlZCBieSBhIGNvbG9uIGFuZCB3aWxkY2FyZHMuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IG5hbWVzcGFjZXNcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuZnVuY3Rpb24gZW5hYmxlKG5hbWVzcGFjZXMpIHtcbiAgZXhwb3J0cy5zYXZlKG5hbWVzcGFjZXMpO1xuXG4gIHZhciBzcGxpdCA9IChuYW1lc3BhY2VzIHx8ICcnKS5zcGxpdCgvW1xccyxdKy8pO1xuICB2YXIgbGVuID0gc3BsaXQubGVuZ3RoO1xuXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuOyBpKyspIHtcbiAgICBpZiAoIXNwbGl0W2ldKSBjb250aW51ZTsgLy8gaWdub3JlIGVtcHR5IHN0cmluZ3NcbiAgICBuYW1lc3BhY2VzID0gc3BsaXRbaV0ucmVwbGFjZSgvXFwqL2csICcuKj8nKTtcbiAgICBpZiAobmFtZXNwYWNlc1swXSA9PT0gJy0nKSB7XG4gICAgICBleHBvcnRzLnNraXBzLnB1c2gobmV3IFJlZ0V4cCgnXicgKyBuYW1lc3BhY2VzLnN1YnN0cigxKSArICckJykpO1xuICAgIH0gZWxzZSB7XG4gICAgICBleHBvcnRzLm5hbWVzLnB1c2gobmV3IFJlZ0V4cCgnXicgKyBuYW1lc3BhY2VzICsgJyQnKSk7XG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogRGlzYWJsZSBkZWJ1ZyBvdXRwdXQuXG4gKlxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5mdW5jdGlvbiBkaXNhYmxlKCkge1xuICBleHBvcnRzLmVuYWJsZSgnJyk7XG59XG5cbi8qKlxuICogUmV0dXJucyB0cnVlIGlmIHRoZSBnaXZlbiBtb2RlIG5hbWUgaXMgZW5hYmxlZCwgZmFsc2Ugb3RoZXJ3aXNlLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBuYW1lXG4gKiBAcmV0dXJuIHtCb29sZWFufVxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5mdW5jdGlvbiBlbmFibGVkKG5hbWUpIHtcbiAgdmFyIGksIGxlbjtcbiAgZm9yIChpID0gMCwgbGVuID0gZXhwb3J0cy5za2lwcy5sZW5ndGg7IGkgPCBsZW47IGkrKykge1xuICAgIGlmIChleHBvcnRzLnNraXBzW2ldLnRlc3QobmFtZSkpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH1cbiAgZm9yIChpID0gMCwgbGVuID0gZXhwb3J0cy5uYW1lcy5sZW5ndGg7IGkgPCBsZW47IGkrKykge1xuICAgIGlmIChleHBvcnRzLm5hbWVzW2ldLnRlc3QobmFtZSkpIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbi8qKlxuICogQ29lcmNlIGB2YWxgLlxuICpcbiAqIEBwYXJhbSB7TWl4ZWR9IHZhbFxuICogQHJldHVybiB7TWl4ZWR9XG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5mdW5jdGlvbiBjb2VyY2UodmFsKSB7XG4gIGlmICh2YWwgaW5zdGFuY2VvZiBFcnJvcikgcmV0dXJuIHZhbC5zdGFjayB8fCB2YWwubWVzc2FnZTtcbiAgcmV0dXJuIHZhbDtcbn1cbiIsIi8qKlxuICogSGVscGVycy5cbiAqL1xuXG52YXIgcyA9IDEwMDA7XG52YXIgbSA9IHMgKiA2MDtcbnZhciBoID0gbSAqIDYwO1xudmFyIGQgPSBoICogMjQ7XG52YXIgeSA9IGQgKiAzNjUuMjU7XG5cbi8qKlxuICogUGFyc2Ugb3IgZm9ybWF0IHRoZSBnaXZlbiBgdmFsYC5cbiAqXG4gKiBPcHRpb25zOlxuICpcbiAqICAtIGBsb25nYCB2ZXJib3NlIGZvcm1hdHRpbmcgW2ZhbHNlXVxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfE51bWJlcn0gdmFsXG4gKiBAcGFyYW0ge09iamVjdH0gb3B0aW9uc1xuICogQHJldHVybiB7U3RyaW5nfE51bWJlcn1cbiAqIEBhcGkgcHVibGljXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbih2YWwsIG9wdGlvbnMpe1xuICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcbiAgaWYgKCdzdHJpbmcnID09IHR5cGVvZiB2YWwpIHJldHVybiBwYXJzZSh2YWwpO1xuICByZXR1cm4gb3B0aW9ucy5sb25nXG4gICAgPyBsb25nKHZhbClcbiAgICA6IHNob3J0KHZhbCk7XG59O1xuXG4vKipcbiAqIFBhcnNlIHRoZSBnaXZlbiBgc3RyYCBhbmQgcmV0dXJuIG1pbGxpc2Vjb25kcy5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gc3RyXG4gKiBAcmV0dXJuIHtOdW1iZXJ9XG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5mdW5jdGlvbiBwYXJzZShzdHIpIHtcbiAgdmFyIG1hdGNoID0gL14oKD86XFxkKyk/XFwuP1xcZCspICoobWlsbGlzZWNvbmRzP3xtc2Vjcz98bXN8c2Vjb25kcz98c2Vjcz98c3xtaW51dGVzP3xtaW5zP3xtfGhvdXJzP3xocnM/fGh8ZGF5cz98ZHx5ZWFycz98eXJzP3x5KT8kL2kuZXhlYyhzdHIpO1xuICBpZiAoIW1hdGNoKSByZXR1cm47XG4gIHZhciBuID0gcGFyc2VGbG9hdChtYXRjaFsxXSk7XG4gIHZhciB0eXBlID0gKG1hdGNoWzJdIHx8ICdtcycpLnRvTG93ZXJDYXNlKCk7XG4gIHN3aXRjaCAodHlwZSkge1xuICAgIGNhc2UgJ3llYXJzJzpcbiAgICBjYXNlICd5ZWFyJzpcbiAgICBjYXNlICd5cnMnOlxuICAgIGNhc2UgJ3lyJzpcbiAgICBjYXNlICd5JzpcbiAgICAgIHJldHVybiBuICogeTtcbiAgICBjYXNlICdkYXlzJzpcbiAgICBjYXNlICdkYXknOlxuICAgIGNhc2UgJ2QnOlxuICAgICAgcmV0dXJuIG4gKiBkO1xuICAgIGNhc2UgJ2hvdXJzJzpcbiAgICBjYXNlICdob3VyJzpcbiAgICBjYXNlICdocnMnOlxuICAgIGNhc2UgJ2hyJzpcbiAgICBjYXNlICdoJzpcbiAgICAgIHJldHVybiBuICogaDtcbiAgICBjYXNlICdtaW51dGVzJzpcbiAgICBjYXNlICdtaW51dGUnOlxuICAgIGNhc2UgJ21pbnMnOlxuICAgIGNhc2UgJ21pbic6XG4gICAgY2FzZSAnbSc6XG4gICAgICByZXR1cm4gbiAqIG07XG4gICAgY2FzZSAnc2Vjb25kcyc6XG4gICAgY2FzZSAnc2Vjb25kJzpcbiAgICBjYXNlICdzZWNzJzpcbiAgICBjYXNlICdzZWMnOlxuICAgIGNhc2UgJ3MnOlxuICAgICAgcmV0dXJuIG4gKiBzO1xuICAgIGNhc2UgJ21pbGxpc2Vjb25kcyc6XG4gICAgY2FzZSAnbWlsbGlzZWNvbmQnOlxuICAgIGNhc2UgJ21zZWNzJzpcbiAgICBjYXNlICdtc2VjJzpcbiAgICBjYXNlICdtcyc6XG4gICAgICByZXR1cm4gbjtcbiAgfVxufVxuXG4vKipcbiAqIFNob3J0IGZvcm1hdCBmb3IgYG1zYC5cbiAqXG4gKiBAcGFyYW0ge051bWJlcn0gbXNcbiAqIEByZXR1cm4ge1N0cmluZ31cbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmZ1bmN0aW9uIHNob3J0KG1zKSB7XG4gIGlmIChtcyA+PSBkKSByZXR1cm4gTWF0aC5yb3VuZChtcyAvIGQpICsgJ2QnO1xuICBpZiAobXMgPj0gaCkgcmV0dXJuIE1hdGgucm91bmQobXMgLyBoKSArICdoJztcbiAgaWYgKG1zID49IG0pIHJldHVybiBNYXRoLnJvdW5kKG1zIC8gbSkgKyAnbSc7XG4gIGlmIChtcyA+PSBzKSByZXR1cm4gTWF0aC5yb3VuZChtcyAvIHMpICsgJ3MnO1xuICByZXR1cm4gbXMgKyAnbXMnO1xufVxuXG4vKipcbiAqIExvbmcgZm9ybWF0IGZvciBgbXNgLlxuICpcbiAqIEBwYXJhbSB7TnVtYmVyfSBtc1xuICogQHJldHVybiB7U3RyaW5nfVxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuZnVuY3Rpb24gbG9uZyhtcykge1xuICByZXR1cm4gcGx1cmFsKG1zLCBkLCAnZGF5JylcbiAgICB8fCBwbHVyYWwobXMsIGgsICdob3VyJylcbiAgICB8fCBwbHVyYWwobXMsIG0sICdtaW51dGUnKVxuICAgIHx8IHBsdXJhbChtcywgcywgJ3NlY29uZCcpXG4gICAgfHwgbXMgKyAnIG1zJztcbn1cblxuLyoqXG4gKiBQbHVyYWxpemF0aW9uIGhlbHBlci5cbiAqL1xuXG5mdW5jdGlvbiBwbHVyYWwobXMsIG4sIG5hbWUpIHtcbiAgaWYgKG1zIDwgbikgcmV0dXJuO1xuICBpZiAobXMgPCBuICogMS41KSByZXR1cm4gTWF0aC5mbG9vcihtcyAvIG4pICsgJyAnICsgbmFtZTtcbiAgcmV0dXJuIE1hdGguY2VpbChtcyAvIG4pICsgJyAnICsgbmFtZSArICdzJztcbn1cbiIsImlmICh0eXBlb2YgT2JqZWN0LmNyZWF0ZSA9PT0gJ2Z1bmN0aW9uJykge1xuICAvLyBpbXBsZW1lbnRhdGlvbiBmcm9tIHN0YW5kYXJkIG5vZGUuanMgJ3V0aWwnIG1vZHVsZVxuICBtb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIGluaGVyaXRzKGN0b3IsIHN1cGVyQ3Rvcikge1xuICAgIGN0b3Iuc3VwZXJfID0gc3VwZXJDdG9yXG4gICAgY3Rvci5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKHN1cGVyQ3Rvci5wcm90b3R5cGUsIHtcbiAgICAgIGNvbnN0cnVjdG9yOiB7XG4gICAgICAgIHZhbHVlOiBjdG9yLFxuICAgICAgICBlbnVtZXJhYmxlOiBmYWxzZSxcbiAgICAgICAgd3JpdGFibGU6IHRydWUsXG4gICAgICAgIGNvbmZpZ3VyYWJsZTogdHJ1ZVxuICAgICAgfVxuICAgIH0pO1xuICB9O1xufSBlbHNlIHtcbiAgLy8gb2xkIHNjaG9vbCBzaGltIGZvciBvbGQgYnJvd3NlcnNcbiAgbW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBpbmhlcml0cyhjdG9yLCBzdXBlckN0b3IpIHtcbiAgICBjdG9yLnN1cGVyXyA9IHN1cGVyQ3RvclxuICAgIHZhciBUZW1wQ3RvciA9IGZ1bmN0aW9uICgpIHt9XG4gICAgVGVtcEN0b3IucHJvdG90eXBlID0gc3VwZXJDdG9yLnByb3RvdHlwZVxuICAgIGN0b3IucHJvdG90eXBlID0gbmV3IFRlbXBDdG9yKClcbiAgICBjdG9yLnByb3RvdHlwZS5jb25zdHJ1Y3RvciA9IGN0b3JcbiAgfVxufVxuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IElOVEVSTkFMO1xuXG5mdW5jdGlvbiBJTlRFUk5BTCgpIHt9IiwiJ3VzZSBzdHJpY3QnO1xudmFyIFByb21pc2UgPSByZXF1aXJlKCcuL3Byb21pc2UnKTtcbnZhciByZWplY3QgPSByZXF1aXJlKCcuL3JlamVjdCcpO1xudmFyIHJlc29sdmUgPSByZXF1aXJlKCcuL3Jlc29sdmUnKTtcbnZhciBJTlRFUk5BTCA9IHJlcXVpcmUoJy4vSU5URVJOQUwnKTtcbnZhciBoYW5kbGVycyA9IHJlcXVpcmUoJy4vaGFuZGxlcnMnKTtcbm1vZHVsZS5leHBvcnRzID0gYWxsO1xuZnVuY3Rpb24gYWxsKGl0ZXJhYmxlKSB7XG4gIGlmIChPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwoaXRlcmFibGUpICE9PSAnW29iamVjdCBBcnJheV0nKSB7XG4gICAgcmV0dXJuIHJlamVjdChuZXcgVHlwZUVycm9yKCdtdXN0IGJlIGFuIGFycmF5JykpO1xuICB9XG5cbiAgdmFyIGxlbiA9IGl0ZXJhYmxlLmxlbmd0aDtcbiAgdmFyIGNhbGxlZCA9IGZhbHNlO1xuICBpZiAoIWxlbikge1xuICAgIHJldHVybiByZXNvbHZlKFtdKTtcbiAgfVxuXG4gIHZhciB2YWx1ZXMgPSBuZXcgQXJyYXkobGVuKTtcbiAgdmFyIHJlc29sdmVkID0gMDtcbiAgdmFyIGkgPSAtMTtcbiAgdmFyIHByb21pc2UgPSBuZXcgUHJvbWlzZShJTlRFUk5BTCk7XG4gIFxuICB3aGlsZSAoKytpIDwgbGVuKSB7XG4gICAgYWxsUmVzb2x2ZXIoaXRlcmFibGVbaV0sIGkpO1xuICB9XG4gIHJldHVybiBwcm9taXNlO1xuICBmdW5jdGlvbiBhbGxSZXNvbHZlcih2YWx1ZSwgaSkge1xuICAgIHJlc29sdmUodmFsdWUpLnRoZW4ocmVzb2x2ZUZyb21BbGwsIGZ1bmN0aW9uIChlcnJvcikge1xuICAgICAgaWYgKCFjYWxsZWQpIHtcbiAgICAgICAgY2FsbGVkID0gdHJ1ZTtcbiAgICAgICAgaGFuZGxlcnMucmVqZWN0KHByb21pc2UsIGVycm9yKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICBmdW5jdGlvbiByZXNvbHZlRnJvbUFsbChvdXRWYWx1ZSkge1xuICAgICAgdmFsdWVzW2ldID0gb3V0VmFsdWU7XG4gICAgICBpZiAoKytyZXNvbHZlZCA9PT0gbGVuICYgIWNhbGxlZCkge1xuICAgICAgICBjYWxsZWQgPSB0cnVlO1xuICAgICAgICBoYW5kbGVycy5yZXNvbHZlKHByb21pc2UsIHZhbHVlcyk7XG4gICAgICB9XG4gICAgfVxuICB9XG59IiwiJ3VzZSBzdHJpY3QnO1xudmFyIHRyeUNhdGNoID0gcmVxdWlyZSgnLi90cnlDYXRjaCcpO1xudmFyIHJlc29sdmVUaGVuYWJsZSA9IHJlcXVpcmUoJy4vcmVzb2x2ZVRoZW5hYmxlJyk7XG52YXIgc3RhdGVzID0gcmVxdWlyZSgnLi9zdGF0ZXMnKTtcblxuZXhwb3J0cy5yZXNvbHZlID0gZnVuY3Rpb24gKHNlbGYsIHZhbHVlKSB7XG4gIHZhciByZXN1bHQgPSB0cnlDYXRjaChnZXRUaGVuLCB2YWx1ZSk7XG4gIGlmIChyZXN1bHQuc3RhdHVzID09PSAnZXJyb3InKSB7XG4gICAgcmV0dXJuIGV4cG9ydHMucmVqZWN0KHNlbGYsIHJlc3VsdC52YWx1ZSk7XG4gIH1cbiAgdmFyIHRoZW5hYmxlID0gcmVzdWx0LnZhbHVlO1xuXG4gIGlmICh0aGVuYWJsZSkge1xuICAgIHJlc29sdmVUaGVuYWJsZS5zYWZlbHkoc2VsZiwgdGhlbmFibGUpO1xuICB9IGVsc2Uge1xuICAgIHNlbGYuc3RhdGUgPSBzdGF0ZXMuRlVMRklMTEVEO1xuICAgIHNlbGYub3V0Y29tZSA9IHZhbHVlO1xuICAgIHZhciBpID0gLTE7XG4gICAgdmFyIGxlbiA9IHNlbGYucXVldWUubGVuZ3RoO1xuICAgIHdoaWxlICgrK2kgPCBsZW4pIHtcbiAgICAgIHNlbGYucXVldWVbaV0uY2FsbEZ1bGZpbGxlZCh2YWx1ZSk7XG4gICAgfVxuICB9XG4gIHJldHVybiBzZWxmO1xufTtcbmV4cG9ydHMucmVqZWN0ID0gZnVuY3Rpb24gKHNlbGYsIGVycm9yKSB7XG4gIHNlbGYuc3RhdGUgPSBzdGF0ZXMuUkVKRUNURUQ7XG4gIHNlbGYub3V0Y29tZSA9IGVycm9yO1xuICB2YXIgaSA9IC0xO1xuICB2YXIgbGVuID0gc2VsZi5xdWV1ZS5sZW5ndGg7XG4gIHdoaWxlICgrK2kgPCBsZW4pIHtcbiAgICBzZWxmLnF1ZXVlW2ldLmNhbGxSZWplY3RlZChlcnJvcik7XG4gIH1cbiAgcmV0dXJuIHNlbGY7XG59O1xuXG5mdW5jdGlvbiBnZXRUaGVuKG9iaikge1xuICAvLyBNYWtlIHN1cmUgd2Ugb25seSBhY2Nlc3MgdGhlIGFjY2Vzc29yIG9uY2UgYXMgcmVxdWlyZWQgYnkgdGhlIHNwZWNcbiAgdmFyIHRoZW4gPSBvYmogJiYgb2JqLnRoZW47XG4gIGlmIChvYmogJiYgdHlwZW9mIG9iaiA9PT0gJ29iamVjdCcgJiYgdHlwZW9mIHRoZW4gPT09ICdmdW5jdGlvbicpIHtcbiAgICByZXR1cm4gZnVuY3Rpb24gYXBweVRoZW4oKSB7XG4gICAgICB0aGVuLmFwcGx5KG9iaiwgYXJndW1lbnRzKTtcbiAgICB9O1xuICB9XG59IiwibW9kdWxlLmV4cG9ydHMgPSBleHBvcnRzID0gcmVxdWlyZSgnLi9wcm9taXNlJyk7XG5cbmV4cG9ydHMucmVzb2x2ZSA9IHJlcXVpcmUoJy4vcmVzb2x2ZScpO1xuZXhwb3J0cy5yZWplY3QgPSByZXF1aXJlKCcuL3JlamVjdCcpO1xuZXhwb3J0cy5hbGwgPSByZXF1aXJlKCcuL2FsbCcpO1xuZXhwb3J0cy5yYWNlID0gcmVxdWlyZSgnLi9yYWNlJyk7IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgdW53cmFwID0gcmVxdWlyZSgnLi91bndyYXAnKTtcbnZhciBJTlRFUk5BTCA9IHJlcXVpcmUoJy4vSU5URVJOQUwnKTtcbnZhciByZXNvbHZlVGhlbmFibGUgPSByZXF1aXJlKCcuL3Jlc29sdmVUaGVuYWJsZScpO1xudmFyIHN0YXRlcyA9IHJlcXVpcmUoJy4vc3RhdGVzJyk7XG52YXIgUXVldWVJdGVtID0gcmVxdWlyZSgnLi9xdWV1ZUl0ZW0nKTtcblxubW9kdWxlLmV4cG9ydHMgPSBQcm9taXNlO1xuZnVuY3Rpb24gUHJvbWlzZShyZXNvbHZlcikge1xuICBpZiAoISh0aGlzIGluc3RhbmNlb2YgUHJvbWlzZSkpIHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UocmVzb2x2ZXIpO1xuICB9XG4gIGlmICh0eXBlb2YgcmVzb2x2ZXIgIT09ICdmdW5jdGlvbicpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdyZXNvbHZlciBtdXN0IGJlIGEgZnVuY3Rpb24nKTtcbiAgfVxuICB0aGlzLnN0YXRlID0gc3RhdGVzLlBFTkRJTkc7XG4gIHRoaXMucXVldWUgPSBbXTtcbiAgdGhpcy5vdXRjb21lID0gdm9pZCAwO1xuICBpZiAocmVzb2x2ZXIgIT09IElOVEVSTkFMKSB7XG4gICAgcmVzb2x2ZVRoZW5hYmxlLnNhZmVseSh0aGlzLCByZXNvbHZlcik7XG4gIH1cbn1cblxuUHJvbWlzZS5wcm90b3R5cGVbJ2NhdGNoJ10gPSBmdW5jdGlvbiAob25SZWplY3RlZCkge1xuICByZXR1cm4gdGhpcy50aGVuKG51bGwsIG9uUmVqZWN0ZWQpO1xufTtcblByb21pc2UucHJvdG90eXBlLnRoZW4gPSBmdW5jdGlvbiAob25GdWxmaWxsZWQsIG9uUmVqZWN0ZWQpIHtcbiAgaWYgKHR5cGVvZiBvbkZ1bGZpbGxlZCAhPT0gJ2Z1bmN0aW9uJyAmJiB0aGlzLnN0YXRlID09PSBzdGF0ZXMuRlVMRklMTEVEIHx8XG4gICAgdHlwZW9mIG9uUmVqZWN0ZWQgIT09ICdmdW5jdGlvbicgJiYgdGhpcy5zdGF0ZSA9PT0gc3RhdGVzLlJFSkVDVEVEKSB7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cbiAgdmFyIHByb21pc2UgPSBuZXcgUHJvbWlzZShJTlRFUk5BTCk7XG5cbiAgXG4gIGlmICh0aGlzLnN0YXRlICE9PSBzdGF0ZXMuUEVORElORykge1xuICAgIHZhciByZXNvbHZlciA9IHRoaXMuc3RhdGUgPT09IHN0YXRlcy5GVUxGSUxMRUQgPyBvbkZ1bGZpbGxlZDogb25SZWplY3RlZDtcbiAgICB1bndyYXAocHJvbWlzZSwgcmVzb2x2ZXIsIHRoaXMub3V0Y29tZSk7XG4gIH0gZWxzZSB7XG4gICAgdGhpcy5xdWV1ZS5wdXNoKG5ldyBRdWV1ZUl0ZW0ocHJvbWlzZSwgb25GdWxmaWxsZWQsIG9uUmVqZWN0ZWQpKTtcbiAgfVxuXG4gIHJldHVybiBwcm9taXNlO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcbnZhciBoYW5kbGVycyA9IHJlcXVpcmUoJy4vaGFuZGxlcnMnKTtcbnZhciB1bndyYXAgPSByZXF1aXJlKCcuL3Vud3JhcCcpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFF1ZXVlSXRlbTtcbmZ1bmN0aW9uIFF1ZXVlSXRlbShwcm9taXNlLCBvbkZ1bGZpbGxlZCwgb25SZWplY3RlZCkge1xuICB0aGlzLnByb21pc2UgPSBwcm9taXNlO1xuICBpZiAodHlwZW9mIG9uRnVsZmlsbGVkID09PSAnZnVuY3Rpb24nKSB7XG4gICAgdGhpcy5vbkZ1bGZpbGxlZCA9IG9uRnVsZmlsbGVkO1xuICAgIHRoaXMuY2FsbEZ1bGZpbGxlZCA9IHRoaXMub3RoZXJDYWxsRnVsZmlsbGVkO1xuICB9XG4gIGlmICh0eXBlb2Ygb25SZWplY3RlZCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIHRoaXMub25SZWplY3RlZCA9IG9uUmVqZWN0ZWQ7XG4gICAgdGhpcy5jYWxsUmVqZWN0ZWQgPSB0aGlzLm90aGVyQ2FsbFJlamVjdGVkO1xuICB9XG59XG5RdWV1ZUl0ZW0ucHJvdG90eXBlLmNhbGxGdWxmaWxsZWQgPSBmdW5jdGlvbiAodmFsdWUpIHtcbiAgaGFuZGxlcnMucmVzb2x2ZSh0aGlzLnByb21pc2UsIHZhbHVlKTtcbn07XG5RdWV1ZUl0ZW0ucHJvdG90eXBlLm90aGVyQ2FsbEZ1bGZpbGxlZCA9IGZ1bmN0aW9uICh2YWx1ZSkge1xuICB1bndyYXAodGhpcy5wcm9taXNlLCB0aGlzLm9uRnVsZmlsbGVkLCB2YWx1ZSk7XG59O1xuUXVldWVJdGVtLnByb3RvdHlwZS5jYWxsUmVqZWN0ZWQgPSBmdW5jdGlvbiAodmFsdWUpIHtcbiAgaGFuZGxlcnMucmVqZWN0KHRoaXMucHJvbWlzZSwgdmFsdWUpO1xufTtcblF1ZXVlSXRlbS5wcm90b3R5cGUub3RoZXJDYWxsUmVqZWN0ZWQgPSBmdW5jdGlvbiAodmFsdWUpIHtcbiAgdW53cmFwKHRoaXMucHJvbWlzZSwgdGhpcy5vblJlamVjdGVkLCB2YWx1ZSk7XG59OyIsIid1c2Ugc3RyaWN0JztcbnZhciBQcm9taXNlID0gcmVxdWlyZSgnLi9wcm9taXNlJyk7XG52YXIgcmVqZWN0ID0gcmVxdWlyZSgnLi9yZWplY3QnKTtcbnZhciByZXNvbHZlID0gcmVxdWlyZSgnLi9yZXNvbHZlJyk7XG52YXIgSU5URVJOQUwgPSByZXF1aXJlKCcuL0lOVEVSTkFMJyk7XG52YXIgaGFuZGxlcnMgPSByZXF1aXJlKCcuL2hhbmRsZXJzJyk7XG5tb2R1bGUuZXhwb3J0cyA9IHJhY2U7XG5mdW5jdGlvbiByYWNlKGl0ZXJhYmxlKSB7XG4gIGlmIChPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwoaXRlcmFibGUpICE9PSAnW29iamVjdCBBcnJheV0nKSB7XG4gICAgcmV0dXJuIHJlamVjdChuZXcgVHlwZUVycm9yKCdtdXN0IGJlIGFuIGFycmF5JykpO1xuICB9XG5cbiAgdmFyIGxlbiA9IGl0ZXJhYmxlLmxlbmd0aDtcbiAgdmFyIGNhbGxlZCA9IGZhbHNlO1xuICBpZiAoIWxlbikge1xuICAgIHJldHVybiByZXNvbHZlKFtdKTtcbiAgfVxuXG4gIHZhciByZXNvbHZlZCA9IDA7XG4gIHZhciBpID0gLTE7XG4gIHZhciBwcm9taXNlID0gbmV3IFByb21pc2UoSU5URVJOQUwpO1xuICBcbiAgd2hpbGUgKCsraSA8IGxlbikge1xuICAgIHJlc29sdmVyKGl0ZXJhYmxlW2ldKTtcbiAgfVxuICByZXR1cm4gcHJvbWlzZTtcbiAgZnVuY3Rpb24gcmVzb2x2ZXIodmFsdWUpIHtcbiAgICByZXNvbHZlKHZhbHVlKS50aGVuKGZ1bmN0aW9uIChyZXNwb25zZSkge1xuICAgICAgaWYgKCFjYWxsZWQpIHtcbiAgICAgICAgY2FsbGVkID0gdHJ1ZTtcbiAgICAgICAgaGFuZGxlcnMucmVzb2x2ZShwcm9taXNlLCByZXNwb25zZSk7XG4gICAgICB9XG4gICAgfSwgZnVuY3Rpb24gKGVycm9yKSB7XG4gICAgICBpZiAoIWNhbGxlZCkge1xuICAgICAgICBjYWxsZWQgPSB0cnVlO1xuICAgICAgICBoYW5kbGVycy5yZWplY3QocHJvbWlzZSwgZXJyb3IpO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG59IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgUHJvbWlzZSA9IHJlcXVpcmUoJy4vcHJvbWlzZScpO1xudmFyIElOVEVSTkFMID0gcmVxdWlyZSgnLi9JTlRFUk5BTCcpO1xudmFyIGhhbmRsZXJzID0gcmVxdWlyZSgnLi9oYW5kbGVycycpO1xubW9kdWxlLmV4cG9ydHMgPSByZWplY3Q7XG5cbmZ1bmN0aW9uIHJlamVjdChyZWFzb24pIHtcblx0dmFyIHByb21pc2UgPSBuZXcgUHJvbWlzZShJTlRFUk5BTCk7XG5cdHJldHVybiBoYW5kbGVycy5yZWplY3QocHJvbWlzZSwgcmVhc29uKTtcbn0iLCIndXNlIHN0cmljdCc7XG5cbnZhciBQcm9taXNlID0gcmVxdWlyZSgnLi9wcm9taXNlJyk7XG52YXIgSU5URVJOQUwgPSByZXF1aXJlKCcuL0lOVEVSTkFMJyk7XG52YXIgaGFuZGxlcnMgPSByZXF1aXJlKCcuL2hhbmRsZXJzJyk7XG5tb2R1bGUuZXhwb3J0cyA9IHJlc29sdmU7XG5cbnZhciBGQUxTRSA9IGhhbmRsZXJzLnJlc29sdmUobmV3IFByb21pc2UoSU5URVJOQUwpLCBmYWxzZSk7XG52YXIgTlVMTCA9IGhhbmRsZXJzLnJlc29sdmUobmV3IFByb21pc2UoSU5URVJOQUwpLCBudWxsKTtcbnZhciBVTkRFRklORUQgPSBoYW5kbGVycy5yZXNvbHZlKG5ldyBQcm9taXNlKElOVEVSTkFMKSwgdm9pZCAwKTtcbnZhciBaRVJPID0gaGFuZGxlcnMucmVzb2x2ZShuZXcgUHJvbWlzZShJTlRFUk5BTCksIDApO1xudmFyIEVNUFRZU1RSSU5HID0gaGFuZGxlcnMucmVzb2x2ZShuZXcgUHJvbWlzZShJTlRFUk5BTCksICcnKTtcblxuZnVuY3Rpb24gcmVzb2x2ZSh2YWx1ZSkge1xuICBpZiAodmFsdWUpIHtcbiAgICBpZiAodmFsdWUgaW5zdGFuY2VvZiBQcm9taXNlKSB7XG4gICAgICByZXR1cm4gdmFsdWU7XG4gICAgfVxuICAgIHJldHVybiBoYW5kbGVycy5yZXNvbHZlKG5ldyBQcm9taXNlKElOVEVSTkFMKSwgdmFsdWUpO1xuICB9XG4gIHZhciB2YWx1ZVR5cGUgPSB0eXBlb2YgdmFsdWU7XG4gIHN3aXRjaCAodmFsdWVUeXBlKSB7XG4gICAgY2FzZSAnYm9vbGVhbic6XG4gICAgICByZXR1cm4gRkFMU0U7XG4gICAgY2FzZSAndW5kZWZpbmVkJzpcbiAgICAgIHJldHVybiBVTkRFRklORUQ7XG4gICAgY2FzZSAnb2JqZWN0JzpcbiAgICAgIHJldHVybiBOVUxMO1xuICAgIGNhc2UgJ251bWJlcic6XG4gICAgICByZXR1cm4gWkVSTztcbiAgICBjYXNlICdzdHJpbmcnOlxuICAgICAgcmV0dXJuIEVNUFRZU1RSSU5HO1xuICB9XG59IiwiJ3VzZSBzdHJpY3QnO1xudmFyIGhhbmRsZXJzID0gcmVxdWlyZSgnLi9oYW5kbGVycycpO1xudmFyIHRyeUNhdGNoID0gcmVxdWlyZSgnLi90cnlDYXRjaCcpO1xuZnVuY3Rpb24gc2FmZWx5UmVzb2x2ZVRoZW5hYmxlKHNlbGYsIHRoZW5hYmxlKSB7XG4gIC8vIEVpdGhlciBmdWxmaWxsLCByZWplY3Qgb3IgcmVqZWN0IHdpdGggZXJyb3JcbiAgdmFyIGNhbGxlZCA9IGZhbHNlO1xuICBmdW5jdGlvbiBvbkVycm9yKHZhbHVlKSB7XG4gICAgaWYgKGNhbGxlZCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjYWxsZWQgPSB0cnVlO1xuICAgIGhhbmRsZXJzLnJlamVjdChzZWxmLCB2YWx1ZSk7XG4gIH1cblxuICBmdW5jdGlvbiBvblN1Y2Nlc3ModmFsdWUpIHtcbiAgICBpZiAoY2FsbGVkKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNhbGxlZCA9IHRydWU7XG4gICAgaGFuZGxlcnMucmVzb2x2ZShzZWxmLCB2YWx1ZSk7XG4gIH1cblxuICBmdW5jdGlvbiB0cnlUb1Vud3JhcCgpIHtcbiAgICB0aGVuYWJsZShvblN1Y2Nlc3MsIG9uRXJyb3IpO1xuICB9XG4gIFxuICB2YXIgcmVzdWx0ID0gdHJ5Q2F0Y2godHJ5VG9VbndyYXApO1xuICBpZiAocmVzdWx0LnN0YXR1cyA9PT0gJ2Vycm9yJykge1xuICAgIG9uRXJyb3IocmVzdWx0LnZhbHVlKTtcbiAgfVxufVxuZXhwb3J0cy5zYWZlbHkgPSBzYWZlbHlSZXNvbHZlVGhlbmFibGU7IiwiLy8gTGF6eSBtYW4ncyBzeW1ib2xzIGZvciBzdGF0ZXNcblxuZXhwb3J0cy5SRUpFQ1RFRCA9IFsnUkVKRUNURUQnXTtcbmV4cG9ydHMuRlVMRklMTEVEID0gWydGVUxGSUxMRUQnXTtcbmV4cG9ydHMuUEVORElORyA9IFsnUEVORElORyddOyIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSB0cnlDYXRjaDtcblxuZnVuY3Rpb24gdHJ5Q2F0Y2goZnVuYywgdmFsdWUpIHtcbiAgdmFyIG91dCA9IHt9O1xuICB0cnkge1xuICAgIG91dC52YWx1ZSA9IGZ1bmModmFsdWUpO1xuICAgIG91dC5zdGF0dXMgPSAnc3VjY2Vzcyc7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBvdXQuc3RhdHVzID0gJ2Vycm9yJztcbiAgICBvdXQudmFsdWUgPSBlO1xuICB9XG4gIHJldHVybiBvdXQ7XG59IiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgaW1tZWRpYXRlID0gcmVxdWlyZSgnaW1tZWRpYXRlJyk7XG52YXIgaGFuZGxlcnMgPSByZXF1aXJlKCcuL2hhbmRsZXJzJyk7XG5tb2R1bGUuZXhwb3J0cyA9IHVud3JhcDtcblxuZnVuY3Rpb24gdW53cmFwKHByb21pc2UsIGZ1bmMsIHZhbHVlKSB7XG4gIGltbWVkaWF0ZShmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHJldHVyblZhbHVlO1xuICAgIHRyeSB7XG4gICAgICByZXR1cm5WYWx1ZSA9IGZ1bmModmFsdWUpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIHJldHVybiBoYW5kbGVycy5yZWplY3QocHJvbWlzZSwgZSk7XG4gICAgfVxuICAgIGlmIChyZXR1cm5WYWx1ZSA9PT0gcHJvbWlzZSkge1xuICAgICAgaGFuZGxlcnMucmVqZWN0KHByb21pc2UsIG5ldyBUeXBlRXJyb3IoJ0Nhbm5vdCByZXNvbHZlIHByb21pc2Ugd2l0aCBpdHNlbGYnKSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGhhbmRsZXJzLnJlc29sdmUocHJvbWlzZSwgcmV0dXJuVmFsdWUpO1xuICAgIH1cbiAgfSk7XG59IiwiJ3VzZSBzdHJpY3QnO1xudmFyIHR5cGVzID0gW1xuICByZXF1aXJlKCcuL25leHRUaWNrJyksXG4gIHJlcXVpcmUoJy4vbXV0YXRpb24uanMnKSxcbiAgcmVxdWlyZSgnLi9tZXNzYWdlQ2hhbm5lbCcpLFxuICByZXF1aXJlKCcuL3N0YXRlQ2hhbmdlJyksXG4gIHJlcXVpcmUoJy4vdGltZW91dCcpXG5dO1xudmFyIGRyYWluaW5nO1xudmFyIGN1cnJlbnRRdWV1ZTtcbnZhciBxdWV1ZUluZGV4ID0gLTE7XG52YXIgcXVldWUgPSBbXTtcbmZ1bmN0aW9uIGNsZWFuVXBOZXh0VGljaygpIHtcbiAgICBkcmFpbmluZyA9IGZhbHNlO1xuICAgIGlmIChjdXJyZW50UXVldWUgJiYgY3VycmVudFF1ZXVlLmxlbmd0aCkge1xuICAgICAgcXVldWUgPSBjdXJyZW50UXVldWUuY29uY2F0KHF1ZXVlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcXVldWVJbmRleCA9IC0xO1xuICAgIH1cbiAgICBpZiAocXVldWUubGVuZ3RoKSB7XG4gICAgICBuZXh0VGljaygpO1xuICAgIH1cbn1cblxuLy9uYW1lZCBuZXh0VGljayBmb3IgbGVzcyBjb25mdXNpbmcgc3RhY2sgdHJhY2VzXG5mdW5jdGlvbiBuZXh0VGljaygpIHtcbiAgZHJhaW5pbmcgPSB0cnVlO1xuICB2YXIgbGVuID0gcXVldWUubGVuZ3RoO1xuICB2YXIgdGltZW91dCA9IHNldFRpbWVvdXQoY2xlYW5VcE5leHRUaWNrKTtcbiAgd2hpbGUgKGxlbikge1xuICAgIGN1cnJlbnRRdWV1ZSA9IHF1ZXVlO1xuICAgIHF1ZXVlID0gW107XG4gICAgd2hpbGUgKCsrcXVldWVJbmRleCA8IGxlbikge1xuICAgICAgY3VycmVudFF1ZXVlW3F1ZXVlSW5kZXhdKCk7XG4gICAgfVxuICAgIHF1ZXVlSW5kZXggPSAtMTtcbiAgICBsZW4gPSBxdWV1ZS5sZW5ndGg7XG4gIH1cbiAgcXVldWVJbmRleCA9IC0xO1xuICBkcmFpbmluZyA9IGZhbHNlO1xuICBjbGVhclRpbWVvdXQodGltZW91dCk7XG59XG52YXIgc2NoZWR1bGVEcmFpbjtcbnZhciBpID0gLTE7XG52YXIgbGVuID0gdHlwZXMubGVuZ3RoO1xud2hpbGUgKCsrIGkgPCBsZW4pIHtcbiAgaWYgKHR5cGVzW2ldICYmIHR5cGVzW2ldLnRlc3QgJiYgdHlwZXNbaV0udGVzdCgpKSB7XG4gICAgc2NoZWR1bGVEcmFpbiA9IHR5cGVzW2ldLmluc3RhbGwobmV4dFRpY2spO1xuICAgIGJyZWFrO1xuICB9XG59XG5tb2R1bGUuZXhwb3J0cyA9IGltbWVkaWF0ZTtcbmZ1bmN0aW9uIGltbWVkaWF0ZSh0YXNrKSB7XG4gIGlmIChxdWV1ZS5wdXNoKHRhc2spID09PSAxICYmICFkcmFpbmluZykge1xuICAgIHNjaGVkdWxlRHJhaW4oKTtcbiAgfVxufSIsIid1c2Ugc3RyaWN0JztcblxuZXhwb3J0cy50ZXN0ID0gZnVuY3Rpb24gKCkge1xuICBpZiAoZ2xvYmFsLnNldEltbWVkaWF0ZSkge1xuICAgIC8vIHdlIGNhbiBvbmx5IGdldCBoZXJlIGluIElFMTBcbiAgICAvLyB3aGljaCBkb2Vzbid0IGhhbmRlbCBwb3N0TWVzc2FnZSB3ZWxsXG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIHJldHVybiB0eXBlb2YgZ2xvYmFsLk1lc3NhZ2VDaGFubmVsICE9PSAndW5kZWZpbmVkJztcbn07XG5cbmV4cG9ydHMuaW5zdGFsbCA9IGZ1bmN0aW9uIChmdW5jKSB7XG4gIHZhciBjaGFubmVsID0gbmV3IGdsb2JhbC5NZXNzYWdlQ2hhbm5lbCgpO1xuICBjaGFubmVsLnBvcnQxLm9ubWVzc2FnZSA9IGZ1bmM7XG4gIHJldHVybiBmdW5jdGlvbiAoKSB7XG4gICAgY2hhbm5lbC5wb3J0Mi5wb3N0TWVzc2FnZSgwKTtcbiAgfTtcbn07IiwiJ3VzZSBzdHJpY3QnO1xuLy9iYXNlZCBvZmYgcnN2cCBodHRwczovL2dpdGh1Yi5jb20vdGlsZGVpby9yc3ZwLmpzXG4vL2xpY2Vuc2UgaHR0cHM6Ly9naXRodWIuY29tL3RpbGRlaW8vcnN2cC5qcy9ibG9iL21hc3Rlci9MSUNFTlNFXG4vL2h0dHBzOi8vZ2l0aHViLmNvbS90aWxkZWlvL3JzdnAuanMvYmxvYi9tYXN0ZXIvbGliL3JzdnAvYXNhcC5qc1xuXG52YXIgTXV0YXRpb24gPSBnbG9iYWwuTXV0YXRpb25PYnNlcnZlciB8fCBnbG9iYWwuV2ViS2l0TXV0YXRpb25PYnNlcnZlcjtcblxuZXhwb3J0cy50ZXN0ID0gZnVuY3Rpb24gKCkge1xuICByZXR1cm4gTXV0YXRpb247XG59O1xuXG5leHBvcnRzLmluc3RhbGwgPSBmdW5jdGlvbiAoaGFuZGxlKSB7XG4gIHZhciBjYWxsZWQgPSAwO1xuICB2YXIgb2JzZXJ2ZXIgPSBuZXcgTXV0YXRpb24oaGFuZGxlKTtcbiAgdmFyIGVsZW1lbnQgPSBnbG9iYWwuZG9jdW1lbnQuY3JlYXRlVGV4dE5vZGUoJycpO1xuICBvYnNlcnZlci5vYnNlcnZlKGVsZW1lbnQsIHtcbiAgICBjaGFyYWN0ZXJEYXRhOiB0cnVlXG4gIH0pO1xuICByZXR1cm4gZnVuY3Rpb24gKCkge1xuICAgIGVsZW1lbnQuZGF0YSA9IChjYWxsZWQgPSArK2NhbGxlZCAlIDIpO1xuICB9O1xufTsiLCIndXNlIHN0cmljdCc7XG5cbmV4cG9ydHMudGVzdCA9IGZ1bmN0aW9uICgpIHtcbiAgcmV0dXJuICdkb2N1bWVudCcgaW4gZ2xvYmFsICYmICdvbnJlYWR5c3RhdGVjaGFuZ2UnIGluIGdsb2JhbC5kb2N1bWVudC5jcmVhdGVFbGVtZW50KCdzY3JpcHQnKTtcbn07XG5cbmV4cG9ydHMuaW5zdGFsbCA9IGZ1bmN0aW9uIChoYW5kbGUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcblxuICAgIC8vIENyZWF0ZSBhIDxzY3JpcHQ+IGVsZW1lbnQ7IGl0cyByZWFkeXN0YXRlY2hhbmdlIGV2ZW50IHdpbGwgYmUgZmlyZWQgYXN5bmNocm9ub3VzbHkgb25jZSBpdCBpcyBpbnNlcnRlZFxuICAgIC8vIGludG8gdGhlIGRvY3VtZW50LiBEbyBzbywgdGh1cyBxdWV1aW5nIHVwIHRoZSB0YXNrLiBSZW1lbWJlciB0byBjbGVhbiB1cCBvbmNlIGl0J3MgYmVlbiBjYWxsZWQuXG4gICAgdmFyIHNjcmlwdEVsID0gZ2xvYmFsLmRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3NjcmlwdCcpO1xuICAgIHNjcmlwdEVsLm9ucmVhZHlzdGF0ZWNoYW5nZSA9IGZ1bmN0aW9uICgpIHtcbiAgICAgIGhhbmRsZSgpO1xuXG4gICAgICBzY3JpcHRFbC5vbnJlYWR5c3RhdGVjaGFuZ2UgPSBudWxsO1xuICAgICAgc2NyaXB0RWwucGFyZW50Tm9kZS5yZW1vdmVDaGlsZChzY3JpcHRFbCk7XG4gICAgICBzY3JpcHRFbCA9IG51bGw7XG4gICAgfTtcbiAgICBnbG9iYWwuZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50LmFwcGVuZENoaWxkKHNjcmlwdEVsKTtcblxuICAgIHJldHVybiBoYW5kbGU7XG4gIH07XG59OyIsIid1c2Ugc3RyaWN0JztcbmV4cG9ydHMudGVzdCA9IGZ1bmN0aW9uICgpIHtcbiAgcmV0dXJuIHRydWU7XG59O1xuXG5leHBvcnRzLmluc3RhbGwgPSBmdW5jdGlvbiAodCkge1xuICByZXR1cm4gZnVuY3Rpb24gKCkge1xuICAgIHNldFRpbWVvdXQodCwgMCk7XG4gIH07XG59OyIsIid1c2Ugc3RyaWN0JztcblxudmFyIE1JTl9NQUdOSVRVREUgPSAtMzI0OyAvLyB2ZXJpZmllZCBieSAtTnVtYmVyLk1JTl9WQUxVRVxudmFyIE1BR05JVFVERV9ESUdJVFMgPSAzOyAvLyBkaXR0b1xudmFyIFNFUCA9ICcnOyAvLyBzZXQgdG8gJ18nIGZvciBlYXNpZXIgZGVidWdnaW5nIFxuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzJyk7XG5cbmV4cG9ydHMuY29sbGF0ZSA9IGZ1bmN0aW9uIChhLCBiKSB7XG5cbiAgaWYgKGEgPT09IGIpIHtcbiAgICByZXR1cm4gMDtcbiAgfVxuXG4gIGEgPSBleHBvcnRzLm5vcm1hbGl6ZUtleShhKTtcbiAgYiA9IGV4cG9ydHMubm9ybWFsaXplS2V5KGIpO1xuXG4gIHZhciBhaSA9IGNvbGxhdGlvbkluZGV4KGEpO1xuICB2YXIgYmkgPSBjb2xsYXRpb25JbmRleChiKTtcbiAgaWYgKChhaSAtIGJpKSAhPT0gMCkge1xuICAgIHJldHVybiBhaSAtIGJpO1xuICB9XG4gIGlmIChhID09PSBudWxsKSB7XG4gICAgcmV0dXJuIDA7XG4gIH1cbiAgc3dpdGNoICh0eXBlb2YgYSkge1xuICAgIGNhc2UgJ251bWJlcic6XG4gICAgICByZXR1cm4gYSAtIGI7XG4gICAgY2FzZSAnYm9vbGVhbic6XG4gICAgICByZXR1cm4gYSA9PT0gYiA/IDAgOiAoYSA8IGIgPyAtMSA6IDEpO1xuICAgIGNhc2UgJ3N0cmluZyc6XG4gICAgICByZXR1cm4gc3RyaW5nQ29sbGF0ZShhLCBiKTtcbiAgfVxuICByZXR1cm4gQXJyYXkuaXNBcnJheShhKSA/IGFycmF5Q29sbGF0ZShhLCBiKSA6IG9iamVjdENvbGxhdGUoYSwgYik7XG59O1xuXG4vLyBjb3VjaCBjb25zaWRlcnMgbnVsbC9OYU4vSW5maW5pdHkvLUluZmluaXR5ID09PSB1bmRlZmluZWQsXG4vLyBmb3IgdGhlIHB1cnBvc2VzIG9mIG1hcHJlZHVjZSBpbmRleGVzLiBhbHNvLCBkYXRlcyBnZXQgc3RyaW5naWZpZWQuXG5leHBvcnRzLm5vcm1hbGl6ZUtleSA9IGZ1bmN0aW9uIChrZXkpIHtcbiAgc3dpdGNoICh0eXBlb2Yga2V5KSB7XG4gICAgY2FzZSAndW5kZWZpbmVkJzpcbiAgICAgIHJldHVybiBudWxsO1xuICAgIGNhc2UgJ251bWJlcic6XG4gICAgICBpZiAoa2V5ID09PSBJbmZpbml0eSB8fCBrZXkgPT09IC1JbmZpbml0eSB8fCBpc05hTihrZXkpKSB7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGtleTtcbiAgICBjYXNlICdvYmplY3QnOlxuICAgICAgdmFyIG9yaWdLZXkgPSBrZXk7XG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShrZXkpKSB7XG4gICAgICAgIHZhciBsZW4gPSBrZXkubGVuZ3RoO1xuICAgICAgICBrZXkgPSBuZXcgQXJyYXkobGVuKTtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW47IGkrKykge1xuICAgICAgICAgIGtleVtpXSA9IGV4cG9ydHMubm9ybWFsaXplS2V5KG9yaWdLZXlbaV0pO1xuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKGtleSBpbnN0YW5jZW9mIERhdGUpIHtcbiAgICAgICAgcmV0dXJuIGtleS50b0pTT04oKTtcbiAgICAgIH0gZWxzZSBpZiAoa2V5ICE9PSBudWxsKSB7IC8vIGdlbmVyaWMgb2JqZWN0XG4gICAgICAgIGtleSA9IHt9O1xuICAgICAgICBmb3IgKHZhciBrIGluIG9yaWdLZXkpIHtcbiAgICAgICAgICBpZiAob3JpZ0tleS5oYXNPd25Qcm9wZXJ0eShrKSkge1xuICAgICAgICAgICAgdmFyIHZhbCA9IG9yaWdLZXlba107XG4gICAgICAgICAgICBpZiAodHlwZW9mIHZhbCAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgICAgICAgICAga2V5W2tdID0gZXhwb3J0cy5ub3JtYWxpemVLZXkodmFsKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgfVxuICByZXR1cm4ga2V5O1xufTtcblxuZnVuY3Rpb24gaW5kZXhpZnkoa2V5KSB7XG4gIGlmIChrZXkgIT09IG51bGwpIHtcbiAgICBzd2l0Y2ggKHR5cGVvZiBrZXkpIHtcbiAgICAgIGNhc2UgJ2Jvb2xlYW4nOlxuICAgICAgICByZXR1cm4ga2V5ID8gMSA6IDA7XG4gICAgICBjYXNlICdudW1iZXInOlxuICAgICAgICByZXR1cm4gbnVtVG9JbmRleGFibGVTdHJpbmcoa2V5KTtcbiAgICAgIGNhc2UgJ3N0cmluZyc6XG4gICAgICAgIC8vIFdlJ3ZlIHRvIGJlIHN1cmUgdGhhdCBrZXkgZG9lcyBub3QgY29udGFpbiBcXHUwMDAwXG4gICAgICAgIC8vIERvIG9yZGVyLXByZXNlcnZpbmcgcmVwbGFjZW1lbnRzOlxuICAgICAgICAvLyAwIC0+IDEsIDFcbiAgICAgICAgLy8gMSAtPiAxLCAyXG4gICAgICAgIC8vIDIgLT4gMiwgMlxuICAgICAgICByZXR1cm4ga2V5XG4gICAgICAgICAgLnJlcGxhY2UoL1xcdTAwMDIvZywgJ1xcdTAwMDJcXHUwMDAyJylcbiAgICAgICAgICAucmVwbGFjZSgvXFx1MDAwMS9nLCAnXFx1MDAwMVxcdTAwMDInKVxuICAgICAgICAgIC5yZXBsYWNlKC9cXHUwMDAwL2csICdcXHUwMDAxXFx1MDAwMScpO1xuICAgICAgY2FzZSAnb2JqZWN0JzpcbiAgICAgICAgdmFyIGlzQXJyYXkgPSBBcnJheS5pc0FycmF5KGtleSk7XG4gICAgICAgIHZhciBhcnIgPSBpc0FycmF5ID8ga2V5IDogT2JqZWN0LmtleXMoa2V5KTtcbiAgICAgICAgdmFyIGkgPSAtMTtcbiAgICAgICAgdmFyIGxlbiA9IGFyci5sZW5ndGg7XG4gICAgICAgIHZhciByZXN1bHQgPSAnJztcbiAgICAgICAgaWYgKGlzQXJyYXkpIHtcbiAgICAgICAgICB3aGlsZSAoKytpIDwgbGVuKSB7XG4gICAgICAgICAgICByZXN1bHQgKz0gZXhwb3J0cy50b0luZGV4YWJsZVN0cmluZyhhcnJbaV0pO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB3aGlsZSAoKytpIDwgbGVuKSB7XG4gICAgICAgICAgICB2YXIgb2JqS2V5ID0gYXJyW2ldO1xuICAgICAgICAgICAgcmVzdWx0ICs9IGV4cG9ydHMudG9JbmRleGFibGVTdHJpbmcob2JqS2V5KSArXG4gICAgICAgICAgICAgICAgZXhwb3J0cy50b0luZGV4YWJsZVN0cmluZyhrZXlbb2JqS2V5XSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfVxuICB9XG4gIHJldHVybiAnJztcbn1cblxuLy8gY29udmVydCB0aGUgZ2l2ZW4ga2V5IHRvIGEgc3RyaW5nIHRoYXQgd291bGQgYmUgYXBwcm9wcmlhdGVcbi8vIGZvciBsZXhpY2FsIHNvcnRpbmcsIGUuZy4gd2l0aGluIGEgZGF0YWJhc2UsIHdoZXJlIHRoZVxuLy8gc29ydGluZyBpcyB0aGUgc2FtZSBnaXZlbiBieSB0aGUgY29sbGF0ZSgpIGZ1bmN0aW9uLlxuZXhwb3J0cy50b0luZGV4YWJsZVN0cmluZyA9IGZ1bmN0aW9uIChrZXkpIHtcbiAgdmFyIHplcm8gPSAnXFx1MDAwMCc7XG4gIGtleSA9IGV4cG9ydHMubm9ybWFsaXplS2V5KGtleSk7XG4gIHJldHVybiBjb2xsYXRpb25JbmRleChrZXkpICsgU0VQICsgaW5kZXhpZnkoa2V5KSArIHplcm87XG59O1xuXG5mdW5jdGlvbiBwYXJzZU51bWJlcihzdHIsIGkpIHtcbiAgdmFyIG9yaWdpbmFsSWR4ID0gaTtcbiAgdmFyIG51bTtcbiAgdmFyIHplcm8gPSBzdHJbaV0gPT09ICcxJztcbiAgaWYgKHplcm8pIHtcbiAgICBudW0gPSAwO1xuICAgIGkrKztcbiAgfSBlbHNlIHtcbiAgICB2YXIgbmVnID0gc3RyW2ldID09PSAnMCc7XG4gICAgaSsrO1xuICAgIHZhciBudW1Bc1N0cmluZyA9ICcnO1xuICAgIHZhciBtYWdBc1N0cmluZyA9IHN0ci5zdWJzdHJpbmcoaSwgaSArIE1BR05JVFVERV9ESUdJVFMpO1xuICAgIHZhciBtYWduaXR1ZGUgPSBwYXJzZUludChtYWdBc1N0cmluZywgMTApICsgTUlOX01BR05JVFVERTtcbiAgICBpZiAobmVnKSB7XG4gICAgICBtYWduaXR1ZGUgPSAtbWFnbml0dWRlO1xuICAgIH1cbiAgICBpICs9IE1BR05JVFVERV9ESUdJVFM7XG4gICAgd2hpbGUgKHRydWUpIHtcbiAgICAgIHZhciBjaCA9IHN0cltpXTtcbiAgICAgIGlmIChjaCA9PT0gJ1xcdTAwMDAnKSB7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbnVtQXNTdHJpbmcgKz0gY2g7XG4gICAgICB9XG4gICAgICBpKys7XG4gICAgfVxuICAgIG51bUFzU3RyaW5nID0gbnVtQXNTdHJpbmcuc3BsaXQoJy4nKTtcbiAgICBpZiAobnVtQXNTdHJpbmcubGVuZ3RoID09PSAxKSB7XG4gICAgICBudW0gPSBwYXJzZUludChudW1Bc1N0cmluZywgMTApO1xuICAgIH0gZWxzZSB7XG4gICAgICBudW0gPSBwYXJzZUZsb2F0KG51bUFzU3RyaW5nWzBdICsgJy4nICsgbnVtQXNTdHJpbmdbMV0pO1xuICAgIH1cbiAgICBpZiAobmVnKSB7XG4gICAgICBudW0gPSBudW0gLSAxMDtcbiAgICB9XG4gICAgaWYgKG1hZ25pdHVkZSAhPT0gMCkge1xuICAgICAgLy8gcGFyc2VGbG9hdCBpcyBtb3JlIHJlbGlhYmxlIHRoYW4gcG93IGR1ZSB0byByb3VuZGluZyBlcnJvcnNcbiAgICAgIC8vIGUuZy4gTnVtYmVyLk1BWF9WQUxVRSB3b3VsZCByZXR1cm4gSW5maW5pdHkgaWYgd2UgZGlkXG4gICAgICAvLyBudW0gKiBNYXRoLnBvdygxMCwgbWFnbml0dWRlKTtcbiAgICAgIG51bSA9IHBhcnNlRmxvYXQobnVtICsgJ2UnICsgbWFnbml0dWRlKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHtudW06IG51bSwgbGVuZ3RoIDogaSAtIG9yaWdpbmFsSWR4fTtcbn1cblxuLy8gbW92ZSB1cCB0aGUgc3RhY2sgd2hpbGUgcGFyc2luZ1xuLy8gdGhpcyBmdW5jdGlvbiBtb3ZlZCBvdXRzaWRlIG9mIHBhcnNlSW5kZXhhYmxlU3RyaW5nIGZvciBwZXJmb3JtYW5jZVxuZnVuY3Rpb24gcG9wKHN0YWNrLCBtZXRhU3RhY2spIHtcbiAgdmFyIG9iaiA9IHN0YWNrLnBvcCgpO1xuXG4gIGlmIChtZXRhU3RhY2subGVuZ3RoKSB7XG4gICAgdmFyIGxhc3RNZXRhRWxlbWVudCA9IG1ldGFTdGFja1ttZXRhU3RhY2subGVuZ3RoIC0gMV07XG4gICAgaWYgKG9iaiA9PT0gbGFzdE1ldGFFbGVtZW50LmVsZW1lbnQpIHtcbiAgICAgIC8vIHBvcHBpbmcgYSBtZXRhLWVsZW1lbnQsIGUuZy4gYW4gb2JqZWN0IHdob3NlIHZhbHVlIGlzIGFub3RoZXIgb2JqZWN0XG4gICAgICBtZXRhU3RhY2sucG9wKCk7XG4gICAgICBsYXN0TWV0YUVsZW1lbnQgPSBtZXRhU3RhY2tbbWV0YVN0YWNrLmxlbmd0aCAtIDFdO1xuICAgIH1cbiAgICB2YXIgZWxlbWVudCA9IGxhc3RNZXRhRWxlbWVudC5lbGVtZW50O1xuICAgIHZhciBsYXN0RWxlbWVudEluZGV4ID0gbGFzdE1ldGFFbGVtZW50LmluZGV4O1xuICAgIGlmIChBcnJheS5pc0FycmF5KGVsZW1lbnQpKSB7XG4gICAgICBlbGVtZW50LnB1c2gob2JqKTtcbiAgICB9IGVsc2UgaWYgKGxhc3RFbGVtZW50SW5kZXggPT09IHN0YWNrLmxlbmd0aCAtIDIpIHsgLy8gb2JqIHdpdGgga2V5K3ZhbHVlXG4gICAgICB2YXIga2V5ID0gc3RhY2sucG9wKCk7XG4gICAgICBlbGVtZW50W2tleV0gPSBvYmo7XG4gICAgfSBlbHNlIHtcbiAgICAgIHN0YWNrLnB1c2gob2JqKTsgLy8gb2JqIHdpdGgga2V5IG9ubHlcbiAgICB9XG4gIH1cbn1cblxuZXhwb3J0cy5wYXJzZUluZGV4YWJsZVN0cmluZyA9IGZ1bmN0aW9uIChzdHIpIHtcbiAgdmFyIHN0YWNrID0gW107XG4gIHZhciBtZXRhU3RhY2sgPSBbXTsgLy8gc3RhY2sgZm9yIGFycmF5cyBhbmQgb2JqZWN0c1xuICB2YXIgaSA9IDA7XG5cbiAgd2hpbGUgKHRydWUpIHtcbiAgICB2YXIgY29sbGF0aW9uSW5kZXggPSBzdHJbaSsrXTtcbiAgICBpZiAoY29sbGF0aW9uSW5kZXggPT09ICdcXHUwMDAwJykge1xuICAgICAgaWYgKHN0YWNrLmxlbmd0aCA9PT0gMSkge1xuICAgICAgICByZXR1cm4gc3RhY2sucG9wKCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBwb3Aoc3RhY2ssIG1ldGFTdGFjayk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgIH1cbiAgICBzd2l0Y2ggKGNvbGxhdGlvbkluZGV4KSB7XG4gICAgICBjYXNlICcxJzpcbiAgICAgICAgc3RhY2sucHVzaChudWxsKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICcyJzpcbiAgICAgICAgc3RhY2sucHVzaChzdHJbaV0gPT09ICcxJyk7XG4gICAgICAgIGkrKztcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICczJzpcbiAgICAgICAgdmFyIHBhcnNlZE51bSA9IHBhcnNlTnVtYmVyKHN0ciwgaSk7XG4gICAgICAgIHN0YWNrLnB1c2gocGFyc2VkTnVtLm51bSk7XG4gICAgICAgIGkgKz0gcGFyc2VkTnVtLmxlbmd0aDtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICc0JzpcbiAgICAgICAgdmFyIHBhcnNlZFN0ciA9ICcnO1xuICAgICAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgICAgIHZhciBjaCA9IHN0cltpXTtcbiAgICAgICAgICBpZiAoY2ggPT09ICdcXHUwMDAwJykge1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICAgIHBhcnNlZFN0ciArPSBjaDtcbiAgICAgICAgICBpKys7XG4gICAgICAgIH1cbiAgICAgICAgLy8gcGVyZm9ybSB0aGUgcmV2ZXJzZSBvZiB0aGUgb3JkZXItcHJlc2VydmluZyByZXBsYWNlbWVudFxuICAgICAgICAvLyBhbGdvcml0aG0gKHNlZSBhYm92ZSlcbiAgICAgICAgcGFyc2VkU3RyID0gcGFyc2VkU3RyLnJlcGxhY2UoL1xcdTAwMDFcXHUwMDAxL2csICdcXHUwMDAwJylcbiAgICAgICAgICAucmVwbGFjZSgvXFx1MDAwMVxcdTAwMDIvZywgJ1xcdTAwMDEnKVxuICAgICAgICAgIC5yZXBsYWNlKC9cXHUwMDAyXFx1MDAwMi9nLCAnXFx1MDAwMicpO1xuICAgICAgICBzdGFjay5wdXNoKHBhcnNlZFN0cik7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnNSc6XG4gICAgICAgIHZhciBhcnJheUVsZW1lbnQgPSB7IGVsZW1lbnQ6IFtdLCBpbmRleDogc3RhY2subGVuZ3RoIH07XG4gICAgICAgIHN0YWNrLnB1c2goYXJyYXlFbGVtZW50LmVsZW1lbnQpO1xuICAgICAgICBtZXRhU3RhY2sucHVzaChhcnJheUVsZW1lbnQpO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJzYnOlxuICAgICAgICB2YXIgb2JqRWxlbWVudCA9IHsgZWxlbWVudDoge30sIGluZGV4OiBzdGFjay5sZW5ndGggfTtcbiAgICAgICAgc3RhY2sucHVzaChvYmpFbGVtZW50LmVsZW1lbnQpO1xuICAgICAgICBtZXRhU3RhY2sucHVzaChvYmpFbGVtZW50KTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgJ2JhZCBjb2xsYXRpb25JbmRleCBvciB1bmV4cGVjdGVkbHkgcmVhY2hlZCBlbmQgb2YgaW5wdXQ6ICcgKyBjb2xsYXRpb25JbmRleCk7XG4gICAgfVxuICB9XG59O1xuXG5mdW5jdGlvbiBhcnJheUNvbGxhdGUoYSwgYikge1xuICB2YXIgbGVuID0gTWF0aC5taW4oYS5sZW5ndGgsIGIubGVuZ3RoKTtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW47IGkrKykge1xuICAgIHZhciBzb3J0ID0gZXhwb3J0cy5jb2xsYXRlKGFbaV0sIGJbaV0pO1xuICAgIGlmIChzb3J0ICE9PSAwKSB7XG4gICAgICByZXR1cm4gc29ydDtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIChhLmxlbmd0aCA9PT0gYi5sZW5ndGgpID8gMCA6XG4gICAgKGEubGVuZ3RoID4gYi5sZW5ndGgpID8gMSA6IC0xO1xufVxuZnVuY3Rpb24gc3RyaW5nQ29sbGF0ZShhLCBiKSB7XG4gIC8vIFNlZTogaHR0cHM6Ly9naXRodWIuY29tL2RhbGVoYXJ2ZXkvcG91Y2hkYi9pc3N1ZXMvNDBcbiAgLy8gVGhpcyBpcyBpbmNvbXBhdGlibGUgd2l0aCB0aGUgQ291Y2hEQiBpbXBsZW1lbnRhdGlvbiwgYnV0IGl0cyB0aGVcbiAgLy8gYmVzdCB3ZSBjYW4gZG8gZm9yIG5vd1xuICByZXR1cm4gKGEgPT09IGIpID8gMCA6ICgoYSA+IGIpID8gMSA6IC0xKTtcbn1cbmZ1bmN0aW9uIG9iamVjdENvbGxhdGUoYSwgYikge1xuICB2YXIgYWsgPSBPYmplY3Qua2V5cyhhKSwgYmsgPSBPYmplY3Qua2V5cyhiKTtcbiAgdmFyIGxlbiA9IE1hdGgubWluKGFrLmxlbmd0aCwgYmsubGVuZ3RoKTtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW47IGkrKykge1xuICAgIC8vIEZpcnN0IHNvcnQgdGhlIGtleXNcbiAgICB2YXIgc29ydCA9IGV4cG9ydHMuY29sbGF0ZShha1tpXSwgYmtbaV0pO1xuICAgIGlmIChzb3J0ICE9PSAwKSB7XG4gICAgICByZXR1cm4gc29ydDtcbiAgICB9XG4gICAgLy8gaWYgdGhlIGtleXMgYXJlIGVxdWFsIHNvcnQgdGhlIHZhbHVlc1xuICAgIHNvcnQgPSBleHBvcnRzLmNvbGxhdGUoYVtha1tpXV0sIGJbYmtbaV1dKTtcbiAgICBpZiAoc29ydCAhPT0gMCkge1xuICAgICAgcmV0dXJuIHNvcnQ7XG4gICAgfVxuXG4gIH1cbiAgcmV0dXJuIChhay5sZW5ndGggPT09IGJrLmxlbmd0aCkgPyAwIDpcbiAgICAoYWsubGVuZ3RoID4gYmsubGVuZ3RoKSA/IDEgOiAtMTtcbn1cbi8vIFRoZSBjb2xsYXRpb24gaXMgZGVmaW5lZCBieSBlcmxhbmdzIG9yZGVyZWQgdGVybXNcbi8vIHRoZSBhdG9tcyBudWxsLCB0cnVlLCBmYWxzZSBjb21lIGZpcnN0LCB0aGVuIG51bWJlcnMsIHN0cmluZ3MsXG4vLyBhcnJheXMsIHRoZW4gb2JqZWN0c1xuLy8gbnVsbC91bmRlZmluZWQvTmFOL0luZmluaXR5Ly1JbmZpbml0eSBhcmUgYWxsIGNvbnNpZGVyZWQgbnVsbFxuZnVuY3Rpb24gY29sbGF0aW9uSW5kZXgoeCkge1xuICB2YXIgaWQgPSBbJ2Jvb2xlYW4nLCAnbnVtYmVyJywgJ3N0cmluZycsICdvYmplY3QnXTtcbiAgdmFyIGlkeCA9IGlkLmluZGV4T2YodHlwZW9mIHgpO1xuICAvL2ZhbHNlIGlmIC0xIG90aGVyd2lzZSB0cnVlLCBidXQgZmFzdCEhISExXG4gIGlmICh+aWR4KSB7XG4gICAgaWYgKHggPT09IG51bGwpIHtcbiAgICAgIHJldHVybiAxO1xuICAgIH1cbiAgICBpZiAoQXJyYXkuaXNBcnJheSh4KSkge1xuICAgICAgcmV0dXJuIDU7XG4gICAgfVxuICAgIHJldHVybiBpZHggPCAzID8gKGlkeCArIDIpIDogKGlkeCArIDMpO1xuICB9XG4gIGlmIChBcnJheS5pc0FycmF5KHgpKSB7XG4gICAgcmV0dXJuIDU7XG4gIH1cbn1cblxuLy8gY29udmVyc2lvbjpcbi8vIHggeXl5IHp6Li4uenpcbi8vIHggPSAwIGZvciBuZWdhdGl2ZSwgMSBmb3IgMCwgMiBmb3IgcG9zaXRpdmVcbi8vIHkgPSBleHBvbmVudCAoZm9yIG5lZ2F0aXZlIG51bWJlcnMgbmVnYXRlZCkgbW92ZWQgc28gdGhhdCBpdCdzID49IDBcbi8vIHogPSBtYW50aXNzZVxuZnVuY3Rpb24gbnVtVG9JbmRleGFibGVTdHJpbmcobnVtKSB7XG5cbiAgaWYgKG51bSA9PT0gMCkge1xuICAgIHJldHVybiAnMSc7XG4gIH1cblxuICAvLyBjb252ZXJ0IG51bWJlciB0byBleHBvbmVudGlhbCBmb3JtYXQgZm9yIGVhc2llciBhbmRcbiAgLy8gbW9yZSBzdWNjaW5jdCBzdHJpbmcgc29ydGluZ1xuICB2YXIgZXhwRm9ybWF0ID0gbnVtLnRvRXhwb25lbnRpYWwoKS5zcGxpdCgvZVxcKz8vKTtcbiAgdmFyIG1hZ25pdHVkZSA9IHBhcnNlSW50KGV4cEZvcm1hdFsxXSwgMTApO1xuXG4gIHZhciBuZWcgPSBudW0gPCAwO1xuXG4gIHZhciByZXN1bHQgPSBuZWcgPyAnMCcgOiAnMic7XG5cbiAgLy8gZmlyc3Qgc29ydCBieSBtYWduaXR1ZGVcbiAgLy8gaXQncyBlYXNpZXIgaWYgYWxsIG1hZ25pdHVkZXMgYXJlIHBvc2l0aXZlXG4gIHZhciBtYWdGb3JDb21wYXJpc29uID0gKChuZWcgPyAtbWFnbml0dWRlIDogbWFnbml0dWRlKSAtIE1JTl9NQUdOSVRVREUpO1xuICB2YXIgbWFnU3RyaW5nID0gdXRpbHMucGFkTGVmdCgobWFnRm9yQ29tcGFyaXNvbikudG9TdHJpbmcoKSwgJzAnLCBNQUdOSVRVREVfRElHSVRTKTtcblxuICByZXN1bHQgKz0gU0VQICsgbWFnU3RyaW5nO1xuXG4gIC8vIHRoZW4gc29ydCBieSB0aGUgZmFjdG9yXG4gIHZhciBmYWN0b3IgPSBNYXRoLmFicyhwYXJzZUZsb2F0KGV4cEZvcm1hdFswXSkpOyAvLyBbMS4uMTApXG4gIGlmIChuZWcpIHsgLy8gZm9yIG5lZ2F0aXZlIHJldmVyc2Ugb3JkZXJpbmdcbiAgICBmYWN0b3IgPSAxMCAtIGZhY3RvcjtcbiAgfVxuXG4gIHZhciBmYWN0b3JTdHIgPSBmYWN0b3IudG9GaXhlZCgyMCk7XG5cbiAgLy8gc3RyaXAgemVyb3MgZnJvbSB0aGUgZW5kXG4gIGZhY3RvclN0ciA9IGZhY3RvclN0ci5yZXBsYWNlKC9cXC4/MCskLywgJycpO1xuXG4gIHJlc3VsdCArPSBTRVAgKyBmYWN0b3JTdHI7XG5cbiAgcmV0dXJuIHJlc3VsdDtcbn1cbiIsIid1c2Ugc3RyaWN0JztcblxuZnVuY3Rpb24gcGFkKHN0ciwgcGFkV2l0aCwgdXBUb0xlbmd0aCkge1xuICB2YXIgcGFkZGluZyA9ICcnO1xuICB2YXIgdGFyZ2V0TGVuZ3RoID0gdXBUb0xlbmd0aCAtIHN0ci5sZW5ndGg7XG4gIHdoaWxlIChwYWRkaW5nLmxlbmd0aCA8IHRhcmdldExlbmd0aCkge1xuICAgIHBhZGRpbmcgKz0gcGFkV2l0aDtcbiAgfVxuICByZXR1cm4gcGFkZGluZztcbn1cblxuZXhwb3J0cy5wYWRMZWZ0ID0gZnVuY3Rpb24gKHN0ciwgcGFkV2l0aCwgdXBUb0xlbmd0aCkge1xuICB2YXIgcGFkZGluZyA9IHBhZChzdHIsIHBhZFdpdGgsIHVwVG9MZW5ndGgpO1xuICByZXR1cm4gcGFkZGluZyArIHN0cjtcbn07XG5cbmV4cG9ydHMucGFkUmlnaHQgPSBmdW5jdGlvbiAoc3RyLCBwYWRXaXRoLCB1cFRvTGVuZ3RoKSB7XG4gIHZhciBwYWRkaW5nID0gcGFkKHN0ciwgcGFkV2l0aCwgdXBUb0xlbmd0aCk7XG4gIHJldHVybiBzdHIgKyBwYWRkaW5nO1xufTtcblxuZXhwb3J0cy5zdHJpbmdMZXhDb21wYXJlID0gZnVuY3Rpb24gKGEsIGIpIHtcblxuICB2YXIgYUxlbiA9IGEubGVuZ3RoO1xuICB2YXIgYkxlbiA9IGIubGVuZ3RoO1xuXG4gIHZhciBpO1xuICBmb3IgKGkgPSAwOyBpIDwgYUxlbjsgaSsrKSB7XG4gICAgaWYgKGkgPT09IGJMZW4pIHtcbiAgICAgIC8vIGIgaXMgc2hvcnRlciBzdWJzdHJpbmcgb2YgYVxuICAgICAgcmV0dXJuIDE7XG4gICAgfVxuICAgIHZhciBhQ2hhciA9IGEuY2hhckF0KGkpO1xuICAgIHZhciBiQ2hhciA9IGIuY2hhckF0KGkpO1xuICAgIGlmIChhQ2hhciAhPT0gYkNoYXIpIHtcbiAgICAgIHJldHVybiBhQ2hhciA8IGJDaGFyID8gLTEgOiAxO1xuICAgIH1cbiAgfVxuXG4gIGlmIChhTGVuIDwgYkxlbikge1xuICAgIC8vIGEgaXMgc2hvcnRlciBzdWJzdHJpbmcgb2YgYlxuICAgIHJldHVybiAtMTtcbiAgfVxuXG4gIHJldHVybiAwO1xufTtcblxuLypcbiAqIHJldHVybnMgdGhlIGRlY2ltYWwgZm9ybSBmb3IgdGhlIGdpdmVuIGludGVnZXIsIGkuZS4gd3JpdGVzXG4gKiBvdXQgYWxsIHRoZSBkaWdpdHMgKGluIGJhc2UtMTApIGluc3RlYWQgb2YgdXNpbmcgc2NpZW50aWZpYyBub3RhdGlvblxuICovXG5leHBvcnRzLmludFRvRGVjaW1hbEZvcm0gPSBmdW5jdGlvbiAoaW50KSB7XG5cbiAgdmFyIGlzTmVnID0gaW50IDwgMDtcbiAgdmFyIHJlc3VsdCA9ICcnO1xuXG4gIGRvIHtcbiAgICB2YXIgcmVtYWluZGVyID0gaXNOZWcgPyAtTWF0aC5jZWlsKGludCAlIDEwKSA6IE1hdGguZmxvb3IoaW50ICUgMTApO1xuXG4gICAgcmVzdWx0ID0gcmVtYWluZGVyICsgcmVzdWx0O1xuICAgIGludCA9IGlzTmVnID8gTWF0aC5jZWlsKGludCAvIDEwKSA6IE1hdGguZmxvb3IoaW50IC8gMTApO1xuICB9IHdoaWxlIChpbnQpO1xuXG5cbiAgaWYgKGlzTmVnICYmIHJlc3VsdCAhPT0gJzAnKSB7XG4gICAgcmVzdWx0ID0gJy0nICsgcmVzdWx0O1xuICB9XG5cbiAgcmV0dXJuIHJlc3VsdDtcbn07IiwiJ3VzZSBzdHJpY3QnO1xuZXhwb3J0cy5NYXAgPSBMYXp5TWFwOyAvLyBUT0RPOiB1c2UgRVM2IG1hcFxuZXhwb3J0cy5TZXQgPSBMYXp5U2V0OyAvLyBUT0RPOiB1c2UgRVM2IHNldFxuLy8gYmFzZWQgb24gaHR0cHM6Ly9naXRodWIuY29tL21vbnRhZ2Vqcy9jb2xsZWN0aW9uc1xuZnVuY3Rpb24gTGF6eU1hcCgpIHtcbiAgdGhpcy5zdG9yZSA9IHt9O1xufVxuTGF6eU1hcC5wcm90b3R5cGUubWFuZ2xlID0gZnVuY3Rpb24gKGtleSkge1xuICBpZiAodHlwZW9mIGtleSAhPT0gXCJzdHJpbmdcIikge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXCJrZXkgbXVzdCBiZSBhIHN0cmluZyBidXQgR290IFwiICsga2V5KTtcbiAgfVxuICByZXR1cm4gJyQnICsga2V5O1xufTtcbkxhenlNYXAucHJvdG90eXBlLnVubWFuZ2xlID0gZnVuY3Rpb24gKGtleSkge1xuICByZXR1cm4ga2V5LnN1YnN0cmluZygxKTtcbn07XG5MYXp5TWFwLnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbiAoa2V5KSB7XG4gIHZhciBtYW5nbGVkID0gdGhpcy5tYW5nbGUoa2V5KTtcbiAgaWYgKG1hbmdsZWQgaW4gdGhpcy5zdG9yZSkge1xuICAgIHJldHVybiB0aGlzLnN0b3JlW21hbmdsZWRdO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiB2b2lkIDA7XG4gIH1cbn07XG5MYXp5TWFwLnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbiAoa2V5LCB2YWx1ZSkge1xuICB2YXIgbWFuZ2xlZCA9IHRoaXMubWFuZ2xlKGtleSk7XG4gIHRoaXMuc3RvcmVbbWFuZ2xlZF0gPSB2YWx1ZTtcbiAgcmV0dXJuIHRydWU7XG59O1xuTGF6eU1hcC5wcm90b3R5cGUuaGFzID0gZnVuY3Rpb24gKGtleSkge1xuICB2YXIgbWFuZ2xlZCA9IHRoaXMubWFuZ2xlKGtleSk7XG4gIHJldHVybiBtYW5nbGVkIGluIHRoaXMuc3RvcmU7XG59O1xuTGF6eU1hcC5wcm90b3R5cGUuZGVsZXRlID0gZnVuY3Rpb24gKGtleSkge1xuICB2YXIgbWFuZ2xlZCA9IHRoaXMubWFuZ2xlKGtleSk7XG4gIGlmIChtYW5nbGVkIGluIHRoaXMuc3RvcmUpIHtcbiAgICBkZWxldGUgdGhpcy5zdG9yZVttYW5nbGVkXTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59O1xuTGF6eU1hcC5wcm90b3R5cGUuZm9yRWFjaCA9IGZ1bmN0aW9uIChjYikge1xuICB2YXIgc2VsZiA9IHRoaXM7XG4gIHZhciBrZXlzID0gT2JqZWN0LmtleXMoc2VsZi5zdG9yZSk7XG4gIGtleXMuZm9yRWFjaChmdW5jdGlvbiAoa2V5KSB7XG4gICAgdmFyIHZhbHVlID0gc2VsZi5zdG9yZVtrZXldO1xuICAgIGtleSA9IHNlbGYudW5tYW5nbGUoa2V5KTtcbiAgICBjYih2YWx1ZSwga2V5KTtcbiAgfSk7XG59O1xuXG5mdW5jdGlvbiBMYXp5U2V0KGFycmF5KSB7XG4gIHRoaXMuc3RvcmUgPSBuZXcgTGF6eU1hcCgpO1xuXG4gIC8vIGluaXQgd2l0aCBhbiBhcnJheVxuICBpZiAoYXJyYXkgJiYgQXJyYXkuaXNBcnJheShhcnJheSkpIHtcbiAgICBmb3IgKHZhciBpID0gMCwgbGVuID0gYXJyYXkubGVuZ3RoOyBpIDwgbGVuOyBpKyspIHtcbiAgICAgIHRoaXMuYWRkKGFycmF5W2ldKTtcbiAgICB9XG4gIH1cbn1cbkxhenlTZXQucHJvdG90eXBlLmFkZCA9IGZ1bmN0aW9uIChrZXkpIHtcbiAgcmV0dXJuIHRoaXMuc3RvcmUuc2V0KGtleSwgdHJ1ZSk7XG59O1xuTGF6eVNldC5wcm90b3R5cGUuaGFzID0gZnVuY3Rpb24gKGtleSkge1xuICByZXR1cm4gdGhpcy5zdG9yZS5oYXMoa2V5KTtcbn07XG5MYXp5U2V0LnByb3RvdHlwZS5kZWxldGUgPSBmdW5jdGlvbiAoa2V5KSB7XG4gIHJldHVybiB0aGlzLnN0b3JlLmRlbGV0ZShrZXkpO1xufTtcbiIsIlwidXNlIHN0cmljdFwiO1xuXG4vLyBFeHRlbmRzIG1ldGhvZFxuLy8gKHRha2VuIGZyb20gaHR0cDovL2NvZGUuanF1ZXJ5LmNvbS9qcXVlcnktMS45LjAuanMpXG4vLyBQb3B1bGF0ZSB0aGUgY2xhc3MydHlwZSBtYXBcbnZhciBjbGFzczJ0eXBlID0ge307XG5cbnZhciB0eXBlcyA9IFtcbiAgXCJCb29sZWFuXCIsIFwiTnVtYmVyXCIsIFwiU3RyaW5nXCIsIFwiRnVuY3Rpb25cIiwgXCJBcnJheVwiLFxuICBcIkRhdGVcIiwgXCJSZWdFeHBcIiwgXCJPYmplY3RcIiwgXCJFcnJvclwiXG5dO1xuZm9yICh2YXIgaSA9IDA7IGkgPCB0eXBlcy5sZW5ndGg7IGkrKykge1xuICB2YXIgdHlwZW5hbWUgPSB0eXBlc1tpXTtcbiAgY2xhc3MydHlwZVtcIltvYmplY3QgXCIgKyB0eXBlbmFtZSArIFwiXVwiXSA9IHR5cGVuYW1lLnRvTG93ZXJDYXNlKCk7XG59XG5cbnZhciBjb3JlX3RvU3RyaW5nID0gY2xhc3MydHlwZS50b1N0cmluZztcbnZhciBjb3JlX2hhc093biA9IGNsYXNzMnR5cGUuaGFzT3duUHJvcGVydHk7XG5cbmZ1bmN0aW9uIHR5cGUob2JqKSB7XG4gIGlmIChvYmogPT09IG51bGwpIHtcbiAgICByZXR1cm4gU3RyaW5nKG9iaik7XG4gIH1cbiAgcmV0dXJuIHR5cGVvZiBvYmogPT09IFwib2JqZWN0XCIgfHwgdHlwZW9mIG9iaiA9PT0gXCJmdW5jdGlvblwiID9cbiAgICBjbGFzczJ0eXBlW2NvcmVfdG9TdHJpbmcuY2FsbChvYmopXSB8fCBcIm9iamVjdFwiIDpcbiAgICB0eXBlb2Ygb2JqO1xufVxuXG5mdW5jdGlvbiBpc1dpbmRvdyhvYmopIHtcbiAgcmV0dXJuIG9iaiAhPT0gbnVsbCAmJiBvYmogPT09IG9iai53aW5kb3c7XG59XG5cbmZ1bmN0aW9uIGlzUGxhaW5PYmplY3Qob2JqKSB7XG4gIC8vIE11c3QgYmUgYW4gT2JqZWN0LlxuICAvLyBCZWNhdXNlIG9mIElFLCB3ZSBhbHNvIGhhdmUgdG8gY2hlY2sgdGhlIHByZXNlbmNlIG9mXG4gIC8vIHRoZSBjb25zdHJ1Y3RvciBwcm9wZXJ0eS5cbiAgLy8gTWFrZSBzdXJlIHRoYXQgRE9NIG5vZGVzIGFuZCB3aW5kb3cgb2JqZWN0cyBkb24ndCBwYXNzIHRocm91Z2gsIGFzIHdlbGxcbiAgaWYgKCFvYmogfHwgdHlwZShvYmopICE9PSBcIm9iamVjdFwiIHx8IG9iai5ub2RlVHlwZSB8fCBpc1dpbmRvdyhvYmopKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgdHJ5IHtcbiAgICAvLyBOb3Qgb3duIGNvbnN0cnVjdG9yIHByb3BlcnR5IG11c3QgYmUgT2JqZWN0XG4gICAgaWYgKG9iai5jb25zdHJ1Y3RvciAmJlxuICAgICAgIWNvcmVfaGFzT3duLmNhbGwob2JqLCBcImNvbnN0cnVjdG9yXCIpICYmXG4gICAgICAhY29yZV9oYXNPd24uY2FsbChvYmouY29uc3RydWN0b3IucHJvdG90eXBlLCBcImlzUHJvdG90eXBlT2ZcIikpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH0gY2F0Y2ggKCBlICkge1xuICAgIC8vIElFOCw5IFdpbGwgdGhyb3cgZXhjZXB0aW9ucyBvbiBjZXJ0YWluIGhvc3Qgb2JqZWN0cyAjOTg5N1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIC8vIE93biBwcm9wZXJ0aWVzIGFyZSBlbnVtZXJhdGVkIGZpcnN0bHksIHNvIHRvIHNwZWVkIHVwLFxuICAvLyBpZiBsYXN0IG9uZSBpcyBvd24sIHRoZW4gYWxsIHByb3BlcnRpZXMgYXJlIG93bi5cbiAgdmFyIGtleTtcbiAgZm9yIChrZXkgaW4gb2JqKSB7fVxuXG4gIHJldHVybiBrZXkgPT09IHVuZGVmaW5lZCB8fCBjb3JlX2hhc093bi5jYWxsKG9iaiwga2V5KTtcbn1cblxuXG5mdW5jdGlvbiBpc0Z1bmN0aW9uKG9iaikge1xuICByZXR1cm4gdHlwZShvYmopID09PSBcImZ1bmN0aW9uXCI7XG59XG5cbnZhciBpc0FycmF5ID0gQXJyYXkuaXNBcnJheSB8fCBmdW5jdGlvbiAob2JqKSB7XG4gIHJldHVybiB0eXBlKG9iaikgPT09IFwiYXJyYXlcIjtcbn07XG5cbmZ1bmN0aW9uIGV4dGVuZCgpIHtcbiAgLy8gb3JpZ2luYWxseSBleHRlbmQoKSB3YXMgcmVjdXJzaXZlLCBidXQgdGhpcyBlbmRlZCB1cCBnaXZpbmcgdXNcbiAgLy8gXCJjYWxsIHN0YWNrIGV4Y2VlZGVkXCIsIHNvIGl0J3MgYmVlbiB1bnJvbGxlZCB0byB1c2UgYSBsaXRlcmFsIHN0YWNrXG4gIC8vIChzZWUgaHR0cHM6Ly9naXRodWIuY29tL3BvdWNoZGIvcG91Y2hkYi9pc3N1ZXMvMjU0MylcbiAgdmFyIHN0YWNrID0gW107XG4gIHZhciBpID0gLTE7XG4gIHZhciBsZW4gPSBhcmd1bWVudHMubGVuZ3RoO1xuICB2YXIgYXJncyA9IG5ldyBBcnJheShsZW4pO1xuICB3aGlsZSAoKytpIDwgbGVuKSB7XG4gICAgYXJnc1tpXSA9IGFyZ3VtZW50c1tpXTtcbiAgfVxuICB2YXIgY29udGFpbmVyID0ge307XG4gIHN0YWNrLnB1c2goe2FyZ3M6IGFyZ3MsIHJlc3VsdDoge2NvbnRhaW5lcjogY29udGFpbmVyLCBrZXk6ICdrZXknfX0pO1xuICB2YXIgbmV4dDtcbiAgd2hpbGUgKChuZXh0ID0gc3RhY2sucG9wKCkpKSB7XG4gICAgZXh0ZW5kSW5uZXIoc3RhY2ssIG5leHQuYXJncywgbmV4dC5yZXN1bHQpO1xuICB9XG4gIHJldHVybiBjb250YWluZXIua2V5O1xufVxuXG5mdW5jdGlvbiBleHRlbmRJbm5lcihzdGFjaywgYXJncywgcmVzdWx0KSB7XG4gIHZhciBvcHRpb25zLCBuYW1lLCBzcmMsIGNvcHksIGNvcHlJc0FycmF5LCBjbG9uZSxcbiAgICB0YXJnZXQgPSBhcmdzWzBdIHx8IHt9LFxuICAgIGkgPSAxLFxuICAgIGxlbmd0aCA9IGFyZ3MubGVuZ3RoLFxuICAgIGRlZXAgPSBmYWxzZSxcbiAgICBudW1lcmljU3RyaW5nUmVnZXggPSAvXFxkKy8sXG4gICAgb3B0aW9uc0lzQXJyYXk7XG5cbiAgLy8gSGFuZGxlIGEgZGVlcCBjb3B5IHNpdHVhdGlvblxuICBpZiAodHlwZW9mIHRhcmdldCA9PT0gXCJib29sZWFuXCIpIHtcbiAgICBkZWVwID0gdGFyZ2V0O1xuICAgIHRhcmdldCA9IGFyZ3NbMV0gfHwge307XG4gICAgLy8gc2tpcCB0aGUgYm9vbGVhbiBhbmQgdGhlIHRhcmdldFxuICAgIGkgPSAyO1xuICB9XG5cbiAgLy8gSGFuZGxlIGNhc2Ugd2hlbiB0YXJnZXQgaXMgYSBzdHJpbmcgb3Igc29tZXRoaW5nIChwb3NzaWJsZSBpbiBkZWVwIGNvcHkpXG4gIGlmICh0eXBlb2YgdGFyZ2V0ICE9PSBcIm9iamVjdFwiICYmICFpc0Z1bmN0aW9uKHRhcmdldCkpIHtcbiAgICB0YXJnZXQgPSB7fTtcbiAgfVxuXG4gIC8vIGV4dGVuZCBqUXVlcnkgaXRzZWxmIGlmIG9ubHkgb25lIGFyZ3VtZW50IGlzIHBhc3NlZFxuICBpZiAobGVuZ3RoID09PSBpKSB7XG4gICAgLyoganNoaW50IHZhbGlkdGhpczogdHJ1ZSAqL1xuICAgIHRhcmdldCA9IHRoaXM7XG4gICAgLS1pO1xuICB9XG5cbiAgZm9yICg7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgIC8vIE9ubHkgZGVhbCB3aXRoIG5vbi1udWxsL3VuZGVmaW5lZCB2YWx1ZXNcbiAgICBpZiAoKG9wdGlvbnMgPSBhcmdzW2ldKSAhPSBudWxsKSB7XG4gICAgICBvcHRpb25zSXNBcnJheSA9IGlzQXJyYXkob3B0aW9ucyk7XG4gICAgICAvLyBFeHRlbmQgdGhlIGJhc2Ugb2JqZWN0XG4gICAgICBmb3IgKG5hbWUgaW4gb3B0aW9ucykge1xuICAgICAgICAvL2lmIChvcHRpb25zLmhhc093blByb3BlcnR5KG5hbWUpKSB7XG4gICAgICAgIGlmICghKG5hbWUgaW4gT2JqZWN0LnByb3RvdHlwZSkpIHtcbiAgICAgICAgICBpZiAob3B0aW9uc0lzQXJyYXkgJiYgIW51bWVyaWNTdHJpbmdSZWdleC50ZXN0KG5hbWUpKSB7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBzcmMgPSB0YXJnZXRbbmFtZV07XG4gICAgICAgICAgY29weSA9IG9wdGlvbnNbbmFtZV07XG5cbiAgICAgICAgICAvLyBQcmV2ZW50IG5ldmVyLWVuZGluZyBsb29wXG4gICAgICAgICAgaWYgKHRhcmdldCA9PT0gY29weSkge1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgLy8gUmVjdXJzZSBpZiB3ZSdyZSBtZXJnaW5nIHBsYWluIG9iamVjdHMgb3IgYXJyYXlzXG4gICAgICAgICAgaWYgKGRlZXAgJiYgY29weSAmJiAoaXNQbGFpbk9iamVjdChjb3B5KSB8fFxuICAgICAgICAgICAgICAoY29weUlzQXJyYXkgPSBpc0FycmF5KGNvcHkpKSkpIHtcbiAgICAgICAgICAgIGlmIChjb3B5SXNBcnJheSkge1xuICAgICAgICAgICAgICBjb3B5SXNBcnJheSA9IGZhbHNlO1xuICAgICAgICAgICAgICBjbG9uZSA9IHNyYyAmJiBpc0FycmF5KHNyYykgPyBzcmMgOiBbXTtcblxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgY2xvbmUgPSBzcmMgJiYgaXNQbGFpbk9iamVjdChzcmMpID8gc3JjIDoge307XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIE5ldmVyIG1vdmUgb3JpZ2luYWwgb2JqZWN0cywgY2xvbmUgdGhlbVxuICAgICAgICAgICAgc3RhY2sucHVzaCh7XG4gICAgICAgICAgICAgIGFyZ3M6IFtkZWVwLCBjbG9uZSwgY29weV0sXG4gICAgICAgICAgICAgIHJlc3VsdDoge1xuICAgICAgICAgICAgICAgIGNvbnRhaW5lcjogdGFyZ2V0LFxuICAgICAgICAgICAgICAgIGtleTogbmFtZVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgIC8vIERvbid0IGJyaW5nIGluIHVuZGVmaW5lZCB2YWx1ZXNcbiAgICAgICAgICB9IGVsc2UgaWYgKGNvcHkgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgaWYgKCEoaXNBcnJheShvcHRpb25zKSAmJiBpc0Z1bmN0aW9uKGNvcHkpKSkge1xuICAgICAgICAgICAgICB0YXJnZXRbbmFtZV0gPSBjb3B5O1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vIFwiUmV0dXJuXCIgdGhlIG1vZGlmaWVkIG9iamVjdCBieSBzZXR0aW5nIHRoZSBrZXlcbiAgLy8gb24gdGhlIGdpdmVuIGNvbnRhaW5lclxuICByZXN1bHQuY29udGFpbmVyW3Jlc3VsdC5rZXldID0gdGFyZ2V0O1xufVxuXG5cbm1vZHVsZS5leHBvcnRzID0gZXh0ZW5kO1xuXG5cbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIHVwc2VydCA9IHJlcXVpcmUoJy4vdXBzZXJ0Jyk7XG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzJyk7XG52YXIgUHJvbWlzZSA9IHV0aWxzLlByb21pc2U7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKG9wdHMpIHtcbiAgdmFyIHNvdXJjZURCID0gb3B0cy5kYjtcbiAgdmFyIHZpZXdOYW1lID0gb3B0cy52aWV3TmFtZTtcbiAgdmFyIG1hcEZ1biA9IG9wdHMubWFwO1xuICB2YXIgcmVkdWNlRnVuID0gb3B0cy5yZWR1Y2U7XG4gIHZhciB0ZW1wb3JhcnkgPSBvcHRzLnRlbXBvcmFyeTtcblxuICAvLyB0aGUgXCJ1bmRlZmluZWRcIiBwYXJ0IGlzIGZvciBiYWNrd2FyZHMgY29tcGF0aWJpbGl0eVxuICB2YXIgdmlld1NpZ25hdHVyZSA9IG1hcEZ1bi50b1N0cmluZygpICsgKHJlZHVjZUZ1biAmJiByZWR1Y2VGdW4udG9TdHJpbmcoKSkgK1xuICAgICd1bmRlZmluZWQnO1xuXG4gIGlmICghdGVtcG9yYXJ5ICYmIHNvdXJjZURCLl9jYWNoZWRWaWV3cykge1xuICAgIHZhciBjYWNoZWRWaWV3ID0gc291cmNlREIuX2NhY2hlZFZpZXdzW3ZpZXdTaWduYXR1cmVdO1xuICAgIGlmIChjYWNoZWRWaWV3KSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKGNhY2hlZFZpZXcpO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBzb3VyY2VEQi5pbmZvKCkudGhlbihmdW5jdGlvbiAoaW5mbykge1xuXG4gICAgdmFyIGRlcERiTmFtZSA9IGluZm8uZGJfbmFtZSArICctbXJ2aWV3LScgK1xuICAgICAgKHRlbXBvcmFyeSA/ICd0ZW1wJyA6IHV0aWxzLk1ENSh2aWV3U2lnbmF0dXJlKSk7XG5cbiAgICAvLyBzYXZlIHRoZSB2aWV3IG5hbWUgaW4gdGhlIHNvdXJjZSBQb3VjaERCIHNvIGl0IGNhbiBiZSBjbGVhbmVkIHVwIGlmIG5lY2Vzc2FyeVxuICAgIC8vIChlLmcuIHdoZW4gdGhlIF9kZXNpZ24gZG9jIGlzIGRlbGV0ZWQsIHJlbW92ZSBhbGwgYXNzb2NpYXRlZCB2aWV3IGRhdGEpXG4gICAgZnVuY3Rpb24gZGlmZkZ1bmN0aW9uKGRvYykge1xuICAgICAgZG9jLnZpZXdzID0gZG9jLnZpZXdzIHx8IHt9O1xuICAgICAgdmFyIGZ1bGxWaWV3TmFtZSA9IHZpZXdOYW1lO1xuICAgICAgaWYgKGZ1bGxWaWV3TmFtZS5pbmRleE9mKCcvJykgPT09IC0xKSB7XG4gICAgICAgIGZ1bGxWaWV3TmFtZSA9IHZpZXdOYW1lICsgJy8nICsgdmlld05hbWU7XG4gICAgICB9XG4gICAgICB2YXIgZGVwRGJzID0gZG9jLnZpZXdzW2Z1bGxWaWV3TmFtZV0gPSBkb2Mudmlld3NbZnVsbFZpZXdOYW1lXSB8fCB7fTtcbiAgICAgIC8qIGlzdGFuYnVsIGlnbm9yZSBpZiAqL1xuICAgICAgaWYgKGRlcERic1tkZXBEYk5hbWVdKSB7XG4gICAgICAgIHJldHVybjsgLy8gbm8gdXBkYXRlIG5lY2Vzc2FyeVxuICAgICAgfVxuICAgICAgZGVwRGJzW2RlcERiTmFtZV0gPSB0cnVlO1xuICAgICAgcmV0dXJuIGRvYztcbiAgICB9XG4gICAgcmV0dXJuIHVwc2VydChzb3VyY2VEQiwgJ19sb2NhbC9tcnZpZXdzJywgZGlmZkZ1bmN0aW9uKS50aGVuKGZ1bmN0aW9uICgpIHtcbiAgICAgIHJldHVybiBzb3VyY2VEQi5yZWdpc3RlckRlcGVuZGVudERhdGFiYXNlKGRlcERiTmFtZSkudGhlbihmdW5jdGlvbiAocmVzKSB7XG4gICAgICAgIHZhciBkYiA9IHJlcy5kYjtcbiAgICAgICAgZGIuYXV0b19jb21wYWN0aW9uID0gdHJ1ZTtcbiAgICAgICAgdmFyIHZpZXcgPSB7XG4gICAgICAgICAgbmFtZTogZGVwRGJOYW1lLFxuICAgICAgICAgIGRiOiBkYiwgXG4gICAgICAgICAgc291cmNlREI6IHNvdXJjZURCLFxuICAgICAgICAgIGFkYXB0ZXI6IHNvdXJjZURCLmFkYXB0ZXIsXG4gICAgICAgICAgbWFwRnVuOiBtYXBGdW4sXG4gICAgICAgICAgcmVkdWNlRnVuOiByZWR1Y2VGdW5cbiAgICAgICAgfTtcbiAgICAgICAgcmV0dXJuIHZpZXcuZGIuZ2V0KCdfbG9jYWwvbGFzdFNlcScpW1wiY2F0Y2hcIl0oZnVuY3Rpb24gKGVycikge1xuICAgICAgICAgIC8qIGlzdGFuYnVsIGlnbm9yZSBpZiAqL1xuICAgICAgICAgIGlmIChlcnIuc3RhdHVzICE9PSA0MDQpIHtcbiAgICAgICAgICAgIHRocm93IGVycjtcbiAgICAgICAgICB9XG4gICAgICAgIH0pLnRoZW4oZnVuY3Rpb24gKGxhc3RTZXFEb2MpIHtcbiAgICAgICAgICB2aWV3LnNlcSA9IGxhc3RTZXFEb2MgPyBsYXN0U2VxRG9jLnNlcSA6IDA7XG4gICAgICAgICAgaWYgKCF0ZW1wb3JhcnkpIHtcbiAgICAgICAgICAgIHNvdXJjZURCLl9jYWNoZWRWaWV3cyA9IHNvdXJjZURCLl9jYWNoZWRWaWV3cyB8fCB7fTtcbiAgICAgICAgICAgIHNvdXJjZURCLl9jYWNoZWRWaWV3c1t2aWV3U2lnbmF0dXJlXSA9IHZpZXc7XG4gICAgICAgICAgICB2aWV3LmRiLm9uKCdkZXN0cm95ZWQnLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgIGRlbGV0ZSBzb3VyY2VEQi5fY2FjaGVkVmlld3Nbdmlld1NpZ25hdHVyZV07XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuIHZpZXc7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH0pO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoZnVuYywgZW1pdCwgc3VtLCBsb2csIGlzQXJyYXksIHRvSlNPTikge1xuICAvKmpzaGludCBldmlsOnRydWUsdW51c2VkOmZhbHNlICovXG4gIHJldHVybiBldmFsKFwiJ3VzZSBzdHJpY3QnOyAoXCIgKyBmdW5jLnJlcGxhY2UoLztcXHMqJC8sIFwiXCIpICsgXCIpO1wiKTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBwb3VjaENvbGxhdGUgPSByZXF1aXJlKCdwb3VjaGRiLWNvbGxhdGUnKTtcbnZhciBUYXNrUXVldWUgPSByZXF1aXJlKCcuL3Rhc2txdWV1ZScpO1xudmFyIGNvbGxhdGUgPSBwb3VjaENvbGxhdGUuY29sbGF0ZTtcbnZhciB0b0luZGV4YWJsZVN0cmluZyA9IHBvdWNoQ29sbGF0ZS50b0luZGV4YWJsZVN0cmluZztcbnZhciBub3JtYWxpemVLZXkgPSBwb3VjaENvbGxhdGUubm9ybWFsaXplS2V5O1xudmFyIGNyZWF0ZVZpZXcgPSByZXF1aXJlKCcuL2NyZWF0ZS12aWV3Jyk7XG52YXIgZXZhbEZ1bmMgPSByZXF1aXJlKCcuL2V2YWxmdW5jJyk7XG52YXIgbG9nOyBcbi8qIGlzdGFuYnVsIGlnbm9yZSBlbHNlICovXG5pZiAoKHR5cGVvZiBjb25zb2xlICE9PSAndW5kZWZpbmVkJykgJiYgKHR5cGVvZiBjb25zb2xlLmxvZyA9PT0gJ2Z1bmN0aW9uJykpIHtcbiAgbG9nID0gRnVuY3Rpb24ucHJvdG90eXBlLmJpbmQuY2FsbChjb25zb2xlLmxvZywgY29uc29sZSk7XG59IGVsc2Uge1xuICBsb2cgPSBmdW5jdGlvbiAoKSB7fTtcbn1cbnZhciB1dGlscyA9IHJlcXVpcmUoJy4vdXRpbHMnKTtcbnZhciBQcm9taXNlID0gdXRpbHMuUHJvbWlzZTtcbnZhciBwZXJzaXN0ZW50UXVldWVzID0ge307XG52YXIgdGVtcFZpZXdRdWV1ZSA9IG5ldyBUYXNrUXVldWUoKTtcbnZhciBDSEFOR0VTX0JBVENIX1NJWkUgPSA1MDtcblxuZnVuY3Rpb24gcGFyc2VWaWV3TmFtZShuYW1lKSB7XG4gIC8vIGNhbiBiZSBlaXRoZXIgJ2Rkb2NuYW1lL3ZpZXduYW1lJyBvciBqdXN0ICd2aWV3bmFtZSdcbiAgLy8gKHdoZXJlIHRoZSBkZG9jIG5hbWUgaXMgdGhlIHNhbWUpXG4gIHJldHVybiBuYW1lLmluZGV4T2YoJy8nKSA9PT0gLTEgPyBbbmFtZSwgbmFtZV0gOiBuYW1lLnNwbGl0KCcvJyk7XG59XG5cbmZ1bmN0aW9uIGlzR2VuT25lKGNoYW5nZXMpIHtcbiAgLy8gb25seSByZXR1cm4gdHJ1ZSBpZiB0aGUgY3VycmVudCBjaGFuZ2UgaXMgMS1cbiAgLy8gYW5kIHRoZXJlIGFyZSBubyBvdGhlciBsZWFmc1xuICByZXR1cm4gY2hhbmdlcy5sZW5ndGggPT09IDEgJiYgL14xLS8udGVzdChjaGFuZ2VzWzBdLnJldik7XG59XG5cbmZ1bmN0aW9uIGVtaXRFcnJvcihkYiwgZSkge1xuICB0cnkge1xuICAgIGRiLmVtaXQoJ2Vycm9yJywgZSk7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGNvbnNvbGUuZXJyb3IoXG4gICAgICAnVGhlIHVzZXJcXCdzIG1hcC9yZWR1Y2UgZnVuY3Rpb24gdGhyZXcgYW4gdW5jYXVnaHQgZXJyb3IuXFxuJyArXG4gICAgICAnWW91IGNhbiBkZWJ1ZyB0aGlzIGVycm9yIGJ5IGRvaW5nOlxcbicgK1xuICAgICAgJ215RGF0YWJhc2Uub24oXFwnZXJyb3JcXCcsIGZ1bmN0aW9uIChlcnIpIHsgZGVidWdnZXI7IH0pO1xcbicgK1xuICAgICAgJ1BsZWFzZSBkb3VibGUtY2hlY2sgeW91ciBtYXAvcmVkdWNlIGZ1bmN0aW9uLicpO1xuICAgIGNvbnNvbGUuZXJyb3IoZSk7XG4gIH1cbn1cblxuZnVuY3Rpb24gdHJ5Q29kZShkYiwgZnVuLCBhcmdzKSB7XG4gIC8vIGVtaXQgYW4gZXZlbnQgaWYgdGhlcmUgd2FzIGFuIGVycm9yIHRocm93biBieSBhIG1hcC9yZWR1Y2UgZnVuY3Rpb24uXG4gIC8vIHB1dHRpbmcgdHJ5L2NhdGNoZXMgaW4gYSBzaW5nbGUgZnVuY3Rpb24gYWxzbyBhdm9pZHMgZGVvcHRpbWl6YXRpb25zLlxuICB0cnkge1xuICAgIHJldHVybiB7XG4gICAgICBvdXRwdXQgOiBmdW4uYXBwbHkobnVsbCwgYXJncylcbiAgICB9O1xuICB9IGNhdGNoIChlKSB7XG4gICAgZW1pdEVycm9yKGRiLCBlKTtcbiAgICByZXR1cm4ge2Vycm9yOiBlfTtcbiAgfVxufVxuXG5mdW5jdGlvbiBzb3J0QnlLZXlUaGVuVmFsdWUoeCwgeSkge1xuICB2YXIga2V5Q29tcGFyZSA9IGNvbGxhdGUoeC5rZXksIHkua2V5KTtcbiAgcmV0dXJuIGtleUNvbXBhcmUgIT09IDAgPyBrZXlDb21wYXJlIDogY29sbGF0ZSh4LnZhbHVlLCB5LnZhbHVlKTtcbn1cblxuZnVuY3Rpb24gc2xpY2VSZXN1bHRzKHJlc3VsdHMsIGxpbWl0LCBza2lwKSB7XG4gIHNraXAgPSBza2lwIHx8IDA7XG4gIGlmICh0eXBlb2YgbGltaXQgPT09ICdudW1iZXInKSB7XG4gICAgcmV0dXJuIHJlc3VsdHMuc2xpY2Uoc2tpcCwgbGltaXQgKyBza2lwKTtcbiAgfSBlbHNlIGlmIChza2lwID4gMCkge1xuICAgIHJldHVybiByZXN1bHRzLnNsaWNlKHNraXApO1xuICB9XG4gIHJldHVybiByZXN1bHRzO1xufVxuXG5mdW5jdGlvbiByb3dUb0RvY0lkKHJvdykge1xuICB2YXIgdmFsID0gcm93LnZhbHVlO1xuICAvLyBVc2VycyBjYW4gZXhwbGljaXRseSBzcGVjaWZ5IGEgam9pbmVkIGRvYyBfaWQsIG9yIGl0XG4gIC8vIGRlZmF1bHRzIHRvIHRoZSBkb2MgX2lkIHRoYXQgZW1pdHRlZCB0aGUga2V5L3ZhbHVlLlxuICB2YXIgZG9jSWQgPSAodmFsICYmIHR5cGVvZiB2YWwgPT09ICdvYmplY3QnICYmIHZhbC5faWQpIHx8IHJvdy5pZDtcbiAgcmV0dXJuIGRvY0lkO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVCdWlsdEluRXJyb3IobmFtZSkge1xuICB2YXIgbWVzc2FnZSA9ICdidWlsdGluICcgKyBuYW1lICtcbiAgICAnIGZ1bmN0aW9uIHJlcXVpcmVzIG1hcCB2YWx1ZXMgdG8gYmUgbnVtYmVycycgK1xuICAgICcgb3IgbnVtYmVyIGFycmF5cyc7XG4gIHJldHVybiBuZXcgQnVpbHRJbkVycm9yKG1lc3NhZ2UpO1xufVxuXG5mdW5jdGlvbiBzdW0odmFsdWVzKSB7XG4gIHZhciByZXN1bHQgPSAwO1xuICBmb3IgKHZhciBpID0gMCwgbGVuID0gdmFsdWVzLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgdmFyIG51bSA9IHZhbHVlc1tpXTtcbiAgICBpZiAodHlwZW9mIG51bSAhPT0gJ251bWJlcicpIHtcbiAgICAgIGlmIChBcnJheS5pc0FycmF5KG51bSkpIHtcbiAgICAgICAgLy8gbGlzdHMgb2YgbnVtYmVycyBhcmUgYWxzbyBhbGxvd2VkLCBzdW0gdGhlbSBzZXBhcmF0ZWx5XG4gICAgICAgIHJlc3VsdCA9IHR5cGVvZiByZXN1bHQgPT09ICdudW1iZXInID8gW3Jlc3VsdF0gOiByZXN1bHQ7XG4gICAgICAgIGZvciAodmFyIGogPSAwLCBqTGVuID0gbnVtLmxlbmd0aDsgaiA8IGpMZW47IGorKykge1xuICAgICAgICAgIHZhciBqTnVtID0gbnVtW2pdO1xuICAgICAgICAgIGlmICh0eXBlb2Ygak51bSAhPT0gJ251bWJlcicpIHtcbiAgICAgICAgICAgIHRocm93IGNyZWF0ZUJ1aWx0SW5FcnJvcignX3N1bScpO1xuICAgICAgICAgIH0gZWxzZSBpZiAodHlwZW9mIHJlc3VsdFtqXSA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgICAgICAgIHJlc3VsdC5wdXNoKGpOdW0pO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByZXN1bHRbal0gKz0gak51bTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7IC8vIG5vdCBhcnJheS9udW1iZXJcbiAgICAgICAgdGhyb3cgY3JlYXRlQnVpbHRJbkVycm9yKCdfc3VtJyk7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgcmVzdWx0ID09PSAnbnVtYmVyJykge1xuICAgICAgcmVzdWx0ICs9IG51bTtcbiAgICB9IGVsc2UgeyAvLyBhZGQgbnVtYmVyIHRvIGFycmF5XG4gICAgICByZXN1bHRbMF0gKz0gbnVtO1xuICAgIH1cbiAgfVxuICByZXR1cm4gcmVzdWx0O1xufVxuXG52YXIgYnVpbHRJblJlZHVjZSA9IHtcbiAgX3N1bTogZnVuY3Rpb24gKGtleXMsIHZhbHVlcykge1xuICAgIHJldHVybiBzdW0odmFsdWVzKTtcbiAgfSxcblxuICBfY291bnQ6IGZ1bmN0aW9uIChrZXlzLCB2YWx1ZXMpIHtcbiAgICByZXR1cm4gdmFsdWVzLmxlbmd0aDtcbiAgfSxcblxuICBfc3RhdHM6IGZ1bmN0aW9uIChrZXlzLCB2YWx1ZXMpIHtcbiAgICAvLyBubyBuZWVkIHRvIGltcGxlbWVudCByZXJlZHVjZT10cnVlLCBiZWNhdXNlIFBvdWNoXG4gICAgLy8gd2lsbCBuZXZlciBjYWxsIGl0XG4gICAgZnVuY3Rpb24gc3Vtc3FyKHZhbHVlcykge1xuICAgICAgdmFyIF9zdW1zcXIgPSAwO1xuICAgICAgZm9yICh2YXIgaSA9IDAsIGxlbiA9IHZhbHVlcy5sZW5ndGg7IGkgPCBsZW47IGkrKykge1xuICAgICAgICB2YXIgbnVtID0gdmFsdWVzW2ldO1xuICAgICAgICBfc3Vtc3FyICs9IChudW0gKiBudW0pO1xuICAgICAgfVxuICAgICAgcmV0dXJuIF9zdW1zcXI7XG4gICAgfVxuICAgIHJldHVybiB7XG4gICAgICBzdW0gICAgIDogc3VtKHZhbHVlcyksXG4gICAgICBtaW4gICAgIDogTWF0aC5taW4uYXBwbHkobnVsbCwgdmFsdWVzKSxcbiAgICAgIG1heCAgICAgOiBNYXRoLm1heC5hcHBseShudWxsLCB2YWx1ZXMpLFxuICAgICAgY291bnQgICA6IHZhbHVlcy5sZW5ndGgsXG4gICAgICBzdW1zcXIgOiBzdW1zcXIodmFsdWVzKVxuICAgIH07XG4gIH1cbn07XG5cbmZ1bmN0aW9uIGFkZEh0dHBQYXJhbShwYXJhbU5hbWUsIG9wdHMsIHBhcmFtcywgYXNKc29uKSB7XG4gIC8vIGFkZCBhbiBodHRwIHBhcmFtIGZyb20gb3B0cyB0byBwYXJhbXMsIG9wdGlvbmFsbHkganNvbi1lbmNvZGVkXG4gIHZhciB2YWwgPSBvcHRzW3BhcmFtTmFtZV07XG4gIGlmICh0eXBlb2YgdmFsICE9PSAndW5kZWZpbmVkJykge1xuICAgIGlmIChhc0pzb24pIHtcbiAgICAgIHZhbCA9IGVuY29kZVVSSUNvbXBvbmVudChKU09OLnN0cmluZ2lmeSh2YWwpKTtcbiAgICB9XG4gICAgcGFyYW1zLnB1c2gocGFyYW1OYW1lICsgJz0nICsgdmFsKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBjaGVja1F1ZXJ5UGFyc2VFcnJvcihvcHRpb25zLCBmdW4pIHtcbiAgdmFyIHN0YXJ0a2V5TmFtZSA9IG9wdGlvbnMuZGVzY2VuZGluZyA/ICdlbmRrZXknIDogJ3N0YXJ0a2V5JztcbiAgdmFyIGVuZGtleU5hbWUgPSBvcHRpb25zLmRlc2NlbmRpbmcgPyAnc3RhcnRrZXknIDogJ2VuZGtleSc7XG5cbiAgaWYgKHR5cGVvZiBvcHRpb25zW3N0YXJ0a2V5TmFtZV0gIT09ICd1bmRlZmluZWQnICYmXG4gICAgdHlwZW9mIG9wdGlvbnNbZW5ka2V5TmFtZV0gIT09ICd1bmRlZmluZWQnICYmXG4gICAgY29sbGF0ZShvcHRpb25zW3N0YXJ0a2V5TmFtZV0sIG9wdGlvbnNbZW5ka2V5TmFtZV0pID4gMCkge1xuICAgIHRocm93IG5ldyBRdWVyeVBhcnNlRXJyb3IoJ05vIHJvd3MgY2FuIG1hdGNoIHlvdXIga2V5IHJhbmdlLCByZXZlcnNlIHlvdXIgJyArXG4gICAgICAgICdzdGFydF9rZXkgYW5kIGVuZF9rZXkgb3Igc2V0IHtkZXNjZW5kaW5nIDogdHJ1ZX0nKTtcbiAgfSBlbHNlIGlmIChmdW4ucmVkdWNlICYmIG9wdGlvbnMucmVkdWNlICE9PSBmYWxzZSkge1xuICAgIGlmIChvcHRpb25zLmluY2x1ZGVfZG9jcykge1xuICAgICAgdGhyb3cgbmV3IFF1ZXJ5UGFyc2VFcnJvcigne2luY2x1ZGVfZG9jczp0cnVlfSBpcyBpbnZhbGlkIGZvciByZWR1Y2UnKTtcbiAgICB9IGVsc2UgaWYgKG9wdGlvbnMua2V5cyAmJiBvcHRpb25zLmtleXMubGVuZ3RoID4gMSAmJlxuICAgICAgICAhb3B0aW9ucy5ncm91cCAmJiAhb3B0aW9ucy5ncm91cF9sZXZlbCkge1xuICAgICAgdGhyb3cgbmV3IFF1ZXJ5UGFyc2VFcnJvcignTXVsdGkta2V5IGZldGNoZXMgZm9yIHJlZHVjZSB2aWV3cyBtdXN0IHVzZSB7Z3JvdXA6IHRydWV9Jyk7XG4gICAgfVxuICB9XG4gIGlmIChvcHRpb25zLmdyb3VwX2xldmVsKSB7XG4gICAgaWYgKHR5cGVvZiBvcHRpb25zLmdyb3VwX2xldmVsICE9PSAnbnVtYmVyJykge1xuICAgICAgdGhyb3cgbmV3IFF1ZXJ5UGFyc2VFcnJvcignSW52YWxpZCB2YWx1ZSBmb3IgaW50ZWdlcjogXCInICsgb3B0aW9ucy5ncm91cF9sZXZlbCArICdcIicpO1xuICAgIH1cbiAgICBpZiAob3B0aW9ucy5ncm91cF9sZXZlbCA8IDApIHtcbiAgICAgIHRocm93IG5ldyBRdWVyeVBhcnNlRXJyb3IoJ0ludmFsaWQgdmFsdWUgZm9yIHBvc2l0aXZlIGludGVnZXI6ICcgK1xuICAgICAgICAnXCInICsgb3B0aW9ucy5ncm91cF9sZXZlbCArICdcIicpO1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBodHRwUXVlcnkoZGIsIGZ1biwgb3B0cykge1xuICAvLyBMaXN0IG9mIHBhcmFtZXRlcnMgdG8gYWRkIHRvIHRoZSBQVVQgcmVxdWVzdFxuICB2YXIgcGFyYW1zID0gW107XG4gIHZhciBib2R5O1xuICB2YXIgbWV0aG9kID0gJ0dFVCc7XG5cbiAgLy8gSWYgb3B0cy5yZWR1Y2UgZXhpc3RzIGFuZCBpcyBkZWZpbmVkLCB0aGVuIGFkZCBpdCB0byB0aGUgbGlzdFxuICAvLyBvZiBwYXJhbWV0ZXJzLlxuICAvLyBJZiByZWR1Y2U9ZmFsc2UgdGhlbiB0aGUgcmVzdWx0cyBhcmUgdGhhdCBvZiBvbmx5IHRoZSBtYXAgZnVuY3Rpb25cbiAgLy8gbm90IHRoZSBmaW5hbCByZXN1bHQgb2YgbWFwIGFuZCByZWR1Y2UuXG4gIGFkZEh0dHBQYXJhbSgncmVkdWNlJywgb3B0cywgcGFyYW1zKTtcbiAgYWRkSHR0cFBhcmFtKCdpbmNsdWRlX2RvY3MnLCBvcHRzLCBwYXJhbXMpO1xuICBhZGRIdHRwUGFyYW0oJ2F0dGFjaG1lbnRzJywgb3B0cywgcGFyYW1zKTtcbiAgYWRkSHR0cFBhcmFtKCdsaW1pdCcsIG9wdHMsIHBhcmFtcyk7XG4gIGFkZEh0dHBQYXJhbSgnZGVzY2VuZGluZycsIG9wdHMsIHBhcmFtcyk7XG4gIGFkZEh0dHBQYXJhbSgnZ3JvdXAnLCBvcHRzLCBwYXJhbXMpO1xuICBhZGRIdHRwUGFyYW0oJ2dyb3VwX2xldmVsJywgb3B0cywgcGFyYW1zKTtcbiAgYWRkSHR0cFBhcmFtKCdza2lwJywgb3B0cywgcGFyYW1zKTtcbiAgYWRkSHR0cFBhcmFtKCdzdGFsZScsIG9wdHMsIHBhcmFtcyk7XG4gIGFkZEh0dHBQYXJhbSgnY29uZmxpY3RzJywgb3B0cywgcGFyYW1zKTtcbiAgYWRkSHR0cFBhcmFtKCdzdGFydGtleScsIG9wdHMsIHBhcmFtcywgdHJ1ZSk7XG4gIGFkZEh0dHBQYXJhbSgnZW5ka2V5Jywgb3B0cywgcGFyYW1zLCB0cnVlKTtcbiAgYWRkSHR0cFBhcmFtKCdpbmNsdXNpdmVfZW5kJywgb3B0cywgcGFyYW1zKTtcbiAgYWRkSHR0cFBhcmFtKCdrZXknLCBvcHRzLCBwYXJhbXMsIHRydWUpO1xuXG4gIC8vIEZvcm1hdCB0aGUgbGlzdCBvZiBwYXJhbWV0ZXJzIGludG8gYSB2YWxpZCBVUkkgcXVlcnkgc3RyaW5nXG4gIHBhcmFtcyA9IHBhcmFtcy5qb2luKCcmJyk7XG4gIHBhcmFtcyA9IHBhcmFtcyA9PT0gJycgPyAnJyA6ICc/JyArIHBhcmFtcztcblxuICAvLyBJZiBrZXlzIGFyZSBzdXBwbGllZCwgaXNzdWUgYSBQT1NUIHJlcXVlc3QgdG8gY2lyY3VtdmVudCBHRVQgcXVlcnkgc3RyaW5nIGxpbWl0c1xuICAvLyBzZWUgaHR0cDovL3dpa2kuYXBhY2hlLm9yZy9jb3VjaGRiL0hUVFBfdmlld19BUEkjUXVlcnlpbmdfT3B0aW9uc1xuICBpZiAodHlwZW9mIG9wdHMua2V5cyAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICB2YXIgTUFYX1VSTF9MRU5HVEggPSAyMDAwO1xuICAgIC8vIGFjY29yZGluZyB0byBodHRwOi8vc3RhY2tvdmVyZmxvdy5jb20vYS80MTcxODQvNjgwNzQyLFxuICAgIC8vIHRoZSBkZSBmYWN0byBVUkwgbGVuZ3RoIGxpbWl0IGlzIDIwMDAgY2hhcmFjdGVyc1xuXG4gICAgdmFyIGtleXNBc1N0cmluZyA9XG4gICAgICAna2V5cz0nICsgZW5jb2RlVVJJQ29tcG9uZW50KEpTT04uc3RyaW5naWZ5KG9wdHMua2V5cykpO1xuICAgIGlmIChrZXlzQXNTdHJpbmcubGVuZ3RoICsgcGFyYW1zLmxlbmd0aCArIDEgPD0gTUFYX1VSTF9MRU5HVEgpIHtcbiAgICAgIC8vIElmIHRoZSBrZXlzIGFyZSBzaG9ydCBlbm91Z2gsIGRvIGEgR0VULiB3ZSBkbyB0aGlzIHRvIHdvcmsgYXJvdW5kXG4gICAgICAvLyBTYWZhcmkgbm90IHVuZGVyc3RhbmRpbmcgMzA0cyBvbiBQT1NUcyAoc2VlIHBvdWNoZGIvcG91Y2hkYiMxMjM5KVxuICAgICAgcGFyYW1zICs9IChwYXJhbXNbMF0gPT09ICc/JyA/ICcmJyA6ICc/JykgKyBrZXlzQXNTdHJpbmc7XG4gICAgfSBlbHNlIHtcbiAgICAgIG1ldGhvZCA9ICdQT1NUJztcbiAgICAgIGlmICh0eXBlb2YgZnVuID09PSAnc3RyaW5nJykge1xuICAgICAgICBib2R5ID0gSlNPTi5zdHJpbmdpZnkoe2tleXM6IG9wdHMua2V5c30pO1xuICAgICAgfSBlbHNlIHsgLy8gZnVuIGlzIHttYXAgOiBtYXBmdW59LCBzbyBhcHBlbmQgdG8gdGhpc1xuICAgICAgICBmdW4ua2V5cyA9IG9wdHMua2V5cztcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvLyBXZSBhcmUgcmVmZXJlbmNpbmcgYSBxdWVyeSBkZWZpbmVkIGluIHRoZSBkZXNpZ24gZG9jXG4gIGlmICh0eXBlb2YgZnVuID09PSAnc3RyaW5nJykge1xuICAgIHZhciBwYXJ0cyA9IHBhcnNlVmlld05hbWUoZnVuKTtcbiAgICByZXR1cm4gZGIucmVxdWVzdCh7XG4gICAgICBtZXRob2Q6IG1ldGhvZCxcbiAgICAgIHVybDogJ19kZXNpZ24vJyArIHBhcnRzWzBdICsgJy9fdmlldy8nICsgcGFydHNbMV0gKyBwYXJhbXMsXG4gICAgICBib2R5OiBib2R5XG4gICAgfSk7XG4gIH1cblxuICAvLyBXZSBhcmUgdXNpbmcgYSB0ZW1wb3JhcnkgdmlldywgdGVycmlibGUgZm9yIHBlcmZvcm1hbmNlIGJ1dCBnb29kIGZvciB0ZXN0aW5nXG4gIGJvZHkgPSBib2R5IHx8IHt9O1xuICBPYmplY3Qua2V5cyhmdW4pLmZvckVhY2goZnVuY3Rpb24gKGtleSkge1xuICAgIGlmIChBcnJheS5pc0FycmF5KGZ1bltrZXldKSkge1xuICAgICAgYm9keVtrZXldID0gZnVuW2tleV07XG4gICAgfSBlbHNlIHtcbiAgICAgIGJvZHlba2V5XSA9IGZ1bltrZXldLnRvU3RyaW5nKCk7XG4gICAgfVxuICB9KTtcbiAgcmV0dXJuIGRiLnJlcXVlc3Qoe1xuICAgIG1ldGhvZDogJ1BPU1QnLFxuICAgIHVybDogJ190ZW1wX3ZpZXcnICsgcGFyYW1zLFxuICAgIGJvZHk6IGJvZHlcbiAgfSk7XG59XG5cbmZ1bmN0aW9uIGRlZmF1bHRzVG8odmFsdWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uIChyZWFzb24pIHtcbiAgICAvKiBpc3RhbmJ1bCBpZ25vcmUgZWxzZSAqL1xuICAgIGlmIChyZWFzb24uc3RhdHVzID09PSA0MDQpIHtcbiAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgcmVhc29uO1xuICAgIH1cbiAgfTtcbn1cblxuLy8gcmV0dXJucyBhIHByb21pc2UgZm9yIGEgbGlzdCBvZiBkb2NzIHRvIHVwZGF0ZSwgYmFzZWQgb24gdGhlIGlucHV0IGRvY0lkLlxuLy8gdGhlIG9yZGVyIGRvZXNuJ3QgbWF0dGVyLCBiZWNhdXNlIHBvc3QtMy4yLjAsIGJ1bGtEb2NzXG4vLyBpcyBhbiBhdG9taWMgb3BlcmF0aW9uIGluIGFsbCB0aHJlZSBhZGFwdGVycy5cbmZ1bmN0aW9uIGdldERvY3NUb1BlcnNpc3QoZG9jSWQsIHZpZXcsIGRvY0lkc1RvQ2hhbmdlc0FuZEVtaXRzKSB7XG4gIHZhciBtZXRhRG9jSWQgPSAnX2xvY2FsL2RvY18nICsgZG9jSWQ7XG4gIHZhciBkZWZhdWx0TWV0YURvYyA9IHtfaWQ6IG1ldGFEb2NJZCwga2V5czogW119O1xuICB2YXIgZG9jRGF0YSA9IGRvY0lkc1RvQ2hhbmdlc0FuZEVtaXRzW2RvY0lkXTtcbiAgdmFyIGluZGV4YWJsZUtleXNUb0tleVZhbHVlcyA9IGRvY0RhdGEuaW5kZXhhYmxlS2V5c1RvS2V5VmFsdWVzO1xuICB2YXIgY2hhbmdlcyA9IGRvY0RhdGEuY2hhbmdlcztcblxuICBmdW5jdGlvbiBnZXRNZXRhRG9jKCkge1xuICAgIGlmIChpc0dlbk9uZShjaGFuZ2VzKSkge1xuICAgICAgLy8gZ2VuZXJhdGlvbiAxLCBzbyB3ZSBjYW4gc2FmZWx5IGFzc3VtZSBpbml0aWFsIHN0YXRlXG4gICAgICAvLyBmb3IgcGVyZm9ybWFuY2UgcmVhc29ucyAoYXZvaWRzIHVubmVjZXNzYXJ5IEdFVHMpXG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKGRlZmF1bHRNZXRhRG9jKTtcbiAgICB9XG4gICAgcmV0dXJuIHZpZXcuZGIuZ2V0KG1ldGFEb2NJZClbXCJjYXRjaFwiXShkZWZhdWx0c1RvKGRlZmF1bHRNZXRhRG9jKSk7XG4gIH1cblxuICBmdW5jdGlvbiBnZXRLZXlWYWx1ZURvY3MobWV0YURvYykge1xuICAgIGlmICghbWV0YURvYy5rZXlzLmxlbmd0aCkge1xuICAgICAgLy8gbm8ga2V5cywgbm8gbmVlZCBmb3IgYSBsb29rdXBcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoe3Jvd3M6IFtdfSk7XG4gICAgfVxuICAgIHJldHVybiB2aWV3LmRiLmFsbERvY3Moe1xuICAgICAga2V5czogbWV0YURvYy5rZXlzLFxuICAgICAgaW5jbHVkZV9kb2NzOiB0cnVlXG4gICAgfSk7XG4gIH1cblxuICBmdW5jdGlvbiBwcm9jZXNzS3ZEb2NzKG1ldGFEb2MsIGt2RG9jc1Jlcykge1xuICAgIHZhciBrdkRvY3MgPSBbXTtcbiAgICB2YXIgb2xkS2V5c01hcCA9IHt9O1xuXG4gICAgZm9yICh2YXIgaSA9IDAsIGxlbiA9IGt2RG9jc1Jlcy5yb3dzLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgICB2YXIgcm93ID0ga3ZEb2NzUmVzLnJvd3NbaV07XG4gICAgICB2YXIgZG9jID0gcm93LmRvYztcbiAgICAgIGlmICghZG9jKSB7IC8vIGRlbGV0ZWRcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBrdkRvY3MucHVzaChkb2MpO1xuICAgICAgb2xkS2V5c01hcFtkb2MuX2lkXSA9IHRydWU7XG4gICAgICBkb2MuX2RlbGV0ZWQgPSAhaW5kZXhhYmxlS2V5c1RvS2V5VmFsdWVzW2RvYy5faWRdO1xuICAgICAgaWYgKCFkb2MuX2RlbGV0ZWQpIHtcbiAgICAgICAgdmFyIGtleVZhbHVlID0gaW5kZXhhYmxlS2V5c1RvS2V5VmFsdWVzW2RvYy5faWRdO1xuICAgICAgICBpZiAoJ3ZhbHVlJyBpbiBrZXlWYWx1ZSkge1xuICAgICAgICAgIGRvYy52YWx1ZSA9IGtleVZhbHVlLnZhbHVlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgdmFyIG5ld0tleXMgPSBPYmplY3Qua2V5cyhpbmRleGFibGVLZXlzVG9LZXlWYWx1ZXMpO1xuICAgIG5ld0tleXMuZm9yRWFjaChmdW5jdGlvbiAoa2V5KSB7XG4gICAgICBpZiAoIW9sZEtleXNNYXBba2V5XSkge1xuICAgICAgICAvLyBuZXcgZG9jXG4gICAgICAgIHZhciBrdkRvYyA9IHtcbiAgICAgICAgICBfaWQ6IGtleVxuICAgICAgICB9O1xuICAgICAgICB2YXIga2V5VmFsdWUgPSBpbmRleGFibGVLZXlzVG9LZXlWYWx1ZXNba2V5XTtcbiAgICAgICAgaWYgKCd2YWx1ZScgaW4ga2V5VmFsdWUpIHtcbiAgICAgICAgICBrdkRvYy52YWx1ZSA9IGtleVZhbHVlLnZhbHVlO1xuICAgICAgICB9XG4gICAgICAgIGt2RG9jcy5wdXNoKGt2RG9jKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICBtZXRhRG9jLmtleXMgPSB1dGlscy51bmlxKG5ld0tleXMuY29uY2F0KG1ldGFEb2Mua2V5cykpO1xuICAgIGt2RG9jcy5wdXNoKG1ldGFEb2MpO1xuXG4gICAgcmV0dXJuIGt2RG9jcztcbiAgfVxuXG4gIHJldHVybiBnZXRNZXRhRG9jKCkudGhlbihmdW5jdGlvbiAobWV0YURvYykge1xuICAgIHJldHVybiBnZXRLZXlWYWx1ZURvY3MobWV0YURvYykudGhlbihmdW5jdGlvbiAoa3ZEb2NzUmVzKSB7XG4gICAgICByZXR1cm4gcHJvY2Vzc0t2RG9jcyhtZXRhRG9jLCBrdkRvY3NSZXMpO1xuICAgIH0pO1xuICB9KTtcbn1cblxuLy8gdXBkYXRlcyBhbGwgZW1pdHRlZCBrZXkvdmFsdWUgZG9jcyBhbmQgbWV0YURvY3MgaW4gdGhlIG1ydmlldyBkYXRhYmFzZVxuLy8gZm9yIHRoZSBnaXZlbiBiYXRjaCBvZiBkb2N1bWVudHMgZnJvbSB0aGUgc291cmNlIGRhdGFiYXNlXG5mdW5jdGlvbiBzYXZlS2V5VmFsdWVzKHZpZXcsIGRvY0lkc1RvQ2hhbmdlc0FuZEVtaXRzLCBzZXEpIHtcbiAgdmFyIHNlcURvY0lkID0gJ19sb2NhbC9sYXN0U2VxJztcbiAgcmV0dXJuIHZpZXcuZGIuZ2V0KHNlcURvY0lkKVtcbiAgXCJjYXRjaFwiXShkZWZhdWx0c1RvKHtfaWQ6IHNlcURvY0lkLCBzZXE6IDB9KSlcbiAgLnRoZW4oZnVuY3Rpb24gKGxhc3RTZXFEb2MpIHtcbiAgICB2YXIgZG9jSWRzID0gT2JqZWN0LmtleXMoZG9jSWRzVG9DaGFuZ2VzQW5kRW1pdHMpO1xuICAgIHJldHVybiBQcm9taXNlLmFsbChkb2NJZHMubWFwKGZ1bmN0aW9uIChkb2NJZCkge1xuICAgICAgcmV0dXJuIGdldERvY3NUb1BlcnNpc3QoZG9jSWQsIHZpZXcsIGRvY0lkc1RvQ2hhbmdlc0FuZEVtaXRzKTtcbiAgICB9KSkudGhlbihmdW5jdGlvbiAobGlzdE9mRG9jc1RvUGVyc2lzdCkge1xuICAgICAgdmFyIGRvY3NUb1BlcnNpc3QgPSB1dGlscy5mbGF0dGVuKGxpc3RPZkRvY3NUb1BlcnNpc3QpO1xuICAgICAgbGFzdFNlcURvYy5zZXEgPSBzZXE7XG4gICAgICBkb2NzVG9QZXJzaXN0LnB1c2gobGFzdFNlcURvYyk7XG4gICAgICAvLyB3cml0ZSBhbGwgZG9jcyBpbiBhIHNpbmdsZSBvcGVyYXRpb24sIHVwZGF0ZSB0aGUgc2VxIG9uY2VcbiAgICAgIHJldHVybiB2aWV3LmRiLmJ1bGtEb2NzKHtkb2NzIDogZG9jc1RvUGVyc2lzdH0pO1xuICAgIH0pO1xuICB9KTtcbn1cblxuZnVuY3Rpb24gZ2V0UXVldWUodmlldykge1xuICB2YXIgdmlld05hbWUgPSB0eXBlb2YgdmlldyA9PT0gJ3N0cmluZycgPyB2aWV3IDogdmlldy5uYW1lO1xuICB2YXIgcXVldWUgPSBwZXJzaXN0ZW50UXVldWVzW3ZpZXdOYW1lXTtcbiAgaWYgKCFxdWV1ZSkge1xuICAgIHF1ZXVlID0gcGVyc2lzdGVudFF1ZXVlc1t2aWV3TmFtZV0gPSBuZXcgVGFza1F1ZXVlKCk7XG4gIH1cbiAgcmV0dXJuIHF1ZXVlO1xufVxuXG5mdW5jdGlvbiB1cGRhdGVWaWV3KHZpZXcpIHtcbiAgcmV0dXJuIHV0aWxzLnNlcXVlbnRpYWxpemUoZ2V0UXVldWUodmlldyksIGZ1bmN0aW9uICgpIHtcbiAgICByZXR1cm4gdXBkYXRlVmlld0luUXVldWUodmlldyk7XG4gIH0pKCk7XG59XG5cbmZ1bmN0aW9uIHVwZGF0ZVZpZXdJblF1ZXVlKHZpZXcpIHtcbiAgLy8gYmluZCB0aGUgZW1pdCBmdW5jdGlvbiBvbmNlXG4gIHZhciBtYXBSZXN1bHRzO1xuICB2YXIgZG9jO1xuXG4gIGZ1bmN0aW9uIGVtaXQoa2V5LCB2YWx1ZSkge1xuICAgIHZhciBvdXRwdXQgPSB7aWQ6IGRvYy5faWQsIGtleTogbm9ybWFsaXplS2V5KGtleSl9O1xuICAgIC8vIERvbid0IGV4cGxpY2l0bHkgc3RvcmUgdGhlIHZhbHVlIHVubGVzcyBpdCdzIGRlZmluZWQgYW5kIG5vbi1udWxsLlxuICAgIC8vIFRoaXMgc2F2ZXMgb24gc3RvcmFnZSBzcGFjZSwgYmVjYXVzZSBvZnRlbiBwZW9wbGUgZG9uJ3QgdXNlIGl0LlxuICAgIGlmICh0eXBlb2YgdmFsdWUgIT09ICd1bmRlZmluZWQnICYmIHZhbHVlICE9PSBudWxsKSB7XG4gICAgICBvdXRwdXQudmFsdWUgPSBub3JtYWxpemVLZXkodmFsdWUpO1xuICAgIH1cbiAgICBtYXBSZXN1bHRzLnB1c2gob3V0cHV0KTtcbiAgfVxuXG4gIHZhciBtYXBGdW47XG4gIC8vIGZvciB0ZW1wX3ZpZXdzIG9uZSBjYW4gdXNlIGVtaXQoZG9jLCBlbWl0KSwgc2VlICMzOFxuICBpZiAodHlwZW9mIHZpZXcubWFwRnVuID09PSBcImZ1bmN0aW9uXCIgJiYgdmlldy5tYXBGdW4ubGVuZ3RoID09PSAyKSB7XG4gICAgdmFyIG9yaWdNYXAgPSB2aWV3Lm1hcEZ1bjtcbiAgICBtYXBGdW4gPSBmdW5jdGlvbiAoZG9jKSB7XG4gICAgICByZXR1cm4gb3JpZ01hcChkb2MsIGVtaXQpO1xuICAgIH07XG4gIH0gZWxzZSB7XG4gICAgbWFwRnVuID0gZXZhbEZ1bmModmlldy5tYXBGdW4udG9TdHJpbmcoKSwgZW1pdCwgc3VtLCBsb2csIEFycmF5LmlzQXJyYXksIEpTT04ucGFyc2UpO1xuICB9XG5cbiAgdmFyIGN1cnJlbnRTZXEgPSB2aWV3LnNlcSB8fCAwO1xuXG4gIGZ1bmN0aW9uIHByb2Nlc3NDaGFuZ2UoZG9jSWRzVG9DaGFuZ2VzQW5kRW1pdHMsIHNlcSkge1xuICAgIHJldHVybiBmdW5jdGlvbiAoKSB7XG4gICAgICByZXR1cm4gc2F2ZUtleVZhbHVlcyh2aWV3LCBkb2NJZHNUb0NoYW5nZXNBbmRFbWl0cywgc2VxKTtcbiAgICB9O1xuICB9XG5cbiAgdmFyIHF1ZXVlID0gbmV3IFRhc2tRdWV1ZSgpO1xuICAvLyBUT0RPKG5lb2pza2kpOiBodHRwczovL2dpdGh1Yi5jb20vZGFsZWhhcnZleS9wb3VjaGRiL2lzc3Vlcy8xNTIxXG5cbiAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uIChyZXNvbHZlLCByZWplY3QpIHtcblxuICAgIGZ1bmN0aW9uIGNvbXBsZXRlKCkge1xuICAgICAgcXVldWUuZmluaXNoKCkudGhlbihmdW5jdGlvbiAoKSB7XG4gICAgICAgIHZpZXcuc2VxID0gY3VycmVudFNlcTtcbiAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcHJvY2Vzc05leHRCYXRjaCgpIHtcbiAgICAgIHZpZXcuc291cmNlREIuY2hhbmdlcyh7XG4gICAgICAgIGNvbmZsaWN0czogdHJ1ZSxcbiAgICAgICAgaW5jbHVkZV9kb2NzOiB0cnVlLFxuICAgICAgICBzdHlsZTogJ2FsbF9kb2NzJyxcbiAgICAgICAgc2luY2U6IGN1cnJlbnRTZXEsXG4gICAgICAgIGxpbWl0OiBDSEFOR0VTX0JBVENIX1NJWkVcbiAgICAgIH0pLm9uKCdjb21wbGV0ZScsIGZ1bmN0aW9uIChyZXNwb25zZSkge1xuICAgICAgICB2YXIgcmVzdWx0cyA9IHJlc3BvbnNlLnJlc3VsdHM7XG4gICAgICAgIGlmICghcmVzdWx0cy5sZW5ndGgpIHtcbiAgICAgICAgICByZXR1cm4gY29tcGxldGUoKTtcbiAgICAgICAgfVxuICAgICAgICB2YXIgZG9jSWRzVG9DaGFuZ2VzQW5kRW1pdHMgPSB7fTtcbiAgICAgICAgZm9yICh2YXIgaSA9IDAsIGwgPSByZXN1bHRzLmxlbmd0aDsgaSA8IGw7IGkrKykge1xuICAgICAgICAgIHZhciBjaGFuZ2UgPSByZXN1bHRzW2ldO1xuICAgICAgICAgIGlmIChjaGFuZ2UuZG9jLl9pZFswXSAhPT0gJ18nKSB7XG4gICAgICAgICAgICBtYXBSZXN1bHRzID0gW107XG4gICAgICAgICAgICBkb2MgPSBjaGFuZ2UuZG9jO1xuXG4gICAgICAgICAgICBpZiAoIWRvYy5fZGVsZXRlZCkge1xuICAgICAgICAgICAgICB0cnlDb2RlKHZpZXcuc291cmNlREIsIG1hcEZ1biwgW2RvY10pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgbWFwUmVzdWx0cy5zb3J0KHNvcnRCeUtleVRoZW5WYWx1ZSk7XG5cbiAgICAgICAgICAgIHZhciBpbmRleGFibGVLZXlzVG9LZXlWYWx1ZXMgPSB7fTtcbiAgICAgICAgICAgIHZhciBsYXN0S2V5O1xuICAgICAgICAgICAgZm9yICh2YXIgaiA9IDAsIGpsID0gbWFwUmVzdWx0cy5sZW5ndGg7IGogPCBqbDsgaisrKSB7XG4gICAgICAgICAgICAgIHZhciBvYmogPSBtYXBSZXN1bHRzW2pdO1xuICAgICAgICAgICAgICB2YXIgY29tcGxleEtleSA9IFtvYmoua2V5LCBvYmouaWRdO1xuICAgICAgICAgICAgICBpZiAoY29sbGF0ZShvYmoua2V5LCBsYXN0S2V5KSA9PT0gMCkge1xuICAgICAgICAgICAgICAgIGNvbXBsZXhLZXkucHVzaChqKTsgLy8gZHVwIGtleStpZCwgc28gbWFrZSBpdCB1bmlxdWVcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB2YXIgaW5kZXhhYmxlS2V5ID0gdG9JbmRleGFibGVTdHJpbmcoY29tcGxleEtleSk7XG4gICAgICAgICAgICAgIGluZGV4YWJsZUtleXNUb0tleVZhbHVlc1tpbmRleGFibGVLZXldID0gb2JqO1xuICAgICAgICAgICAgICBsYXN0S2V5ID0gb2JqLmtleTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGRvY0lkc1RvQ2hhbmdlc0FuZEVtaXRzW2NoYW5nZS5kb2MuX2lkXSA9IHtcbiAgICAgICAgICAgICAgaW5kZXhhYmxlS2V5c1RvS2V5VmFsdWVzOiBpbmRleGFibGVLZXlzVG9LZXlWYWx1ZXMsXG4gICAgICAgICAgICAgIGNoYW5nZXM6IGNoYW5nZS5jaGFuZ2VzXG4gICAgICAgICAgICB9O1xuICAgICAgICAgIH1cbiAgICAgICAgICBjdXJyZW50U2VxID0gY2hhbmdlLnNlcTtcbiAgICAgICAgfVxuICAgICAgICBxdWV1ZS5hZGQocHJvY2Vzc0NoYW5nZShkb2NJZHNUb0NoYW5nZXNBbmRFbWl0cywgY3VycmVudFNlcSkpO1xuICAgICAgICBpZiAocmVzdWx0cy5sZW5ndGggPCBDSEFOR0VTX0JBVENIX1NJWkUpIHtcbiAgICAgICAgICByZXR1cm4gY29tcGxldGUoKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcHJvY2Vzc05leHRCYXRjaCgpO1xuICAgICAgfSkub24oJ2Vycm9yJywgb25FcnJvcik7XG4gICAgICAvKiBpc3RhbmJ1bCBpZ25vcmUgbmV4dCAqL1xuICAgICAgZnVuY3Rpb24gb25FcnJvcihlcnIpIHtcbiAgICAgICAgcmVqZWN0KGVycik7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcHJvY2Vzc05leHRCYXRjaCgpO1xuICB9KTtcbn1cblxuZnVuY3Rpb24gcmVkdWNlVmlldyh2aWV3LCByZXN1bHRzLCBvcHRpb25zKSB7XG4gIGlmIChvcHRpb25zLmdyb3VwX2xldmVsID09PSAwKSB7XG4gICAgZGVsZXRlIG9wdGlvbnMuZ3JvdXBfbGV2ZWw7XG4gIH1cblxuICB2YXIgc2hvdWxkR3JvdXAgPSBvcHRpb25zLmdyb3VwIHx8IG9wdGlvbnMuZ3JvdXBfbGV2ZWw7XG5cbiAgdmFyIHJlZHVjZUZ1bjtcbiAgaWYgKGJ1aWx0SW5SZWR1Y2Vbdmlldy5yZWR1Y2VGdW5dKSB7XG4gICAgcmVkdWNlRnVuID0gYnVpbHRJblJlZHVjZVt2aWV3LnJlZHVjZUZ1bl07XG4gIH0gZWxzZSB7XG4gICAgcmVkdWNlRnVuID0gZXZhbEZ1bmMoXG4gICAgICB2aWV3LnJlZHVjZUZ1bi50b1N0cmluZygpLCBudWxsLCBzdW0sIGxvZywgQXJyYXkuaXNBcnJheSwgSlNPTi5wYXJzZSk7XG4gIH1cblxuICB2YXIgZ3JvdXBzID0gW107XG4gIHZhciBsdmwgPSBvcHRpb25zLmdyb3VwX2xldmVsO1xuICByZXN1bHRzLmZvckVhY2goZnVuY3Rpb24gKGUpIHtcbiAgICB2YXIgbGFzdCA9IGdyb3Vwc1tncm91cHMubGVuZ3RoIC0gMV07XG4gICAgdmFyIGtleSA9IHNob3VsZEdyb3VwID8gZS5rZXkgOiBudWxsO1xuXG4gICAgLy8gb25seSBzZXQgZ3JvdXBfbGV2ZWwgZm9yIGFycmF5IGtleXNcbiAgICBpZiAoc2hvdWxkR3JvdXAgJiYgQXJyYXkuaXNBcnJheShrZXkpICYmIHR5cGVvZiBsdmwgPT09ICdudW1iZXInKSB7XG4gICAgICBrZXkgPSBrZXkubGVuZ3RoID4gbHZsID8ga2V5LnNsaWNlKDAsIGx2bCkgOiBrZXk7XG4gICAgfVxuXG4gICAgaWYgKGxhc3QgJiYgY29sbGF0ZShsYXN0LmtleVswXVswXSwga2V5KSA9PT0gMCkge1xuICAgICAgbGFzdC5rZXkucHVzaChba2V5LCBlLmlkXSk7XG4gICAgICBsYXN0LnZhbHVlLnB1c2goZS52YWx1ZSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGdyb3Vwcy5wdXNoKHtrZXk6IFtcbiAgICAgIFtrZXksIGUuaWRdXG4gICAgXSwgdmFsdWU6IFtlLnZhbHVlXX0pO1xuICB9KTtcbiAgZm9yICh2YXIgaSA9IDAsIGxlbiA9IGdyb3Vwcy5sZW5ndGg7IGkgPCBsZW47IGkrKykge1xuICAgIHZhciBlID0gZ3JvdXBzW2ldO1xuICAgIHZhciByZWR1Y2VUcnkgPSB0cnlDb2RlKHZpZXcuc291cmNlREIsIHJlZHVjZUZ1biwgW2Uua2V5LCBlLnZhbHVlLCBmYWxzZV0pO1xuICAgIGlmIChyZWR1Y2VUcnkuZXJyb3IgJiYgcmVkdWNlVHJ5LmVycm9yIGluc3RhbmNlb2YgQnVpbHRJbkVycm9yKSB7XG4gICAgICAvLyBDb3VjaERCIHJldHVybnMgYW4gZXJyb3IgaWYgYSBidWlsdC1pbiBlcnJvcnMgb3V0XG4gICAgICB0aHJvdyByZWR1Y2VUcnkuZXJyb3I7XG4gICAgfVxuICAgIC8vIENvdWNoREIganVzdCBzZXRzIHRoZSB2YWx1ZSB0byBudWxsIGlmIGEgbm9uLWJ1aWx0LWluIGVycm9ycyBvdXRcbiAgICBlLnZhbHVlID0gcmVkdWNlVHJ5LmVycm9yID8gbnVsbCA6IHJlZHVjZVRyeS5vdXRwdXQ7XG4gICAgZS5rZXkgPSBlLmtleVswXVswXTtcbiAgfVxuICAvLyBubyB0b3RhbF9yb3dzL29mZnNldCB3aGVuIHJlZHVjaW5nXG4gIHJldHVybiB7cm93czogc2xpY2VSZXN1bHRzKGdyb3Vwcywgb3B0aW9ucy5saW1pdCwgb3B0aW9ucy5za2lwKX07XG59XG5cbmZ1bmN0aW9uIHF1ZXJ5Vmlldyh2aWV3LCBvcHRzKSB7XG4gIHJldHVybiB1dGlscy5zZXF1ZW50aWFsaXplKGdldFF1ZXVlKHZpZXcpLCBmdW5jdGlvbiAoKSB7XG4gICAgcmV0dXJuIHF1ZXJ5Vmlld0luUXVldWUodmlldywgb3B0cyk7XG4gIH0pKCk7XG59XG5cbmZ1bmN0aW9uIHF1ZXJ5Vmlld0luUXVldWUodmlldywgb3B0cykge1xuICB2YXIgdG90YWxSb3dzO1xuICB2YXIgc2hvdWxkUmVkdWNlID0gdmlldy5yZWR1Y2VGdW4gJiYgb3B0cy5yZWR1Y2UgIT09IGZhbHNlO1xuICB2YXIgc2tpcCA9IG9wdHMuc2tpcCB8fCAwO1xuICBpZiAodHlwZW9mIG9wdHMua2V5cyAhPT0gJ3VuZGVmaW5lZCcgJiYgIW9wdHMua2V5cy5sZW5ndGgpIHtcbiAgICAvLyBlcXVpdmFsZW50IHF1ZXJ5XG4gICAgb3B0cy5saW1pdCA9IDA7XG4gICAgZGVsZXRlIG9wdHMua2V5cztcbiAgfVxuXG4gIGZ1bmN0aW9uIGZldGNoRnJvbVZpZXcodmlld09wdHMpIHtcbiAgICB2aWV3T3B0cy5pbmNsdWRlX2RvY3MgPSB0cnVlO1xuICAgIHJldHVybiB2aWV3LmRiLmFsbERvY3Modmlld09wdHMpLnRoZW4oZnVuY3Rpb24gKHJlcykge1xuICAgICAgdG90YWxSb3dzID0gcmVzLnRvdGFsX3Jvd3M7XG4gICAgICByZXR1cm4gcmVzLnJvd3MubWFwKGZ1bmN0aW9uIChyZXN1bHQpIHtcblxuICAgICAgICAvLyBpbXBsaWNpdCBtaWdyYXRpb24gLSBpbiBvbGRlciB2ZXJzaW9ucyBvZiBQb3VjaERCLFxuICAgICAgICAvLyB3ZSBleHBsaWNpdGx5IHN0b3JlZCB0aGUgZG9jIGFzIHtpZDogLi4uLCBrZXk6IC4uLiwgdmFsdWU6IC4uLn1cbiAgICAgICAgLy8gdGhpcyBpcyB0ZXN0ZWQgaW4gYSBtaWdyYXRpb24gdGVzdFxuICAgICAgICAvKiBpc3RhbmJ1bCBpZ25vcmUgbmV4dCAqL1xuICAgICAgICBpZiAoJ3ZhbHVlJyBpbiByZXN1bHQuZG9jICYmIHR5cGVvZiByZXN1bHQuZG9jLnZhbHVlID09PSAnb2JqZWN0JyAmJlxuICAgICAgICAgICAgcmVzdWx0LmRvYy52YWx1ZSAhPT0gbnVsbCkge1xuICAgICAgICAgIHZhciBrZXlzID0gT2JqZWN0LmtleXMocmVzdWx0LmRvYy52YWx1ZSkuc29ydCgpO1xuICAgICAgICAgIC8vIHRoaXMgZGV0ZWN0aW9uIG1ldGhvZCBpcyBub3QgcGVyZmVjdCwgYnV0IGl0J3MgdW5saWtlbHkgdGhlIHVzZXJcbiAgICAgICAgICAvLyBlbWl0dGVkIGEgdmFsdWUgd2hpY2ggd2FzIGFuIG9iamVjdCB3aXRoIHRoZXNlIDMgZXhhY3Qga2V5c1xuICAgICAgICAgIHZhciBleHBlY3RlZEtleXMgPSBbJ2lkJywgJ2tleScsICd2YWx1ZSddO1xuICAgICAgICAgIGlmICghKGtleXMgPCBleHBlY3RlZEtleXMgfHwga2V5cyA+IGV4cGVjdGVkS2V5cykpIHtcbiAgICAgICAgICAgIHJldHVybiByZXN1bHQuZG9jLnZhbHVlO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBwYXJzZWRLZXlBbmREb2NJZCA9IHBvdWNoQ29sbGF0ZS5wYXJzZUluZGV4YWJsZVN0cmluZyhyZXN1bHQuZG9jLl9pZCk7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAga2V5OiBwYXJzZWRLZXlBbmREb2NJZFswXSxcbiAgICAgICAgICBpZDogcGFyc2VkS2V5QW5kRG9jSWRbMV0sXG4gICAgICAgICAgdmFsdWU6ICgndmFsdWUnIGluIHJlc3VsdC5kb2MgPyByZXN1bHQuZG9jLnZhbHVlIDogbnVsbClcbiAgICAgICAgfTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgZnVuY3Rpb24gb25NYXBSZXN1bHRzUmVhZHkocm93cykge1xuICAgIHZhciBmaW5hbFJlc3VsdHM7XG4gICAgaWYgKHNob3VsZFJlZHVjZSkge1xuICAgICAgZmluYWxSZXN1bHRzID0gcmVkdWNlVmlldyh2aWV3LCByb3dzLCBvcHRzKTtcbiAgICB9IGVsc2Uge1xuICAgICAgZmluYWxSZXN1bHRzID0ge1xuICAgICAgICB0b3RhbF9yb3dzOiB0b3RhbFJvd3MsXG4gICAgICAgIG9mZnNldDogc2tpcCxcbiAgICAgICAgcm93czogcm93c1xuICAgICAgfTtcbiAgICB9XG4gICAgaWYgKG9wdHMuaW5jbHVkZV9kb2NzKSB7XG4gICAgICB2YXIgZG9jSWRzID0gdXRpbHMudW5pcShyb3dzLm1hcChyb3dUb0RvY0lkKSk7XG5cbiAgICAgIHJldHVybiB2aWV3LnNvdXJjZURCLmFsbERvY3Moe1xuICAgICAgICBrZXlzOiBkb2NJZHMsXG4gICAgICAgIGluY2x1ZGVfZG9jczogdHJ1ZSxcbiAgICAgICAgY29uZmxpY3RzOiBvcHRzLmNvbmZsaWN0cyxcbiAgICAgICAgYXR0YWNobWVudHM6IG9wdHMuYXR0YWNobWVudHNcbiAgICAgIH0pLnRoZW4oZnVuY3Rpb24gKGFsbERvY3NSZXMpIHtcbiAgICAgICAgdmFyIGRvY0lkc1RvRG9jcyA9IHt9O1xuICAgICAgICBhbGxEb2NzUmVzLnJvd3MuZm9yRWFjaChmdW5jdGlvbiAocm93KSB7XG4gICAgICAgICAgaWYgKHJvdy5kb2MpIHtcbiAgICAgICAgICAgIGRvY0lkc1RvRG9jc1snJCcgKyByb3cuaWRdID0gcm93LmRvYztcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICByb3dzLmZvckVhY2goZnVuY3Rpb24gKHJvdykge1xuICAgICAgICAgIHZhciBkb2NJZCA9IHJvd1RvRG9jSWQocm93KTtcbiAgICAgICAgICB2YXIgZG9jID0gZG9jSWRzVG9Eb2NzWyckJyArIGRvY0lkXTtcbiAgICAgICAgICBpZiAoZG9jKSB7XG4gICAgICAgICAgICByb3cuZG9jID0gZG9jO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiBmaW5hbFJlc3VsdHM7XG4gICAgICB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIGZpbmFsUmVzdWx0cztcbiAgICB9XG4gIH1cblxuICB2YXIgZmxhdHRlbiA9IGZ1bmN0aW9uIChhcnJheSkge1xuICAgIHJldHVybiBhcnJheS5yZWR1Y2UoZnVuY3Rpb24gKHByZXYsIGN1cikge1xuICAgICAgcmV0dXJuIHByZXYuY29uY2F0KGN1cik7XG4gICAgfSk7XG4gIH07XG5cbiAgaWYgKHR5cGVvZiBvcHRzLmtleXMgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgdmFyIGtleXMgPSBvcHRzLmtleXM7XG4gICAgdmFyIGZldGNoUHJvbWlzZXMgPSBrZXlzLm1hcChmdW5jdGlvbiAoa2V5KSB7XG4gICAgICB2YXIgdmlld09wdHMgPSB7XG4gICAgICAgIHN0YXJ0a2V5IDogdG9JbmRleGFibGVTdHJpbmcoW2tleV0pLFxuICAgICAgICBlbmRrZXkgICA6IHRvSW5kZXhhYmxlU3RyaW5nKFtrZXksIHt9XSlcbiAgICAgIH07XG4gICAgICByZXR1cm4gZmV0Y2hGcm9tVmlldyh2aWV3T3B0cyk7XG4gICAgfSk7XG4gICAgcmV0dXJuIFByb21pc2UuYWxsKGZldGNoUHJvbWlzZXMpLnRoZW4oZmxhdHRlbikudGhlbihvbk1hcFJlc3VsdHNSZWFkeSk7XG4gIH0gZWxzZSB7IC8vIG5vcm1hbCBxdWVyeSwgbm8gJ2tleXMnXG4gICAgdmFyIHZpZXdPcHRzID0ge1xuICAgICAgZGVzY2VuZGluZyA6IG9wdHMuZGVzY2VuZGluZ1xuICAgIH07XG4gICAgaWYgKHR5cGVvZiBvcHRzLnN0YXJ0a2V5ICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgdmlld09wdHMuc3RhcnRrZXkgPSBvcHRzLmRlc2NlbmRpbmcgP1xuICAgICAgICB0b0luZGV4YWJsZVN0cmluZyhbb3B0cy5zdGFydGtleSwge31dKSA6XG4gICAgICAgIHRvSW5kZXhhYmxlU3RyaW5nKFtvcHRzLnN0YXJ0a2V5XSk7XG4gICAgfVxuICAgIGlmICh0eXBlb2Ygb3B0cy5lbmRrZXkgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICB2YXIgaW5jbHVzaXZlRW5kID0gb3B0cy5pbmNsdXNpdmVfZW5kICE9PSBmYWxzZTtcbiAgICAgIGlmIChvcHRzLmRlc2NlbmRpbmcpIHtcbiAgICAgICAgaW5jbHVzaXZlRW5kID0gIWluY2x1c2l2ZUVuZDtcbiAgICAgIH1cblxuICAgICAgdmlld09wdHMuZW5ka2V5ID0gdG9JbmRleGFibGVTdHJpbmcoaW5jbHVzaXZlRW5kID8gW29wdHMuZW5ka2V5LCB7fV0gOiBbb3B0cy5lbmRrZXldKTtcbiAgICB9XG4gICAgaWYgKHR5cGVvZiBvcHRzLmtleSAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgIHZhciBrZXlTdGFydCA9IHRvSW5kZXhhYmxlU3RyaW5nKFtvcHRzLmtleV0pO1xuICAgICAgdmFyIGtleUVuZCA9IHRvSW5kZXhhYmxlU3RyaW5nKFtvcHRzLmtleSwge31dKTtcbiAgICAgIGlmICh2aWV3T3B0cy5kZXNjZW5kaW5nKSB7XG4gICAgICAgIHZpZXdPcHRzLmVuZGtleSA9IGtleVN0YXJ0O1xuICAgICAgICB2aWV3T3B0cy5zdGFydGtleSA9IGtleUVuZDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHZpZXdPcHRzLnN0YXJ0a2V5ID0ga2V5U3RhcnQ7XG4gICAgICAgIHZpZXdPcHRzLmVuZGtleSA9IGtleUVuZDtcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKCFzaG91bGRSZWR1Y2UpIHtcbiAgICAgIGlmICh0eXBlb2Ygb3B0cy5saW1pdCA9PT0gJ251bWJlcicpIHtcbiAgICAgICAgdmlld09wdHMubGltaXQgPSBvcHRzLmxpbWl0O1xuICAgICAgfVxuICAgICAgdmlld09wdHMuc2tpcCA9IHNraXA7XG4gICAgfVxuICAgIHJldHVybiBmZXRjaEZyb21WaWV3KHZpZXdPcHRzKS50aGVuKG9uTWFwUmVzdWx0c1JlYWR5KTtcbiAgfVxufVxuXG5mdW5jdGlvbiBodHRwVmlld0NsZWFudXAoZGIpIHtcbiAgcmV0dXJuIGRiLnJlcXVlc3Qoe1xuICAgIG1ldGhvZDogJ1BPU1QnLFxuICAgIHVybDogJ192aWV3X2NsZWFudXAnXG4gIH0pO1xufVxuXG5mdW5jdGlvbiBsb2NhbFZpZXdDbGVhbnVwKGRiKSB7XG4gIHJldHVybiBkYi5nZXQoJ19sb2NhbC9tcnZpZXdzJykudGhlbihmdW5jdGlvbiAobWV0YURvYykge1xuICAgIHZhciBkb2NzVG9WaWV3cyA9IHt9O1xuICAgIE9iamVjdC5rZXlzKG1ldGFEb2Mudmlld3MpLmZvckVhY2goZnVuY3Rpb24gKGZ1bGxWaWV3TmFtZSkge1xuICAgICAgdmFyIHBhcnRzID0gcGFyc2VWaWV3TmFtZShmdWxsVmlld05hbWUpO1xuICAgICAgdmFyIGRlc2lnbkRvY05hbWUgPSAnX2Rlc2lnbi8nICsgcGFydHNbMF07XG4gICAgICB2YXIgdmlld05hbWUgPSBwYXJ0c1sxXTtcbiAgICAgIGRvY3NUb1ZpZXdzW2Rlc2lnbkRvY05hbWVdID0gZG9jc1RvVmlld3NbZGVzaWduRG9jTmFtZV0gfHwge307XG4gICAgICBkb2NzVG9WaWV3c1tkZXNpZ25Eb2NOYW1lXVt2aWV3TmFtZV0gPSB0cnVlO1xuICAgIH0pO1xuICAgIHZhciBvcHRzID0ge1xuICAgICAga2V5cyA6IE9iamVjdC5rZXlzKGRvY3NUb1ZpZXdzKSxcbiAgICAgIGluY2x1ZGVfZG9jcyA6IHRydWVcbiAgICB9O1xuICAgIHJldHVybiBkYi5hbGxEb2NzKG9wdHMpLnRoZW4oZnVuY3Rpb24gKHJlcykge1xuICAgICAgdmFyIHZpZXdzVG9TdGF0dXMgPSB7fTtcbiAgICAgIHJlcy5yb3dzLmZvckVhY2goZnVuY3Rpb24gKHJvdykge1xuICAgICAgICB2YXIgZGRvY05hbWUgPSByb3cua2V5LnN1YnN0cmluZyg4KTtcbiAgICAgICAgT2JqZWN0LmtleXMoZG9jc1RvVmlld3Nbcm93LmtleV0pLmZvckVhY2goZnVuY3Rpb24gKHZpZXdOYW1lKSB7XG4gICAgICAgICAgdmFyIGZ1bGxWaWV3TmFtZSA9IGRkb2NOYW1lICsgJy8nICsgdmlld05hbWU7XG4gICAgICAgICAgLyogaXN0YW5idWwgaWdub3JlIGlmICovXG4gICAgICAgICAgaWYgKCFtZXRhRG9jLnZpZXdzW2Z1bGxWaWV3TmFtZV0pIHtcbiAgICAgICAgICAgIC8vIG5ldyBmb3JtYXQsIHdpdGhvdXQgc2xhc2hlcywgdG8gc3VwcG9ydCBQb3VjaERCIDIuMi4wXG4gICAgICAgICAgICAvLyBtaWdyYXRpb24gdGVzdCBpbiBwb3VjaGRiJ3MgYnJvd3Nlci5taWdyYXRpb24uanMgdmVyaWZpZXMgdGhpc1xuICAgICAgICAgICAgZnVsbFZpZXdOYW1lID0gdmlld05hbWU7XG4gICAgICAgICAgfVxuICAgICAgICAgIHZhciB2aWV3REJOYW1lcyA9IE9iamVjdC5rZXlzKG1ldGFEb2Mudmlld3NbZnVsbFZpZXdOYW1lXSk7XG4gICAgICAgICAgLy8gZGVzaWduIGRvYyBkZWxldGVkLCBvciB2aWV3IGZ1bmN0aW9uIG5vbmV4aXN0ZW50XG4gICAgICAgICAgdmFyIHN0YXR1c0lzR29vZCA9IHJvdy5kb2MgJiYgcm93LmRvYy52aWV3cyAmJiByb3cuZG9jLnZpZXdzW3ZpZXdOYW1lXTtcbiAgICAgICAgICB2aWV3REJOYW1lcy5mb3JFYWNoKGZ1bmN0aW9uICh2aWV3REJOYW1lKSB7XG4gICAgICAgICAgICB2aWV3c1RvU3RhdHVzW3ZpZXdEQk5hbWVdID0gdmlld3NUb1N0YXR1c1t2aWV3REJOYW1lXSB8fCBzdGF0dXNJc0dvb2Q7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgICB2YXIgZGJzVG9EZWxldGUgPSBPYmplY3Qua2V5cyh2aWV3c1RvU3RhdHVzKS5maWx0ZXIoZnVuY3Rpb24gKHZpZXdEQk5hbWUpIHtcbiAgICAgICAgcmV0dXJuICF2aWV3c1RvU3RhdHVzW3ZpZXdEQk5hbWVdO1xuICAgICAgfSk7XG4gICAgICB2YXIgZGVzdHJveVByb21pc2VzID0gZGJzVG9EZWxldGUubWFwKGZ1bmN0aW9uICh2aWV3REJOYW1lKSB7XG4gICAgICAgIHJldHVybiB1dGlscy5zZXF1ZW50aWFsaXplKGdldFF1ZXVlKHZpZXdEQk5hbWUpLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgcmV0dXJuIG5ldyBkYi5jb25zdHJ1Y3Rvcih2aWV3REJOYW1lLCBkYi5fX29wdHMpLmRlc3Ryb3koKTtcbiAgICAgICAgfSkoKTtcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuIFByb21pc2UuYWxsKGRlc3Ryb3lQcm9taXNlcykudGhlbihmdW5jdGlvbiAoKSB7XG4gICAgICAgIHJldHVybiB7b2s6IHRydWV9O1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH0sIGRlZmF1bHRzVG8oe29rOiB0cnVlfSkpO1xufVxuXG5leHBvcnRzLnZpZXdDbGVhbnVwID0gdXRpbHMuY2FsbGJhY2tpZnkoZnVuY3Rpb24gKCkge1xuICB2YXIgZGIgPSB0aGlzO1xuICBpZiAoZGIudHlwZSgpID09PSAnaHR0cCcpIHtcbiAgICByZXR1cm4gaHR0cFZpZXdDbGVhbnVwKGRiKTtcbiAgfVxuICByZXR1cm4gbG9jYWxWaWV3Q2xlYW51cChkYik7XG59KTtcblxuZnVuY3Rpb24gcXVlcnlQcm9taXNlZChkYiwgZnVuLCBvcHRzKSB7XG4gIGlmIChkYi50eXBlKCkgPT09ICdodHRwJykge1xuICAgIHJldHVybiBodHRwUXVlcnkoZGIsIGZ1biwgb3B0cyk7XG4gIH1cblxuICBpZiAodHlwZW9mIGZ1biAhPT0gJ3N0cmluZycpIHtcbiAgICAvLyB0ZW1wX3ZpZXdcbiAgICBjaGVja1F1ZXJ5UGFyc2VFcnJvcihvcHRzLCBmdW4pO1xuXG4gICAgdmFyIGNyZWF0ZVZpZXdPcHRzID0ge1xuICAgICAgZGIgOiBkYixcbiAgICAgIHZpZXdOYW1lIDogJ3RlbXBfdmlldy90ZW1wX3ZpZXcnLFxuICAgICAgbWFwIDogZnVuLm1hcCxcbiAgICAgIHJlZHVjZSA6IGZ1bi5yZWR1Y2UsXG4gICAgICB0ZW1wb3JhcnkgOiB0cnVlXG4gICAgfTtcbiAgICB0ZW1wVmlld1F1ZXVlLmFkZChmdW5jdGlvbiAoKSB7XG4gICAgICByZXR1cm4gY3JlYXRlVmlldyhjcmVhdGVWaWV3T3B0cykudGhlbihmdW5jdGlvbiAodmlldykge1xuICAgICAgICBmdW5jdGlvbiBjbGVhbnVwKCkge1xuICAgICAgICAgIHJldHVybiB2aWV3LmRiLmRlc3Ryb3koKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdXRpbHMuZmluKHVwZGF0ZVZpZXcodmlldykudGhlbihmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgcmV0dXJuIHF1ZXJ5Vmlldyh2aWV3LCBvcHRzKTtcbiAgICAgICAgfSksIGNsZWFudXApO1xuICAgICAgfSk7XG4gICAgfSk7XG4gICAgcmV0dXJuIHRlbXBWaWV3UXVldWUuZmluaXNoKCk7XG4gIH0gZWxzZSB7XG4gICAgLy8gcGVyc2lzdGVudCB2aWV3XG4gICAgdmFyIGZ1bGxWaWV3TmFtZSA9IGZ1bjtcbiAgICB2YXIgcGFydHMgPSBwYXJzZVZpZXdOYW1lKGZ1bGxWaWV3TmFtZSk7XG4gICAgdmFyIGRlc2lnbkRvY05hbWUgPSBwYXJ0c1swXTtcbiAgICB2YXIgdmlld05hbWUgPSBwYXJ0c1sxXTtcbiAgICByZXR1cm4gZGIuZ2V0KCdfZGVzaWduLycgKyBkZXNpZ25Eb2NOYW1lKS50aGVuKGZ1bmN0aW9uIChkb2MpIHtcbiAgICAgIHZhciBmdW4gPSBkb2Mudmlld3MgJiYgZG9jLnZpZXdzW3ZpZXdOYW1lXTtcblxuICAgICAgaWYgKCFmdW4gfHwgdHlwZW9mIGZ1bi5tYXAgIT09ICdzdHJpbmcnKSB7XG4gICAgICAgIHRocm93IG5ldyBOb3RGb3VuZEVycm9yKCdkZG9jICcgKyBkZXNpZ25Eb2NOYW1lICsgJyBoYXMgbm8gdmlldyBuYW1lZCAnICtcbiAgICAgICAgICB2aWV3TmFtZSk7XG4gICAgICB9XG4gICAgICBjaGVja1F1ZXJ5UGFyc2VFcnJvcihvcHRzLCBmdW4pO1xuXG4gICAgICB2YXIgY3JlYXRlVmlld09wdHMgPSB7XG4gICAgICAgIGRiIDogZGIsXG4gICAgICAgIHZpZXdOYW1lIDogZnVsbFZpZXdOYW1lLFxuICAgICAgICBtYXAgOiBmdW4ubWFwLFxuICAgICAgICByZWR1Y2UgOiBmdW4ucmVkdWNlXG4gICAgICB9O1xuICAgICAgcmV0dXJuIGNyZWF0ZVZpZXcoY3JlYXRlVmlld09wdHMpLnRoZW4oZnVuY3Rpb24gKHZpZXcpIHtcbiAgICAgICAgaWYgKG9wdHMuc3RhbGUgPT09ICdvaycgfHwgb3B0cy5zdGFsZSA9PT0gJ3VwZGF0ZV9hZnRlcicpIHtcbiAgICAgICAgICBpZiAob3B0cy5zdGFsZSA9PT0gJ3VwZGF0ZV9hZnRlcicpIHtcbiAgICAgICAgICAgIHByb2Nlc3MubmV4dFRpY2soZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICB1cGRhdGVWaWV3KHZpZXcpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiBxdWVyeVZpZXcodmlldywgb3B0cyk7XG4gICAgICAgIH0gZWxzZSB7IC8vIHN0YWxlIG5vdCBva1xuICAgICAgICAgIHJldHVybiB1cGRhdGVWaWV3KHZpZXcpLnRoZW4oZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgcmV0dXJuIHF1ZXJ5Vmlldyh2aWV3LCBvcHRzKTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cbn1cblxuZXhwb3J0cy5xdWVyeSA9IGZ1bmN0aW9uIChmdW4sIG9wdHMsIGNhbGxiYWNrKSB7XG4gIGlmICh0eXBlb2Ygb3B0cyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIGNhbGxiYWNrID0gb3B0cztcbiAgICBvcHRzID0ge307XG4gIH1cbiAgb3B0cyA9IHV0aWxzLmV4dGVuZCh0cnVlLCB7fSwgb3B0cyk7XG5cbiAgaWYgKHR5cGVvZiBmdW4gPT09ICdmdW5jdGlvbicpIHtcbiAgICBmdW4gPSB7bWFwIDogZnVufTtcbiAgfVxuXG4gIHZhciBkYiA9IHRoaXM7XG4gIHZhciBwcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKCkudGhlbihmdW5jdGlvbiAoKSB7XG4gICAgcmV0dXJuIHF1ZXJ5UHJvbWlzZWQoZGIsIGZ1biwgb3B0cyk7XG4gIH0pO1xuICB1dGlscy5wcm9taXNlZENhbGxiYWNrKHByb21pc2UsIGNhbGxiYWNrKTtcbiAgcmV0dXJuIHByb21pc2U7XG59O1xuXG5mdW5jdGlvbiBRdWVyeVBhcnNlRXJyb3IobWVzc2FnZSkge1xuICB0aGlzLnN0YXR1cyA9IDQwMDtcbiAgdGhpcy5uYW1lID0gJ3F1ZXJ5X3BhcnNlX2Vycm9yJztcbiAgdGhpcy5tZXNzYWdlID0gbWVzc2FnZTtcbiAgdGhpcy5lcnJvciA9IHRydWU7XG4gIHRyeSB7XG4gICAgRXJyb3IuY2FwdHVyZVN0YWNrVHJhY2UodGhpcywgUXVlcnlQYXJzZUVycm9yKTtcbiAgfSBjYXRjaCAoZSkge31cbn1cblxudXRpbHMuaW5oZXJpdHMoUXVlcnlQYXJzZUVycm9yLCBFcnJvcik7XG5cbmZ1bmN0aW9uIE5vdEZvdW5kRXJyb3IobWVzc2FnZSkge1xuICB0aGlzLnN0YXR1cyA9IDQwNDtcbiAgdGhpcy5uYW1lID0gJ25vdF9mb3VuZCc7XG4gIHRoaXMubWVzc2FnZSA9IG1lc3NhZ2U7XG4gIHRoaXMuZXJyb3IgPSB0cnVlO1xuICB0cnkge1xuICAgIEVycm9yLmNhcHR1cmVTdGFja1RyYWNlKHRoaXMsIE5vdEZvdW5kRXJyb3IpO1xuICB9IGNhdGNoIChlKSB7fVxufVxuXG51dGlscy5pbmhlcml0cyhOb3RGb3VuZEVycm9yLCBFcnJvcik7XG5cbmZ1bmN0aW9uIEJ1aWx0SW5FcnJvcihtZXNzYWdlKSB7XG4gIHRoaXMuc3RhdHVzID0gNTAwO1xuICB0aGlzLm5hbWUgPSAnaW52YWxpZF92YWx1ZSc7XG4gIHRoaXMubWVzc2FnZSA9IG1lc3NhZ2U7XG4gIHRoaXMuZXJyb3IgPSB0cnVlO1xuICB0cnkge1xuICAgIEVycm9yLmNhcHR1cmVTdGFja1RyYWNlKHRoaXMsIEJ1aWx0SW5FcnJvcik7XG4gIH0gY2F0Y2ggKGUpIHt9XG59XG5cbnV0aWxzLmluaGVyaXRzKEJ1aWx0SW5FcnJvciwgRXJyb3IpOyIsIid1c2Ugc3RyaWN0Jztcbi8qXG4gKiBTaW1wbGUgdGFzayBxdWV1ZSB0byBzZXF1ZW50aWFsaXplIGFjdGlvbnMuIEFzc3VtZXMgY2FsbGJhY2tzIHdpbGwgZXZlbnR1YWxseSBmaXJlIChvbmNlKS5cbiAqL1xuXG52YXIgUHJvbWlzZSA9IHJlcXVpcmUoJy4vdXRpbHMnKS5Qcm9taXNlO1xuXG5mdW5jdGlvbiBUYXNrUXVldWUoKSB7XG4gIHRoaXMucHJvbWlzZSA9IG5ldyBQcm9taXNlKGZ1bmN0aW9uIChmdWxmaWxsKSB7ZnVsZmlsbCgpOyB9KTtcbn1cblRhc2tRdWV1ZS5wcm90b3R5cGUuYWRkID0gZnVuY3Rpb24gKHByb21pc2VGYWN0b3J5KSB7XG4gIHRoaXMucHJvbWlzZSA9IHRoaXMucHJvbWlzZVtcImNhdGNoXCJdKGZ1bmN0aW9uICgpIHtcbiAgICAvLyBqdXN0IHJlY292ZXJcbiAgfSkudGhlbihmdW5jdGlvbiAoKSB7XG4gICAgcmV0dXJuIHByb21pc2VGYWN0b3J5KCk7XG4gIH0pO1xuICByZXR1cm4gdGhpcy5wcm9taXNlO1xufTtcblRhc2tRdWV1ZS5wcm90b3R5cGUuZmluaXNoID0gZnVuY3Rpb24gKCkge1xuICByZXR1cm4gdGhpcy5wcm9taXNlO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBUYXNrUXVldWU7XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciB1cHNlcnQgPSByZXF1aXJlKCdwb3VjaGRiLXVwc2VydCcpLnVwc2VydDtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoZGIsIGRvYywgZGlmZkZ1bikge1xuICByZXR1cm4gdXBzZXJ0LmFwcGx5KGRiLCBbZG9jLCBkaWZmRnVuXSk7XG59OyIsIid1c2Ugc3RyaWN0Jztcbi8qIGlzdGFuYnVsIGlnbm9yZSBpZiAqL1xuaWYgKHR5cGVvZiBnbG9iYWwuUHJvbWlzZSA9PT0gJ2Z1bmN0aW9uJykge1xuICBleHBvcnRzLlByb21pc2UgPSBnbG9iYWwuUHJvbWlzZTtcbn0gZWxzZSB7XG4gIGV4cG9ydHMuUHJvbWlzZSA9IHJlcXVpcmUoJ2xpZScpO1xufVxuXG5leHBvcnRzLmluaGVyaXRzID0gcmVxdWlyZSgnaW5oZXJpdHMnKTtcbmV4cG9ydHMuZXh0ZW5kID0gcmVxdWlyZSgncG91Y2hkYi1leHRlbmQnKTtcbnZhciBhcmdzYXJyYXkgPSByZXF1aXJlKCdhcmdzYXJyYXknKTtcblxuZXhwb3J0cy5wcm9taXNlZENhbGxiYWNrID0gZnVuY3Rpb24gKHByb21pc2UsIGNhbGxiYWNrKSB7XG4gIGlmIChjYWxsYmFjaykge1xuICAgIHByb21pc2UudGhlbihmdW5jdGlvbiAocmVzKSB7XG4gICAgICBwcm9jZXNzLm5leHRUaWNrKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgY2FsbGJhY2sobnVsbCwgcmVzKTtcbiAgICAgIH0pO1xuICAgIH0sIGZ1bmN0aW9uIChyZWFzb24pIHtcbiAgICAgIHByb2Nlc3MubmV4dFRpY2soZnVuY3Rpb24gKCkge1xuICAgICAgICBjYWxsYmFjayhyZWFzb24pO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cbiAgcmV0dXJuIHByb21pc2U7XG59O1xuXG5leHBvcnRzLmNhbGxiYWNraWZ5ID0gZnVuY3Rpb24gKGZ1bikge1xuICByZXR1cm4gYXJnc2FycmF5KGZ1bmN0aW9uIChhcmdzKSB7XG4gICAgdmFyIGNiID0gYXJncy5wb3AoKTtcbiAgICB2YXIgcHJvbWlzZSA9IGZ1bi5hcHBseSh0aGlzLCBhcmdzKTtcbiAgICBpZiAodHlwZW9mIGNiID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICBleHBvcnRzLnByb21pc2VkQ2FsbGJhY2socHJvbWlzZSwgY2IpO1xuICAgIH1cbiAgICByZXR1cm4gcHJvbWlzZTtcbiAgfSk7XG59O1xuXG4vLyBQcm9taXNlIGZpbmFsbHkgdXRpbCBzaW1pbGFyIHRvIFEuZmluYWxseVxuZXhwb3J0cy5maW4gPSBmdW5jdGlvbiAocHJvbWlzZSwgY2IpIHtcbiAgcmV0dXJuIHByb21pc2UudGhlbihmdW5jdGlvbiAocmVzKSB7XG4gICAgdmFyIHByb21pc2UyID0gY2IoKTtcbiAgICBpZiAodHlwZW9mIHByb21pc2UyLnRoZW4gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHJldHVybiBwcm9taXNlMi50aGVuKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgcmV0dXJuIHJlcztcbiAgICAgIH0pO1xuICAgIH1cbiAgICByZXR1cm4gcmVzO1xuICB9LCBmdW5jdGlvbiAocmVhc29uKSB7XG4gICAgdmFyIHByb21pc2UyID0gY2IoKTtcbiAgICBpZiAodHlwZW9mIHByb21pc2UyLnRoZW4gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHJldHVybiBwcm9taXNlMi50aGVuKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdGhyb3cgcmVhc29uO1xuICAgICAgfSk7XG4gICAgfVxuICAgIHRocm93IHJlYXNvbjtcbiAgfSk7XG59O1xuXG5leHBvcnRzLnNlcXVlbnRpYWxpemUgPSBmdW5jdGlvbiAocXVldWUsIHByb21pc2VGYWN0b3J5KSB7XG4gIHJldHVybiBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIGFyZ3MgPSBhcmd1bWVudHM7XG4gICAgdmFyIHRoYXQgPSB0aGlzO1xuICAgIHJldHVybiBxdWV1ZS5hZGQoZnVuY3Rpb24gKCkge1xuICAgICAgcmV0dXJuIHByb21pc2VGYWN0b3J5LmFwcGx5KHRoYXQsIGFyZ3MpO1xuICAgIH0pO1xuICB9O1xufTtcblxuZXhwb3J0cy5mbGF0dGVuID0gZnVuY3Rpb24gKGFycnMpIHtcbiAgdmFyIHJlcyA9IFtdO1xuICBmb3IgKHZhciBpID0gMCwgbGVuID0gYXJycy5sZW5ndGg7IGkgPCBsZW47IGkrKykge1xuICAgIHJlcyA9IHJlcy5jb25jYXQoYXJyc1tpXSk7XG4gIH1cbiAgcmV0dXJuIHJlcztcbn07XG5cbi8vIHVuaXEgYW4gYXJyYXkgb2Ygc3RyaW5ncywgb3JkZXIgbm90IGd1YXJhbnRlZWRcbi8vIHNpbWlsYXIgdG8gdW5kZXJzY29yZS9sb2Rhc2ggXy51bmlxXG5leHBvcnRzLnVuaXEgPSBmdW5jdGlvbiAoYXJyKSB7XG4gIHZhciBtYXAgPSB7fTtcblxuICBmb3IgKHZhciBpID0gMCwgbGVuID0gYXJyLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgbWFwWyckJyArIGFycltpXV0gPSB0cnVlO1xuICB9XG5cbiAgdmFyIGtleXMgPSBPYmplY3Qua2V5cyhtYXApO1xuICB2YXIgb3V0cHV0ID0gbmV3IEFycmF5KGtleXMubGVuZ3RoKTtcblxuICBmb3IgKGkgPSAwLCBsZW4gPSBrZXlzLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgb3V0cHV0W2ldID0ga2V5c1tpXS5zdWJzdHJpbmcoMSk7XG4gIH1cbiAgcmV0dXJuIG91dHB1dDtcbn07XG5cbnZhciBjcnlwdG8gPSByZXF1aXJlKCdjcnlwdG8nKTtcbnZhciBNZDUgPSByZXF1aXJlKCdzcGFyay1tZDUnKTtcblxuZXhwb3J0cy5NRDUgPSBmdW5jdGlvbiAoc3RyaW5nKSB7XG4gIC8qIGlzdGFuYnVsIGlnbm9yZSBlbHNlICovXG4gIGlmICghcHJvY2Vzcy5icm93c2VyKSB7XG4gICAgcmV0dXJuIGNyeXB0by5jcmVhdGVIYXNoKCdtZDUnKS51cGRhdGUoc3RyaW5nKS5kaWdlc3QoJ2hleCcpO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiBNZDUuaGFzaChzdHJpbmcpO1xuICB9XG59OyIsIid1c2Ugc3RyaWN0JztcblxudmFyIFBvdWNoUHJvbWlzZTtcbi8qIGlzdGFuYnVsIGlnbm9yZSBuZXh0ICovXG5pZiAodHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcgJiYgd2luZG93LlBvdWNoREIpIHtcbiAgUG91Y2hQcm9taXNlID0gd2luZG93LlBvdWNoREIudXRpbHMuUHJvbWlzZTtcbn0gZWxzZSB7XG4gIFBvdWNoUHJvbWlzZSA9IHR5cGVvZiBnbG9iYWwuUHJvbWlzZSA9PT0gJ2Z1bmN0aW9uJyA/IGdsb2JhbC5Qcm9taXNlIDogcmVxdWlyZSgnbGllJyk7XG59XG5cbi8vIHRoaXMgaXMgZXNzZW50aWFsbHkgdGhlIFwidXBkYXRlIHN1Z2FyXCIgZnVuY3Rpb24gZnJvbSBkYWxlaGFydmV5L3BvdWNoZGIjMTM4OFxuLy8gdGhlIGRpZmZGdW4gdGVsbHMgdXMgd2hhdCBkZWx0YSB0byBhcHBseSB0byB0aGUgZG9jLiAgaXQgZWl0aGVyIHJldHVybnNcbi8vIHRoZSBkb2MsIG9yIGZhbHNlIGlmIGl0IGRvZXNuJ3QgbmVlZCB0byBkbyBhbiB1cGRhdGUgYWZ0ZXIgYWxsXG5mdW5jdGlvbiB1cHNlcnRJbm5lcihkYiwgZG9jSWQsIGRpZmZGdW4pIHtcbiAgcmV0dXJuIG5ldyBQb3VjaFByb21pc2UoZnVuY3Rpb24gKGZ1bGZpbGwsIHJlamVjdCkge1xuICAgIGlmICh0eXBlb2YgZG9jSWQgIT09ICdzdHJpbmcnKSB7XG4gICAgICByZXR1cm4gcmVqZWN0KG5ldyBFcnJvcignZG9jIGlkIGlzIHJlcXVpcmVkJykpO1xuICAgIH1cblxuICAgIGRiLmdldChkb2NJZCwgZnVuY3Rpb24gKGVyciwgZG9jKSB7XG4gICAgICBpZiAoZXJyKSB7XG4gICAgICAgIC8qIGlzdGFuYnVsIGlnbm9yZSBuZXh0ICovXG4gICAgICAgIGlmIChlcnIuc3RhdHVzICE9PSA0MDQpIHtcbiAgICAgICAgICByZXR1cm4gcmVqZWN0KGVycik7XG4gICAgICAgIH1cbiAgICAgICAgZG9jID0ge307XG4gICAgICB9XG5cbiAgICAgIC8vIHRoZSB1c2VyIG1pZ2h0IGNoYW5nZSB0aGUgX3Jldiwgc28gc2F2ZSBpdCBmb3IgcG9zdGVyaXR5XG4gICAgICB2YXIgZG9jUmV2ID0gZG9jLl9yZXY7XG4gICAgICB2YXIgbmV3RG9jID0gZGlmZkZ1bihkb2MpO1xuXG4gICAgICBpZiAoIW5ld0RvYykge1xuICAgICAgICAvLyBpZiB0aGUgZGlmZkZ1biByZXR1cm5zIGZhbHN5LCB3ZSBzaG9ydC1jaXJjdWl0IGFzXG4gICAgICAgIC8vIGFuIG9wdGltaXphdGlvblxuICAgICAgICByZXR1cm4gZnVsZmlsbCh7dXBkYXRlZDogZmFsc2UsIHJldjogZG9jUmV2fSk7XG4gICAgICB9XG5cbiAgICAgIC8vIHVzZXJzIGFyZW4ndCBhbGxvd2VkIHRvIG1vZGlmeSB0aGVzZSB2YWx1ZXMsXG4gICAgICAvLyBzbyByZXNldCB0aGVtIGhlcmVcbiAgICAgIG5ld0RvYy5faWQgPSBkb2NJZDtcbiAgICAgIG5ld0RvYy5fcmV2ID0gZG9jUmV2O1xuICAgICAgZnVsZmlsbCh0cnlBbmRQdXQoZGIsIG5ld0RvYywgZGlmZkZ1bikpO1xuICAgIH0pO1xuICB9KTtcbn1cblxuZnVuY3Rpb24gdHJ5QW5kUHV0KGRiLCBkb2MsIGRpZmZGdW4pIHtcbiAgcmV0dXJuIGRiLnB1dChkb2MpLnRoZW4oZnVuY3Rpb24gKHJlcykge1xuICAgIHJldHVybiB7XG4gICAgICB1cGRhdGVkOiB0cnVlLFxuICAgICAgcmV2OiByZXMucmV2XG4gICAgfTtcbiAgfSwgZnVuY3Rpb24gKGVycikge1xuICAgIC8qIGlzdGFuYnVsIGlnbm9yZSBuZXh0ICovXG4gICAgaWYgKGVyci5zdGF0dXMgIT09IDQwOSkge1xuICAgICAgdGhyb3cgZXJyO1xuICAgIH1cbiAgICByZXR1cm4gdXBzZXJ0SW5uZXIoZGIsIGRvYy5faWQsIGRpZmZGdW4pO1xuICB9KTtcbn1cblxuZXhwb3J0cy51cHNlcnQgPSBmdW5jdGlvbiB1cHNlcnQoZG9jSWQsIGRpZmZGdW4sIGNiKSB7XG4gIHZhciBkYiA9IHRoaXM7XG4gIHZhciBwcm9taXNlID0gdXBzZXJ0SW5uZXIoZGIsIGRvY0lkLCBkaWZmRnVuKTtcbiAgaWYgKHR5cGVvZiBjYiAhPT0gJ2Z1bmN0aW9uJykge1xuICAgIHJldHVybiBwcm9taXNlO1xuICB9XG4gIHByb21pc2UudGhlbihmdW5jdGlvbiAocmVzcCkge1xuICAgIGNiKG51bGwsIHJlc3ApO1xuICB9LCBjYik7XG59O1xuXG5leHBvcnRzLnB1dElmTm90RXhpc3RzID0gZnVuY3Rpb24gcHV0SWZOb3RFeGlzdHMoZG9jSWQsIGRvYywgY2IpIHtcbiAgdmFyIGRiID0gdGhpcztcblxuICBpZiAodHlwZW9mIGRvY0lkICE9PSAnc3RyaW5nJykge1xuICAgIGNiID0gZG9jO1xuICAgIGRvYyA9IGRvY0lkO1xuICAgIGRvY0lkID0gZG9jLl9pZDtcbiAgfVxuXG4gIHZhciBkaWZmRnVuID0gZnVuY3Rpb24gKGV4aXN0aW5nRG9jKSB7XG4gICAgaWYgKGV4aXN0aW5nRG9jLl9yZXYpIHtcbiAgICAgIHJldHVybiBmYWxzZTsgLy8gZG8gbm90aGluZ1xuICAgIH1cbiAgICByZXR1cm4gZG9jO1xuICB9O1xuXG4gIHZhciBwcm9taXNlID0gdXBzZXJ0SW5uZXIoZGIsIGRvY0lkLCBkaWZmRnVuKTtcbiAgaWYgKHR5cGVvZiBjYiAhPT0gJ2Z1bmN0aW9uJykge1xuICAgIHJldHVybiBwcm9taXNlO1xuICB9XG4gIHByb21pc2UudGhlbihmdW5jdGlvbiAocmVzcCkge1xuICAgIGNiKG51bGwsIHJlc3ApO1xuICB9LCBjYik7XG59O1xuXG5cbi8qIGlzdGFuYnVsIGlnbm9yZSBuZXh0ICovXG5pZiAodHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcgJiYgd2luZG93LlBvdWNoREIpIHtcbiAgd2luZG93LlBvdWNoREIucGx1Z2luKGV4cG9ydHMpO1xufVxuIiwiLypqc2hpbnQgYml0d2lzZTpmYWxzZSovXG4vKmdsb2JhbCB1bmVzY2FwZSovXG5cbihmdW5jdGlvbiAoZmFjdG9yeSkge1xuICAgIGlmICh0eXBlb2YgZXhwb3J0cyA9PT0gJ29iamVjdCcpIHtcbiAgICAgICAgLy8gTm9kZS9Db21tb25KU1xuICAgICAgICBtb2R1bGUuZXhwb3J0cyA9IGZhY3RvcnkoKTtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBkZWZpbmUgPT09ICdmdW5jdGlvbicgJiYgZGVmaW5lLmFtZCkge1xuICAgICAgICAvLyBBTURcbiAgICAgICAgZGVmaW5lKGZhY3RvcnkpO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIEJyb3dzZXIgZ2xvYmFscyAod2l0aCBzdXBwb3J0IGZvciB3ZWIgd29ya2VycylcbiAgICAgICAgdmFyIGdsb2I7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBnbG9iID0gd2luZG93O1xuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICBnbG9iID0gc2VsZjtcbiAgICAgICAgfVxuXG4gICAgICAgIGdsb2IuU3BhcmtNRDUgPSBmYWN0b3J5KCk7XG4gICAgfVxufShmdW5jdGlvbiAodW5kZWZpbmVkKSB7XG5cbiAgICAndXNlIHN0cmljdCc7XG5cbiAgICAvLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vXG5cbiAgICAvKlxuICAgICAqIEZhc3Rlc3QgbWQ1IGltcGxlbWVudGF0aW9uIGFyb3VuZCAoSktNIG1kNSlcbiAgICAgKiBDcmVkaXRzOiBKb3NlcGggTXllcnNcbiAgICAgKlxuICAgICAqIEBzZWUgaHR0cDovL3d3dy5teWVyc2RhaWx5Lm9yZy9qb3NlcGgvamF2YXNjcmlwdC9tZDUtdGV4dC5odG1sXG4gICAgICogQHNlZSBodHRwOi8vanNwZXJmLmNvbS9tZDUtc2hvb3RvdXQvN1xuICAgICAqL1xuXG4gICAgLyogdGhpcyBmdW5jdGlvbiBpcyBtdWNoIGZhc3RlcixcbiAgICAgIHNvIGlmIHBvc3NpYmxlIHdlIHVzZSBpdC4gU29tZSBJRXNcbiAgICAgIGFyZSB0aGUgb25seSBvbmVzIEkga25vdyBvZiB0aGF0XG4gICAgICBuZWVkIHRoZSBpZGlvdGljIHNlY29uZCBmdW5jdGlvbixcbiAgICAgIGdlbmVyYXRlZCBieSBhbiBpZiBjbGF1c2UuICAqL1xuICAgIHZhciBhZGQzMiA9IGZ1bmN0aW9uIChhLCBiKSB7XG4gICAgICAgIHJldHVybiAoYSArIGIpICYgMHhGRkZGRkZGRjtcbiAgICB9LFxuXG4gICAgY21uID0gZnVuY3Rpb24gKHEsIGEsIGIsIHgsIHMsIHQpIHtcbiAgICAgICAgYSA9IGFkZDMyKGFkZDMyKGEsIHEpLCBhZGQzMih4LCB0KSk7XG4gICAgICAgIHJldHVybiBhZGQzMigoYSA8PCBzKSB8IChhID4+PiAoMzIgLSBzKSksIGIpO1xuICAgIH0sXG5cbiAgICBmZiA9IGZ1bmN0aW9uIChhLCBiLCBjLCBkLCB4LCBzLCB0KSB7XG4gICAgICAgIHJldHVybiBjbW4oKGIgJiBjKSB8ICgofmIpICYgZCksIGEsIGIsIHgsIHMsIHQpO1xuICAgIH0sXG5cbiAgICBnZyA9IGZ1bmN0aW9uIChhLCBiLCBjLCBkLCB4LCBzLCB0KSB7XG4gICAgICAgIHJldHVybiBjbW4oKGIgJiBkKSB8IChjICYgKH5kKSksIGEsIGIsIHgsIHMsIHQpO1xuICAgIH0sXG5cbiAgICBoaCA9IGZ1bmN0aW9uIChhLCBiLCBjLCBkLCB4LCBzLCB0KSB7XG4gICAgICAgIHJldHVybiBjbW4oYiBeIGMgXiBkLCBhLCBiLCB4LCBzLCB0KTtcbiAgICB9LFxuXG4gICAgaWkgPSBmdW5jdGlvbiAoYSwgYiwgYywgZCwgeCwgcywgdCkge1xuICAgICAgICByZXR1cm4gY21uKGMgXiAoYiB8ICh+ZCkpLCBhLCBiLCB4LCBzLCB0KTtcbiAgICB9LFxuXG4gICAgbWQ1Y3ljbGUgPSBmdW5jdGlvbiAoeCwgaykge1xuICAgICAgICB2YXIgYSA9IHhbMF0sXG4gICAgICAgICAgICBiID0geFsxXSxcbiAgICAgICAgICAgIGMgPSB4WzJdLFxuICAgICAgICAgICAgZCA9IHhbM107XG5cbiAgICAgICAgYSA9IGZmKGEsIGIsIGMsIGQsIGtbMF0sIDcsIC02ODA4NzY5MzYpO1xuICAgICAgICBkID0gZmYoZCwgYSwgYiwgYywga1sxXSwgMTIsIC0zODk1NjQ1ODYpO1xuICAgICAgICBjID0gZmYoYywgZCwgYSwgYiwga1syXSwgMTcsIDYwNjEwNTgxOSk7XG4gICAgICAgIGIgPSBmZihiLCBjLCBkLCBhLCBrWzNdLCAyMiwgLTEwNDQ1MjUzMzApO1xuICAgICAgICBhID0gZmYoYSwgYiwgYywgZCwga1s0XSwgNywgLTE3NjQxODg5Nyk7XG4gICAgICAgIGQgPSBmZihkLCBhLCBiLCBjLCBrWzVdLCAxMiwgMTIwMDA4MDQyNik7XG4gICAgICAgIGMgPSBmZihjLCBkLCBhLCBiLCBrWzZdLCAxNywgLTE0NzMyMzEzNDEpO1xuICAgICAgICBiID0gZmYoYiwgYywgZCwgYSwga1s3XSwgMjIsIC00NTcwNTk4Myk7XG4gICAgICAgIGEgPSBmZihhLCBiLCBjLCBkLCBrWzhdLCA3LCAxNzcwMDM1NDE2KTtcbiAgICAgICAgZCA9IGZmKGQsIGEsIGIsIGMsIGtbOV0sIDEyLCAtMTk1ODQxNDQxNyk7XG4gICAgICAgIGMgPSBmZihjLCBkLCBhLCBiLCBrWzEwXSwgMTcsIC00MjA2Myk7XG4gICAgICAgIGIgPSBmZihiLCBjLCBkLCBhLCBrWzExXSwgMjIsIC0xOTkwNDA0MTYyKTtcbiAgICAgICAgYSA9IGZmKGEsIGIsIGMsIGQsIGtbMTJdLCA3LCAxODA0NjAzNjgyKTtcbiAgICAgICAgZCA9IGZmKGQsIGEsIGIsIGMsIGtbMTNdLCAxMiwgLTQwMzQxMTAxKTtcbiAgICAgICAgYyA9IGZmKGMsIGQsIGEsIGIsIGtbMTRdLCAxNywgLTE1MDIwMDIyOTApO1xuICAgICAgICBiID0gZmYoYiwgYywgZCwgYSwga1sxNV0sIDIyLCAxMjM2NTM1MzI5KTtcblxuICAgICAgICBhID0gZ2coYSwgYiwgYywgZCwga1sxXSwgNSwgLTE2NTc5NjUxMCk7XG4gICAgICAgIGQgPSBnZyhkLCBhLCBiLCBjLCBrWzZdLCA5LCAtMTA2OTUwMTYzMik7XG4gICAgICAgIGMgPSBnZyhjLCBkLCBhLCBiLCBrWzExXSwgMTQsIDY0MzcxNzcxMyk7XG4gICAgICAgIGIgPSBnZyhiLCBjLCBkLCBhLCBrWzBdLCAyMCwgLTM3Mzg5NzMwMik7XG4gICAgICAgIGEgPSBnZyhhLCBiLCBjLCBkLCBrWzVdLCA1LCAtNzAxNTU4NjkxKTtcbiAgICAgICAgZCA9IGdnKGQsIGEsIGIsIGMsIGtbMTBdLCA5LCAzODAxNjA4Myk7XG4gICAgICAgIGMgPSBnZyhjLCBkLCBhLCBiLCBrWzE1XSwgMTQsIC02NjA0NzgzMzUpO1xuICAgICAgICBiID0gZ2coYiwgYywgZCwgYSwga1s0XSwgMjAsIC00MDU1Mzc4NDgpO1xuICAgICAgICBhID0gZ2coYSwgYiwgYywgZCwga1s5XSwgNSwgNTY4NDQ2NDM4KTtcbiAgICAgICAgZCA9IGdnKGQsIGEsIGIsIGMsIGtbMTRdLCA5LCAtMTAxOTgwMzY5MCk7XG4gICAgICAgIGMgPSBnZyhjLCBkLCBhLCBiLCBrWzNdLCAxNCwgLTE4NzM2Mzk2MSk7XG4gICAgICAgIGIgPSBnZyhiLCBjLCBkLCBhLCBrWzhdLCAyMCwgMTE2MzUzMTUwMSk7XG4gICAgICAgIGEgPSBnZyhhLCBiLCBjLCBkLCBrWzEzXSwgNSwgLTE0NDQ2ODE0NjcpO1xuICAgICAgICBkID0gZ2coZCwgYSwgYiwgYywga1syXSwgOSwgLTUxNDAzNzg0KTtcbiAgICAgICAgYyA9IGdnKGMsIGQsIGEsIGIsIGtbN10sIDE0LCAxNzM1MzI4NDczKTtcbiAgICAgICAgYiA9IGdnKGIsIGMsIGQsIGEsIGtbMTJdLCAyMCwgLTE5MjY2MDc3MzQpO1xuXG4gICAgICAgIGEgPSBoaChhLCBiLCBjLCBkLCBrWzVdLCA0LCAtMzc4NTU4KTtcbiAgICAgICAgZCA9IGhoKGQsIGEsIGIsIGMsIGtbOF0sIDExLCAtMjAyMjU3NDQ2Myk7XG4gICAgICAgIGMgPSBoaChjLCBkLCBhLCBiLCBrWzExXSwgMTYsIDE4MzkwMzA1NjIpO1xuICAgICAgICBiID0gaGgoYiwgYywgZCwgYSwga1sxNF0sIDIzLCAtMzUzMDk1NTYpO1xuICAgICAgICBhID0gaGgoYSwgYiwgYywgZCwga1sxXSwgNCwgLTE1MzA5OTIwNjApO1xuICAgICAgICBkID0gaGgoZCwgYSwgYiwgYywga1s0XSwgMTEsIDEyNzI4OTMzNTMpO1xuICAgICAgICBjID0gaGgoYywgZCwgYSwgYiwga1s3XSwgMTYsIC0xNTU0OTc2MzIpO1xuICAgICAgICBiID0gaGgoYiwgYywgZCwgYSwga1sxMF0sIDIzLCAtMTA5NDczMDY0MCk7XG4gICAgICAgIGEgPSBoaChhLCBiLCBjLCBkLCBrWzEzXSwgNCwgNjgxMjc5MTc0KTtcbiAgICAgICAgZCA9IGhoKGQsIGEsIGIsIGMsIGtbMF0sIDExLCAtMzU4NTM3MjIyKTtcbiAgICAgICAgYyA9IGhoKGMsIGQsIGEsIGIsIGtbM10sIDE2LCAtNzIyNTIxOTc5KTtcbiAgICAgICAgYiA9IGhoKGIsIGMsIGQsIGEsIGtbNl0sIDIzLCA3NjAyOTE4OSk7XG4gICAgICAgIGEgPSBoaChhLCBiLCBjLCBkLCBrWzldLCA0LCAtNjQwMzY0NDg3KTtcbiAgICAgICAgZCA9IGhoKGQsIGEsIGIsIGMsIGtbMTJdLCAxMSwgLTQyMTgxNTgzNSk7XG4gICAgICAgIGMgPSBoaChjLCBkLCBhLCBiLCBrWzE1XSwgMTYsIDUzMDc0MjUyMCk7XG4gICAgICAgIGIgPSBoaChiLCBjLCBkLCBhLCBrWzJdLCAyMywgLTk5NTMzODY1MSk7XG5cbiAgICAgICAgYSA9IGlpKGEsIGIsIGMsIGQsIGtbMF0sIDYsIC0xOTg2MzA4NDQpO1xuICAgICAgICBkID0gaWkoZCwgYSwgYiwgYywga1s3XSwgMTAsIDExMjY4OTE0MTUpO1xuICAgICAgICBjID0gaWkoYywgZCwgYSwgYiwga1sxNF0sIDE1LCAtMTQxNjM1NDkwNSk7XG4gICAgICAgIGIgPSBpaShiLCBjLCBkLCBhLCBrWzVdLCAyMSwgLTU3NDM0MDU1KTtcbiAgICAgICAgYSA9IGlpKGEsIGIsIGMsIGQsIGtbMTJdLCA2LCAxNzAwNDg1NTcxKTtcbiAgICAgICAgZCA9IGlpKGQsIGEsIGIsIGMsIGtbM10sIDEwLCAtMTg5NDk4NjYwNik7XG4gICAgICAgIGMgPSBpaShjLCBkLCBhLCBiLCBrWzEwXSwgMTUsIC0xMDUxNTIzKTtcbiAgICAgICAgYiA9IGlpKGIsIGMsIGQsIGEsIGtbMV0sIDIxLCAtMjA1NDkyMjc5OSk7XG4gICAgICAgIGEgPSBpaShhLCBiLCBjLCBkLCBrWzhdLCA2LCAxODczMzEzMzU5KTtcbiAgICAgICAgZCA9IGlpKGQsIGEsIGIsIGMsIGtbMTVdLCAxMCwgLTMwNjExNzQ0KTtcbiAgICAgICAgYyA9IGlpKGMsIGQsIGEsIGIsIGtbNl0sIDE1LCAtMTU2MDE5ODM4MCk7XG4gICAgICAgIGIgPSBpaShiLCBjLCBkLCBhLCBrWzEzXSwgMjEsIDEzMDkxNTE2NDkpO1xuICAgICAgICBhID0gaWkoYSwgYiwgYywgZCwga1s0XSwgNiwgLTE0NTUyMzA3MCk7XG4gICAgICAgIGQgPSBpaShkLCBhLCBiLCBjLCBrWzExXSwgMTAsIC0xMTIwMjEwMzc5KTtcbiAgICAgICAgYyA9IGlpKGMsIGQsIGEsIGIsIGtbMl0sIDE1LCA3MTg3ODcyNTkpO1xuICAgICAgICBiID0gaWkoYiwgYywgZCwgYSwga1s5XSwgMjEsIC0zNDM0ODU1NTEpO1xuXG4gICAgICAgIHhbMF0gPSBhZGQzMihhLCB4WzBdKTtcbiAgICAgICAgeFsxXSA9IGFkZDMyKGIsIHhbMV0pO1xuICAgICAgICB4WzJdID0gYWRkMzIoYywgeFsyXSk7XG4gICAgICAgIHhbM10gPSBhZGQzMihkLCB4WzNdKTtcbiAgICB9LFxuXG4gICAgLyogdGhlcmUgbmVlZHMgdG8gYmUgc3VwcG9ydCBmb3IgVW5pY29kZSBoZXJlLFxuICAgICAgICogdW5sZXNzIHdlIHByZXRlbmQgdGhhdCB3ZSBjYW4gcmVkZWZpbmUgdGhlIE1ELTVcbiAgICAgICAqIGFsZ29yaXRobSBmb3IgbXVsdGktYnl0ZSBjaGFyYWN0ZXJzIChwZXJoYXBzXG4gICAgICAgKiBieSBhZGRpbmcgZXZlcnkgZm91ciAxNi1iaXQgY2hhcmFjdGVycyBhbmRcbiAgICAgICAqIHNob3J0ZW5pbmcgdGhlIHN1bSB0byAzMiBiaXRzKS4gT3RoZXJ3aXNlXG4gICAgICAgKiBJIHN1Z2dlc3QgcGVyZm9ybWluZyBNRC01IGFzIGlmIGV2ZXJ5IGNoYXJhY3RlclxuICAgICAgICogd2FzIHR3byBieXRlcy0tZS5nLiwgMDA0MCAwMDI1ID0gQCUtLWJ1dCB0aGVuXG4gICAgICAgKiBob3cgd2lsbCBhbiBvcmRpbmFyeSBNRC01IHN1bSBiZSBtYXRjaGVkP1xuICAgICAgICogVGhlcmUgaXMgbm8gd2F5IHRvIHN0YW5kYXJkaXplIHRleHQgdG8gc29tZXRoaW5nXG4gICAgICAgKiBsaWtlIFVURi04IGJlZm9yZSB0cmFuc2Zvcm1hdGlvbjsgc3BlZWQgY29zdCBpc1xuICAgICAgICogdXR0ZXJseSBwcm9oaWJpdGl2ZS4gVGhlIEphdmFTY3JpcHQgc3RhbmRhcmRcbiAgICAgICAqIGl0c2VsZiBuZWVkcyB0byBsb29rIGF0IHRoaXM6IGl0IHNob3VsZCBzdGFydFxuICAgICAgICogcHJvdmlkaW5nIGFjY2VzcyB0byBzdHJpbmdzIGFzIHByZWZvcm1lZCBVVEYtOFxuICAgICAgICogOC1iaXQgdW5zaWduZWQgdmFsdWUgYXJyYXlzLlxuICAgICAgICovXG4gICAgbWQ1YmxrID0gZnVuY3Rpb24gKHMpIHtcbiAgICAgICAgdmFyIG1kNWJsa3MgPSBbXSxcbiAgICAgICAgICAgIGk7IC8qIEFuZHkgS2luZyBzYWlkIGRvIGl0IHRoaXMgd2F5LiAqL1xuXG4gICAgICAgIGZvciAoaSA9IDA7IGkgPCA2NDsgaSArPSA0KSB7XG4gICAgICAgICAgICBtZDVibGtzW2kgPj4gMl0gPSBzLmNoYXJDb2RlQXQoaSkgKyAocy5jaGFyQ29kZUF0KGkgKyAxKSA8PCA4KSArIChzLmNoYXJDb2RlQXQoaSArIDIpIDw8IDE2KSArIChzLmNoYXJDb2RlQXQoaSArIDMpIDw8IDI0KTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbWQ1YmxrcztcbiAgICB9LFxuXG4gICAgbWQ1YmxrX2FycmF5ID0gZnVuY3Rpb24gKGEpIHtcbiAgICAgICAgdmFyIG1kNWJsa3MgPSBbXSxcbiAgICAgICAgICAgIGk7IC8qIEFuZHkgS2luZyBzYWlkIGRvIGl0IHRoaXMgd2F5LiAqL1xuXG4gICAgICAgIGZvciAoaSA9IDA7IGkgPCA2NDsgaSArPSA0KSB7XG4gICAgICAgICAgICBtZDVibGtzW2kgPj4gMl0gPSBhW2ldICsgKGFbaSArIDFdIDw8IDgpICsgKGFbaSArIDJdIDw8IDE2KSArIChhW2kgKyAzXSA8PCAyNCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG1kNWJsa3M7XG4gICAgfSxcblxuICAgIG1kNTEgPSBmdW5jdGlvbiAocykge1xuICAgICAgICB2YXIgbiA9IHMubGVuZ3RoLFxuICAgICAgICAgICAgc3RhdGUgPSBbMTczMjU4NDE5MywgLTI3MTczMzg3OSwgLTE3MzI1ODQxOTQsIDI3MTczMzg3OF0sXG4gICAgICAgICAgICBpLFxuICAgICAgICAgICAgbGVuZ3RoLFxuICAgICAgICAgICAgdGFpbCxcbiAgICAgICAgICAgIHRtcCxcbiAgICAgICAgICAgIGxvLFxuICAgICAgICAgICAgaGk7XG5cbiAgICAgICAgZm9yIChpID0gNjQ7IGkgPD0gbjsgaSArPSA2NCkge1xuICAgICAgICAgICAgbWQ1Y3ljbGUoc3RhdGUsIG1kNWJsayhzLnN1YnN0cmluZyhpIC0gNjQsIGkpKSk7XG4gICAgICAgIH1cbiAgICAgICAgcyA9IHMuc3Vic3RyaW5nKGkgLSA2NCk7XG4gICAgICAgIGxlbmd0aCA9IHMubGVuZ3RoO1xuICAgICAgICB0YWlsID0gWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdO1xuICAgICAgICBmb3IgKGkgPSAwOyBpIDwgbGVuZ3RoOyBpICs9IDEpIHtcbiAgICAgICAgICAgIHRhaWxbaSA+PiAyXSB8PSBzLmNoYXJDb2RlQXQoaSkgPDwgKChpICUgNCkgPDwgMyk7XG4gICAgICAgIH1cbiAgICAgICAgdGFpbFtpID4+IDJdIHw9IDB4ODAgPDwgKChpICUgNCkgPDwgMyk7XG4gICAgICAgIGlmIChpID4gNTUpIHtcbiAgICAgICAgICAgIG1kNWN5Y2xlKHN0YXRlLCB0YWlsKTtcbiAgICAgICAgICAgIGZvciAoaSA9IDA7IGkgPCAxNjsgaSArPSAxKSB7XG4gICAgICAgICAgICAgICAgdGFpbFtpXSA9IDA7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBCZXdhcmUgdGhhdCB0aGUgZmluYWwgbGVuZ3RoIG1pZ2h0IG5vdCBmaXQgaW4gMzIgYml0cyBzbyB3ZSB0YWtlIGNhcmUgb2YgdGhhdFxuICAgICAgICB0bXAgPSBuICogODtcbiAgICAgICAgdG1wID0gdG1wLnRvU3RyaW5nKDE2KS5tYXRjaCgvKC4qPykoLnswLDh9KSQvKTtcbiAgICAgICAgbG8gPSBwYXJzZUludCh0bXBbMl0sIDE2KTtcbiAgICAgICAgaGkgPSBwYXJzZUludCh0bXBbMV0sIDE2KSB8fCAwO1xuXG4gICAgICAgIHRhaWxbMTRdID0gbG87XG4gICAgICAgIHRhaWxbMTVdID0gaGk7XG5cbiAgICAgICAgbWQ1Y3ljbGUoc3RhdGUsIHRhaWwpO1xuICAgICAgICByZXR1cm4gc3RhdGU7XG4gICAgfSxcblxuICAgIG1kNTFfYXJyYXkgPSBmdW5jdGlvbiAoYSkge1xuICAgICAgICB2YXIgbiA9IGEubGVuZ3RoLFxuICAgICAgICAgICAgc3RhdGUgPSBbMTczMjU4NDE5MywgLTI3MTczMzg3OSwgLTE3MzI1ODQxOTQsIDI3MTczMzg3OF0sXG4gICAgICAgICAgICBpLFxuICAgICAgICAgICAgbGVuZ3RoLFxuICAgICAgICAgICAgdGFpbCxcbiAgICAgICAgICAgIHRtcCxcbiAgICAgICAgICAgIGxvLFxuICAgICAgICAgICAgaGk7XG5cbiAgICAgICAgZm9yIChpID0gNjQ7IGkgPD0gbjsgaSArPSA2NCkge1xuICAgICAgICAgICAgbWQ1Y3ljbGUoc3RhdGUsIG1kNWJsa19hcnJheShhLnN1YmFycmF5KGkgLSA2NCwgaSkpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIE5vdCBzdXJlIGlmIGl0IGlzIGEgYnVnLCBob3dldmVyIElFMTAgd2lsbCBhbHdheXMgcHJvZHVjZSBhIHN1YiBhcnJheSBvZiBsZW5ndGggMVxuICAgICAgICAvLyBjb250YWluaW5nIHRoZSBsYXN0IGVsZW1lbnQgb2YgdGhlIHBhcmVudCBhcnJheSBpZiB0aGUgc3ViIGFycmF5IHNwZWNpZmllZCBzdGFydHNcbiAgICAgICAgLy8gYmV5b25kIHRoZSBsZW5ndGggb2YgdGhlIHBhcmVudCBhcnJheSAtIHdlaXJkLlxuICAgICAgICAvLyBodHRwczovL2Nvbm5lY3QubWljcm9zb2Z0LmNvbS9JRS9mZWVkYmFjay9kZXRhaWxzLzc3MTQ1Mi90eXBlZC1hcnJheS1zdWJhcnJheS1pc3N1ZVxuICAgICAgICBhID0gKGkgLSA2NCkgPCBuID8gYS5zdWJhcnJheShpIC0gNjQpIDogbmV3IFVpbnQ4QXJyYXkoMCk7XG5cbiAgICAgICAgbGVuZ3RoID0gYS5sZW5ndGg7XG4gICAgICAgIHRhaWwgPSBbMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMCwgMF07XG4gICAgICAgIGZvciAoaSA9IDA7IGkgPCBsZW5ndGg7IGkgKz0gMSkge1xuICAgICAgICAgICAgdGFpbFtpID4+IDJdIHw9IGFbaV0gPDwgKChpICUgNCkgPDwgMyk7XG4gICAgICAgIH1cblxuICAgICAgICB0YWlsW2kgPj4gMl0gfD0gMHg4MCA8PCAoKGkgJSA0KSA8PCAzKTtcbiAgICAgICAgaWYgKGkgPiA1NSkge1xuICAgICAgICAgICAgbWQ1Y3ljbGUoc3RhdGUsIHRhaWwpO1xuICAgICAgICAgICAgZm9yIChpID0gMDsgaSA8IDE2OyBpICs9IDEpIHtcbiAgICAgICAgICAgICAgICB0YWlsW2ldID0gMDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEJld2FyZSB0aGF0IHRoZSBmaW5hbCBsZW5ndGggbWlnaHQgbm90IGZpdCBpbiAzMiBiaXRzIHNvIHdlIHRha2UgY2FyZSBvZiB0aGF0XG4gICAgICAgIHRtcCA9IG4gKiA4O1xuICAgICAgICB0bXAgPSB0bXAudG9TdHJpbmcoMTYpLm1hdGNoKC8oLio/KSguezAsOH0pJC8pO1xuICAgICAgICBsbyA9IHBhcnNlSW50KHRtcFsyXSwgMTYpO1xuICAgICAgICBoaSA9IHBhcnNlSW50KHRtcFsxXSwgMTYpIHx8IDA7XG5cbiAgICAgICAgdGFpbFsxNF0gPSBsbztcbiAgICAgICAgdGFpbFsxNV0gPSBoaTtcblxuICAgICAgICBtZDVjeWNsZShzdGF0ZSwgdGFpbCk7XG5cbiAgICAgICAgcmV0dXJuIHN0YXRlO1xuICAgIH0sXG5cbiAgICBoZXhfY2hyID0gWycwJywgJzEnLCAnMicsICczJywgJzQnLCAnNScsICc2JywgJzcnLCAnOCcsICc5JywgJ2EnLCAnYicsICdjJywgJ2QnLCAnZScsICdmJ10sXG5cbiAgICByaGV4ID0gZnVuY3Rpb24gKG4pIHtcbiAgICAgICAgdmFyIHMgPSAnJyxcbiAgICAgICAgICAgIGo7XG4gICAgICAgIGZvciAoaiA9IDA7IGogPCA0OyBqICs9IDEpIHtcbiAgICAgICAgICAgIHMgKz0gaGV4X2NoclsobiA+PiAoaiAqIDggKyA0KSkgJiAweDBGXSArIGhleF9jaHJbKG4gPj4gKGogKiA4KSkgJiAweDBGXTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcztcbiAgICB9LFxuXG4gICAgaGV4ID0gZnVuY3Rpb24gKHgpIHtcbiAgICAgICAgdmFyIGk7XG4gICAgICAgIGZvciAoaSA9IDA7IGkgPCB4Lmxlbmd0aDsgaSArPSAxKSB7XG4gICAgICAgICAgICB4W2ldID0gcmhleCh4W2ldKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4geC5qb2luKCcnKTtcbiAgICB9LFxuXG4gICAgbWQ1ID0gZnVuY3Rpb24gKHMpIHtcbiAgICAgICAgcmV0dXJuIGhleChtZDUxKHMpKTtcbiAgICB9LFxuXG5cblxuICAgIC8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy9cblxuICAgIC8qKlxuICAgICAqIFNwYXJrTUQ1IE9PUCBpbXBsZW1lbnRhdGlvbi5cbiAgICAgKlxuICAgICAqIFVzZSB0aGlzIGNsYXNzIHRvIHBlcmZvcm0gYW4gaW5jcmVtZW50YWwgbWQ1LCBvdGhlcndpc2UgdXNlIHRoZVxuICAgICAqIHN0YXRpYyBtZXRob2RzIGluc3RlYWQuXG4gICAgICovXG4gICAgU3BhcmtNRDUgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIC8vIGNhbGwgcmVzZXQgdG8gaW5pdCB0aGUgaW5zdGFuY2VcbiAgICAgICAgdGhpcy5yZXNldCgpO1xuICAgIH07XG5cblxuICAgIC8vIEluIHNvbWUgY2FzZXMgdGhlIGZhc3QgYWRkMzIgZnVuY3Rpb24gY2Fubm90IGJlIHVzZWQuLlxuICAgIGlmIChtZDUoJ2hlbGxvJykgIT09ICc1ZDQxNDAyYWJjNGIyYTc2Yjk3MTlkOTExMDE3YzU5MicpIHtcbiAgICAgICAgYWRkMzIgPSBmdW5jdGlvbiAoeCwgeSkge1xuICAgICAgICAgICAgdmFyIGxzdyA9ICh4ICYgMHhGRkZGKSArICh5ICYgMHhGRkZGKSxcbiAgICAgICAgICAgICAgICBtc3cgPSAoeCA+PiAxNikgKyAoeSA+PiAxNikgKyAobHN3ID4+IDE2KTtcbiAgICAgICAgICAgIHJldHVybiAobXN3IDw8IDE2KSB8IChsc3cgJiAweEZGRkYpO1xuICAgICAgICB9O1xuICAgIH1cblxuXG4gICAgLyoqXG4gICAgICogQXBwZW5kcyBhIHN0cmluZy5cbiAgICAgKiBBIGNvbnZlcnNpb24gd2lsbCBiZSBhcHBsaWVkIGlmIGFuIHV0Zjggc3RyaW5nIGlzIGRldGVjdGVkLlxuICAgICAqXG4gICAgICogQHBhcmFtIHtTdHJpbmd9IHN0ciBUaGUgc3RyaW5nIHRvIGJlIGFwcGVuZGVkXG4gICAgICpcbiAgICAgKiBAcmV0dXJuIHtTcGFya01ENX0gVGhlIGluc3RhbmNlIGl0c2VsZlxuICAgICAqL1xuICAgIFNwYXJrTUQ1LnByb3RvdHlwZS5hcHBlbmQgPSBmdW5jdGlvbiAoc3RyKSB7XG4gICAgICAgIC8vIGNvbnZlcnRzIHRoZSBzdHJpbmcgdG8gdXRmOCBieXRlcyBpZiBuZWNlc3NhcnlcbiAgICAgICAgaWYgKC9bXFx1MDA4MC1cXHVGRkZGXS8udGVzdChzdHIpKSB7XG4gICAgICAgICAgICBzdHIgPSB1bmVzY2FwZShlbmNvZGVVUklDb21wb25lbnQoc3RyKSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyB0aGVuIGFwcGVuZCBhcyBiaW5hcnlcbiAgICAgICAgdGhpcy5hcHBlbmRCaW5hcnkoc3RyKTtcblxuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9O1xuXG4gICAgLyoqXG4gICAgICogQXBwZW5kcyBhIGJpbmFyeSBzdHJpbmcuXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge1N0cmluZ30gY29udGVudHMgVGhlIGJpbmFyeSBzdHJpbmcgdG8gYmUgYXBwZW5kZWRcbiAgICAgKlxuICAgICAqIEByZXR1cm4ge1NwYXJrTUQ1fSBUaGUgaW5zdGFuY2UgaXRzZWxmXG4gICAgICovXG4gICAgU3BhcmtNRDUucHJvdG90eXBlLmFwcGVuZEJpbmFyeSA9IGZ1bmN0aW9uIChjb250ZW50cykge1xuICAgICAgICB0aGlzLl9idWZmICs9IGNvbnRlbnRzO1xuICAgICAgICB0aGlzLl9sZW5ndGggKz0gY29udGVudHMubGVuZ3RoO1xuXG4gICAgICAgIHZhciBsZW5ndGggPSB0aGlzLl9idWZmLmxlbmd0aCxcbiAgICAgICAgICAgIGk7XG5cbiAgICAgICAgZm9yIChpID0gNjQ7IGkgPD0gbGVuZ3RoOyBpICs9IDY0KSB7XG4gICAgICAgICAgICBtZDVjeWNsZSh0aGlzLl9zdGF0ZSwgbWQ1YmxrKHRoaXMuX2J1ZmYuc3Vic3RyaW5nKGkgLSA2NCwgaSkpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuX2J1ZmYgPSB0aGlzLl9idWZmLnN1YnN0cihpIC0gNjQpO1xuXG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH07XG5cbiAgICAvKipcbiAgICAgKiBGaW5pc2hlcyB0aGUgaW5jcmVtZW50YWwgY29tcHV0YXRpb24sIHJlc2V0aW5nIHRoZSBpbnRlcm5hbCBzdGF0ZSBhbmRcbiAgICAgKiByZXR1cm5pbmcgdGhlIHJlc3VsdC5cbiAgICAgKiBVc2UgdGhlIHJhdyBwYXJhbWV0ZXIgdG8gb2J0YWluIHRoZSByYXcgcmVzdWx0IGluc3RlYWQgb2YgdGhlIGhleCBvbmUuXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge0Jvb2xlYW59IHJhdyBUcnVlIHRvIGdldCB0aGUgcmF3IHJlc3VsdCwgZmFsc2UgdG8gZ2V0IHRoZSBoZXggcmVzdWx0XG4gICAgICpcbiAgICAgKiBAcmV0dXJuIHtTdHJpbmd8QXJyYXl9IFRoZSByZXN1bHRcbiAgICAgKi9cbiAgICBTcGFya01ENS5wcm90b3R5cGUuZW5kID0gZnVuY3Rpb24gKHJhdykge1xuICAgICAgICB2YXIgYnVmZiA9IHRoaXMuX2J1ZmYsXG4gICAgICAgICAgICBsZW5ndGggPSBidWZmLmxlbmd0aCxcbiAgICAgICAgICAgIGksXG4gICAgICAgICAgICB0YWlsID0gWzAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDAsIDBdLFxuICAgICAgICAgICAgcmV0O1xuXG4gICAgICAgIGZvciAoaSA9IDA7IGkgPCBsZW5ndGg7IGkgKz0gMSkge1xuICAgICAgICAgICAgdGFpbFtpID4+IDJdIHw9IGJ1ZmYuY2hhckNvZGVBdChpKSA8PCAoKGkgJSA0KSA8PCAzKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuX2ZpbmlzaCh0YWlsLCBsZW5ndGgpO1xuICAgICAgICByZXQgPSAhIXJhdyA/IHRoaXMuX3N0YXRlIDogaGV4KHRoaXMuX3N0YXRlKTtcblxuICAgICAgICB0aGlzLnJlc2V0KCk7XG5cbiAgICAgICAgcmV0dXJuIHJldDtcbiAgICB9O1xuXG4gICAgLyoqXG4gICAgICogRmluaXNoIHRoZSBmaW5hbCBjYWxjdWxhdGlvbiBiYXNlZCBvbiB0aGUgdGFpbC5cbiAgICAgKlxuICAgICAqIEBwYXJhbSB7QXJyYXl9ICB0YWlsICAgVGhlIHRhaWwgKHdpbGwgYmUgbW9kaWZpZWQpXG4gICAgICogQHBhcmFtIHtOdW1iZXJ9IGxlbmd0aCBUaGUgbGVuZ3RoIG9mIHRoZSByZW1haW5pbmcgYnVmZmVyXG4gICAgICovXG4gICAgU3BhcmtNRDUucHJvdG90eXBlLl9maW5pc2ggPSBmdW5jdGlvbiAodGFpbCwgbGVuZ3RoKSB7XG4gICAgICAgIHZhciBpID0gbGVuZ3RoLFxuICAgICAgICAgICAgdG1wLFxuICAgICAgICAgICAgbG8sXG4gICAgICAgICAgICBoaTtcblxuICAgICAgICB0YWlsW2kgPj4gMl0gfD0gMHg4MCA8PCAoKGkgJSA0KSA8PCAzKTtcbiAgICAgICAgaWYgKGkgPiA1NSkge1xuICAgICAgICAgICAgbWQ1Y3ljbGUodGhpcy5fc3RhdGUsIHRhaWwpO1xuICAgICAgICAgICAgZm9yIChpID0gMDsgaSA8IDE2OyBpICs9IDEpIHtcbiAgICAgICAgICAgICAgICB0YWlsW2ldID0gMDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIERvIHRoZSBmaW5hbCBjb21wdXRhdGlvbiBiYXNlZCBvbiB0aGUgdGFpbCBhbmQgbGVuZ3RoXG4gICAgICAgIC8vIEJld2FyZSB0aGF0IHRoZSBmaW5hbCBsZW5ndGggbWF5IG5vdCBmaXQgaW4gMzIgYml0cyBzbyB3ZSB0YWtlIGNhcmUgb2YgdGhhdFxuICAgICAgICB0bXAgPSB0aGlzLl9sZW5ndGggKiA4O1xuICAgICAgICB0bXAgPSB0bXAudG9TdHJpbmcoMTYpLm1hdGNoKC8oLio/KSguezAsOH0pJC8pO1xuICAgICAgICBsbyA9IHBhcnNlSW50KHRtcFsyXSwgMTYpO1xuICAgICAgICBoaSA9IHBhcnNlSW50KHRtcFsxXSwgMTYpIHx8IDA7XG5cbiAgICAgICAgdGFpbFsxNF0gPSBsbztcbiAgICAgICAgdGFpbFsxNV0gPSBoaTtcbiAgICAgICAgbWQ1Y3ljbGUodGhpcy5fc3RhdGUsIHRhaWwpO1xuICAgIH07XG5cbiAgICAvKipcbiAgICAgKiBSZXNldHMgdGhlIGludGVybmFsIHN0YXRlIG9mIHRoZSBjb21wdXRhdGlvbi5cbiAgICAgKlxuICAgICAqIEByZXR1cm4ge1NwYXJrTUQ1fSBUaGUgaW5zdGFuY2UgaXRzZWxmXG4gICAgICovXG4gICAgU3BhcmtNRDUucHJvdG90eXBlLnJlc2V0ID0gZnVuY3Rpb24gKCkge1xuICAgICAgICB0aGlzLl9idWZmID0gXCJcIjtcbiAgICAgICAgdGhpcy5fbGVuZ3RoID0gMDtcbiAgICAgICAgdGhpcy5fc3RhdGUgPSBbMTczMjU4NDE5MywgLTI3MTczMzg3OSwgLTE3MzI1ODQxOTQsIDI3MTczMzg3OF07XG5cbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfTtcblxuICAgIC8qKlxuICAgICAqIFJlbGVhc2VzIG1lbW9yeSB1c2VkIGJ5IHRoZSBpbmNyZW1lbnRhbCBidWZmZXIgYW5kIG90aGVyIGFkaXRpb25hbFxuICAgICAqIHJlc291cmNlcy4gSWYgeW91IHBsYW4gdG8gdXNlIHRoZSBpbnN0YW5jZSBhZ2FpbiwgdXNlIHJlc2V0IGluc3RlYWQuXG4gICAgICovXG4gICAgU3BhcmtNRDUucHJvdG90eXBlLmRlc3Ryb3kgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIGRlbGV0ZSB0aGlzLl9zdGF0ZTtcbiAgICAgICAgZGVsZXRlIHRoaXMuX2J1ZmY7XG4gICAgICAgIGRlbGV0ZSB0aGlzLl9sZW5ndGg7XG4gICAgfTtcblxuXG4gICAgLyoqXG4gICAgICogUGVyZm9ybXMgdGhlIG1kNSBoYXNoIG9uIGEgc3RyaW5nLlxuICAgICAqIEEgY29udmVyc2lvbiB3aWxsIGJlIGFwcGxpZWQgaWYgdXRmOCBzdHJpbmcgaXMgZGV0ZWN0ZWQuXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge1N0cmluZ30gIHN0ciBUaGUgc3RyaW5nXG4gICAgICogQHBhcmFtIHtCb29sZWFufSByYXcgVHJ1ZSB0byBnZXQgdGhlIHJhdyByZXN1bHQsIGZhbHNlIHRvIGdldCB0aGUgaGV4IHJlc3VsdFxuICAgICAqXG4gICAgICogQHJldHVybiB7U3RyaW5nfEFycmF5fSBUaGUgcmVzdWx0XG4gICAgICovXG4gICAgU3BhcmtNRDUuaGFzaCA9IGZ1bmN0aW9uIChzdHIsIHJhdykge1xuICAgICAgICAvLyBjb252ZXJ0cyB0aGUgc3RyaW5nIHRvIHV0ZjggYnl0ZXMgaWYgbmVjZXNzYXJ5XG4gICAgICAgIGlmICgvW1xcdTAwODAtXFx1RkZGRl0vLnRlc3Qoc3RyKSkge1xuICAgICAgICAgICAgc3RyID0gdW5lc2NhcGUoZW5jb2RlVVJJQ29tcG9uZW50KHN0cikpO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIGhhc2ggPSBtZDUxKHN0cik7XG5cbiAgICAgICAgcmV0dXJuICEhcmF3ID8gaGFzaCA6IGhleChoYXNoKTtcbiAgICB9O1xuXG4gICAgLyoqXG4gICAgICogUGVyZm9ybXMgdGhlIG1kNSBoYXNoIG9uIGEgYmluYXJ5IHN0cmluZy5cbiAgICAgKlxuICAgICAqIEBwYXJhbSB7U3RyaW5nfSAgY29udGVudCBUaGUgYmluYXJ5IHN0cmluZ1xuICAgICAqIEBwYXJhbSB7Qm9vbGVhbn0gcmF3ICAgICBUcnVlIHRvIGdldCB0aGUgcmF3IHJlc3VsdCwgZmFsc2UgdG8gZ2V0IHRoZSBoZXggcmVzdWx0XG4gICAgICpcbiAgICAgKiBAcmV0dXJuIHtTdHJpbmd8QXJyYXl9IFRoZSByZXN1bHRcbiAgICAgKi9cbiAgICBTcGFya01ENS5oYXNoQmluYXJ5ID0gZnVuY3Rpb24gKGNvbnRlbnQsIHJhdykge1xuICAgICAgICB2YXIgaGFzaCA9IG1kNTEoY29udGVudCk7XG5cbiAgICAgICAgcmV0dXJuICEhcmF3ID8gaGFzaCA6IGhleChoYXNoKTtcbiAgICB9O1xuXG4gICAgLyoqXG4gICAgICogU3BhcmtNRDUgT09QIGltcGxlbWVudGF0aW9uIGZvciBhcnJheSBidWZmZXJzLlxuICAgICAqXG4gICAgICogVXNlIHRoaXMgY2xhc3MgdG8gcGVyZm9ybSBhbiBpbmNyZW1lbnRhbCBtZDUgT05MWSBmb3IgYXJyYXkgYnVmZmVycy5cbiAgICAgKi9cbiAgICBTcGFya01ENS5BcnJheUJ1ZmZlciA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgLy8gY2FsbCByZXNldCB0byBpbml0IHRoZSBpbnN0YW5jZVxuICAgICAgICB0aGlzLnJlc2V0KCk7XG4gICAgfTtcblxuICAgIC8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy9cblxuICAgIC8qKlxuICAgICAqIEFwcGVuZHMgYW4gYXJyYXkgYnVmZmVyLlxuICAgICAqXG4gICAgICogQHBhcmFtIHtBcnJheUJ1ZmZlcn0gYXJyIFRoZSBhcnJheSB0byBiZSBhcHBlbmRlZFxuICAgICAqXG4gICAgICogQHJldHVybiB7U3BhcmtNRDUuQXJyYXlCdWZmZXJ9IFRoZSBpbnN0YW5jZSBpdHNlbGZcbiAgICAgKi9cbiAgICBTcGFya01ENS5BcnJheUJ1ZmZlci5wcm90b3R5cGUuYXBwZW5kID0gZnVuY3Rpb24gKGFycikge1xuICAgICAgICAvLyBUT0RPOiB3ZSBjb3VsZCBhdm9pZCB0aGUgY29uY2F0ZW5hdGlvbiBoZXJlIGJ1dCB0aGUgYWxnb3JpdGhtIHdvdWxkIGJlIG1vcmUgY29tcGxleFxuICAgICAgICAvLyAgICAgICBpZiB5b3UgZmluZCB5b3Vyc2VsZiBuZWVkaW5nIGV4dHJhIHBlcmZvcm1hbmNlLCBwbGVhc2UgbWFrZSBhIFBSLlxuICAgICAgICB2YXIgYnVmZiA9IHRoaXMuX2NvbmNhdEFycmF5QnVmZmVyKHRoaXMuX2J1ZmYsIGFyciksXG4gICAgICAgICAgICBsZW5ndGggPSBidWZmLmxlbmd0aCxcbiAgICAgICAgICAgIGk7XG5cbiAgICAgICAgdGhpcy5fbGVuZ3RoICs9IGFyci5ieXRlTGVuZ3RoO1xuXG4gICAgICAgIGZvciAoaSA9IDY0OyBpIDw9IGxlbmd0aDsgaSArPSA2NCkge1xuICAgICAgICAgICAgbWQ1Y3ljbGUodGhpcy5fc3RhdGUsIG1kNWJsa19hcnJheShidWZmLnN1YmFycmF5KGkgLSA2NCwgaSkpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEF2b2lkcyBJRTEwIHdlaXJkbmVzcyAoZG9jdW1lbnRlZCBhYm92ZSlcbiAgICAgICAgdGhpcy5fYnVmZiA9IChpIC0gNjQpIDwgbGVuZ3RoID8gYnVmZi5zdWJhcnJheShpIC0gNjQpIDogbmV3IFVpbnQ4QXJyYXkoMCk7XG5cbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfTtcblxuICAgIC8qKlxuICAgICAqIEZpbmlzaGVzIHRoZSBpbmNyZW1lbnRhbCBjb21wdXRhdGlvbiwgcmVzZXRpbmcgdGhlIGludGVybmFsIHN0YXRlIGFuZFxuICAgICAqIHJldHVybmluZyB0aGUgcmVzdWx0LlxuICAgICAqIFVzZSB0aGUgcmF3IHBhcmFtZXRlciB0byBvYnRhaW4gdGhlIHJhdyByZXN1bHQgaW5zdGVhZCBvZiB0aGUgaGV4IG9uZS5cbiAgICAgKlxuICAgICAqIEBwYXJhbSB7Qm9vbGVhbn0gcmF3IFRydWUgdG8gZ2V0IHRoZSByYXcgcmVzdWx0LCBmYWxzZSB0byBnZXQgdGhlIGhleCByZXN1bHRcbiAgICAgKlxuICAgICAqIEByZXR1cm4ge1N0cmluZ3xBcnJheX0gVGhlIHJlc3VsdFxuICAgICAqL1xuICAgIFNwYXJrTUQ1LkFycmF5QnVmZmVyLnByb3RvdHlwZS5lbmQgPSBmdW5jdGlvbiAocmF3KSB7XG4gICAgICAgIHZhciBidWZmID0gdGhpcy5fYnVmZixcbiAgICAgICAgICAgIGxlbmd0aCA9IGJ1ZmYubGVuZ3RoLFxuICAgICAgICAgICAgdGFpbCA9IFswLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwLCAwXSxcbiAgICAgICAgICAgIGksXG4gICAgICAgICAgICByZXQ7XG5cbiAgICAgICAgZm9yIChpID0gMDsgaSA8IGxlbmd0aDsgaSArPSAxKSB7XG4gICAgICAgICAgICB0YWlsW2kgPj4gMl0gfD0gYnVmZltpXSA8PCAoKGkgJSA0KSA8PCAzKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuX2ZpbmlzaCh0YWlsLCBsZW5ndGgpO1xuICAgICAgICByZXQgPSAhIXJhdyA/IHRoaXMuX3N0YXRlIDogaGV4KHRoaXMuX3N0YXRlKTtcblxuICAgICAgICB0aGlzLnJlc2V0KCk7XG5cbiAgICAgICAgcmV0dXJuIHJldDtcbiAgICB9O1xuXG4gICAgU3BhcmtNRDUuQXJyYXlCdWZmZXIucHJvdG90eXBlLl9maW5pc2ggPSBTcGFya01ENS5wcm90b3R5cGUuX2ZpbmlzaDtcblxuICAgIC8qKlxuICAgICAqIFJlc2V0cyB0aGUgaW50ZXJuYWwgc3RhdGUgb2YgdGhlIGNvbXB1dGF0aW9uLlxuICAgICAqXG4gICAgICogQHJldHVybiB7U3BhcmtNRDUuQXJyYXlCdWZmZXJ9IFRoZSBpbnN0YW5jZSBpdHNlbGZcbiAgICAgKi9cbiAgICBTcGFya01ENS5BcnJheUJ1ZmZlci5wcm90b3R5cGUucmVzZXQgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRoaXMuX2J1ZmYgPSBuZXcgVWludDhBcnJheSgwKTtcbiAgICAgICAgdGhpcy5fbGVuZ3RoID0gMDtcbiAgICAgICAgdGhpcy5fc3RhdGUgPSBbMTczMjU4NDE5MywgLTI3MTczMzg3OSwgLTE3MzI1ODQxOTQsIDI3MTczMzg3OF07XG5cbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfTtcblxuICAgIC8qKlxuICAgICAqIFJlbGVhc2VzIG1lbW9yeSB1c2VkIGJ5IHRoZSBpbmNyZW1lbnRhbCBidWZmZXIgYW5kIG90aGVyIGFkaXRpb25hbFxuICAgICAqIHJlc291cmNlcy4gSWYgeW91IHBsYW4gdG8gdXNlIHRoZSBpbnN0YW5jZSBhZ2FpbiwgdXNlIHJlc2V0IGluc3RlYWQuXG4gICAgICovXG4gICAgU3BhcmtNRDUuQXJyYXlCdWZmZXIucHJvdG90eXBlLmRlc3Ryb3kgPSBTcGFya01ENS5wcm90b3R5cGUuZGVzdHJveTtcblxuICAgIC8qKlxuICAgICAqIENvbmNhdHMgdHdvIGFycmF5IGJ1ZmZlcnMsIHJldHVybmluZyBhIG5ldyBvbmUuXG4gICAgICpcbiAgICAgKiBAcGFyYW0gIHtBcnJheUJ1ZmZlcn0gZmlyc3QgIFRoZSBmaXJzdCBhcnJheSBidWZmZXJcbiAgICAgKiBAcGFyYW0gIHtBcnJheUJ1ZmZlcn0gc2Vjb25kIFRoZSBzZWNvbmQgYXJyYXkgYnVmZmVyXG4gICAgICpcbiAgICAgKiBAcmV0dXJuIHtBcnJheUJ1ZmZlcn0gVGhlIG5ldyBhcnJheSBidWZmZXJcbiAgICAgKi9cbiAgICBTcGFya01ENS5BcnJheUJ1ZmZlci5wcm90b3R5cGUuX2NvbmNhdEFycmF5QnVmZmVyID0gZnVuY3Rpb24gKGZpcnN0LCBzZWNvbmQpIHtcbiAgICAgICAgdmFyIGZpcnN0TGVuZ3RoID0gZmlyc3QubGVuZ3RoLFxuICAgICAgICAgICAgcmVzdWx0ID0gbmV3IFVpbnQ4QXJyYXkoZmlyc3RMZW5ndGggKyBzZWNvbmQuYnl0ZUxlbmd0aCk7XG5cbiAgICAgICAgcmVzdWx0LnNldChmaXJzdCk7XG4gICAgICAgIHJlc3VsdC5zZXQobmV3IFVpbnQ4QXJyYXkoc2Vjb25kKSwgZmlyc3RMZW5ndGgpO1xuXG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfTtcblxuICAgIC8qKlxuICAgICAqIFBlcmZvcm1zIHRoZSBtZDUgaGFzaCBvbiBhbiBhcnJheSBidWZmZXIuXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge0FycmF5QnVmZmVyfSBhcnIgVGhlIGFycmF5IGJ1ZmZlclxuICAgICAqIEBwYXJhbSB7Qm9vbGVhbn0gICAgIHJhdyBUcnVlIHRvIGdldCB0aGUgcmF3IHJlc3VsdCwgZmFsc2UgdG8gZ2V0IHRoZSBoZXggcmVzdWx0XG4gICAgICpcbiAgICAgKiBAcmV0dXJuIHtTdHJpbmd8QXJyYXl9IFRoZSByZXN1bHRcbiAgICAgKi9cbiAgICBTcGFya01ENS5BcnJheUJ1ZmZlci5oYXNoID0gZnVuY3Rpb24gKGFyciwgcmF3KSB7XG4gICAgICAgIHZhciBoYXNoID0gbWQ1MV9hcnJheShuZXcgVWludDhBcnJheShhcnIpKTtcblxuICAgICAgICByZXR1cm4gISFyYXcgPyBoYXNoIDogaGV4KGhhc2gpO1xuICAgIH07XG5cbiAgICByZXR1cm4gU3BhcmtNRDU7XG59KSk7XG4iLCIndXNlIHN0cmljdCc7XG5cbi8qKlxuICogU3RyaW5naWZ5L3BhcnNlIGZ1bmN0aW9ucyB0aGF0IGRvbid0IG9wZXJhdGVcbiAqIHJlY3Vyc2l2ZWx5LCBzbyB0aGV5IGF2b2lkIGNhbGwgc3RhY2sgZXhjZWVkZWRcbiAqIGVycm9ycy5cbiAqL1xuZXhwb3J0cy5zdHJpbmdpZnkgPSBmdW5jdGlvbiBzdHJpbmdpZnkoaW5wdXQpIHtcbiAgdmFyIHF1ZXVlID0gW107XG4gIHF1ZXVlLnB1c2goe29iajogaW5wdXR9KTtcblxuICB2YXIgcmVzID0gJyc7XG4gIHZhciBuZXh0LCBvYmosIHByZWZpeCwgdmFsLCBpLCBhcnJheVByZWZpeCwga2V5cywgaywga2V5LCB2YWx1ZSwgb2JqUHJlZml4O1xuICB3aGlsZSAoKG5leHQgPSBxdWV1ZS5wb3AoKSkpIHtcbiAgICBvYmogPSBuZXh0Lm9iajtcbiAgICBwcmVmaXggPSBuZXh0LnByZWZpeCB8fCAnJztcbiAgICB2YWwgPSBuZXh0LnZhbCB8fCAnJztcbiAgICByZXMgKz0gcHJlZml4O1xuICAgIGlmICh2YWwpIHtcbiAgICAgIHJlcyArPSB2YWw7XG4gICAgfSBlbHNlIGlmICh0eXBlb2Ygb2JqICE9PSAnb2JqZWN0Jykge1xuICAgICAgcmVzICs9IHR5cGVvZiBvYmogPT09ICd1bmRlZmluZWQnID8gbnVsbCA6IEpTT04uc3RyaW5naWZ5KG9iaik7XG4gICAgfSBlbHNlIGlmIChvYmogPT09IG51bGwpIHtcbiAgICAgIHJlcyArPSAnbnVsbCc7XG4gICAgfSBlbHNlIGlmIChBcnJheS5pc0FycmF5KG9iaikpIHtcbiAgICAgIHF1ZXVlLnB1c2goe3ZhbDogJ10nfSk7XG4gICAgICBmb3IgKGkgPSBvYmoubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHtcbiAgICAgICAgYXJyYXlQcmVmaXggPSBpID09PSAwID8gJycgOiAnLCc7XG4gICAgICAgIHF1ZXVlLnB1c2goe29iajogb2JqW2ldLCBwcmVmaXg6IGFycmF5UHJlZml4fSk7XG4gICAgICB9XG4gICAgICBxdWV1ZS5wdXNoKHt2YWw6ICdbJ30pO1xuICAgIH0gZWxzZSB7IC8vIG9iamVjdFxuICAgICAga2V5cyA9IFtdO1xuICAgICAgZm9yIChrIGluIG9iaikge1xuICAgICAgICBpZiAob2JqLmhhc093blByb3BlcnR5KGspKSB7XG4gICAgICAgICAga2V5cy5wdXNoKGspO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBxdWV1ZS5wdXNoKHt2YWw6ICd9J30pO1xuICAgICAgZm9yIChpID0ga2V5cy5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgICAgICBrZXkgPSBrZXlzW2ldO1xuICAgICAgICB2YWx1ZSA9IG9ialtrZXldO1xuICAgICAgICBvYmpQcmVmaXggPSAoaSA+IDAgPyAnLCcgOiAnJyk7XG4gICAgICAgIG9ialByZWZpeCArPSBKU09OLnN0cmluZ2lmeShrZXkpICsgJzonO1xuICAgICAgICBxdWV1ZS5wdXNoKHtvYmo6IHZhbHVlLCBwcmVmaXg6IG9ialByZWZpeH0pO1xuICAgICAgfVxuICAgICAgcXVldWUucHVzaCh7dmFsOiAneyd9KTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHJlcztcbn07XG5cbi8vIENvbnZlbmllbmNlIGZ1bmN0aW9uIGZvciB0aGUgcGFyc2UgZnVuY3Rpb24uXG4vLyBUaGlzIHBvcCBmdW5jdGlvbiBpcyBiYXNpY2FsbHkgY29waWVkIGZyb21cbi8vIHBvdWNoQ29sbGF0ZS5wYXJzZUluZGV4YWJsZVN0cmluZ1xuZnVuY3Rpb24gcG9wKG9iaiwgc3RhY2ssIG1ldGFTdGFjaykge1xuICB2YXIgbGFzdE1ldGFFbGVtZW50ID0gbWV0YVN0YWNrW21ldGFTdGFjay5sZW5ndGggLSAxXTtcbiAgaWYgKG9iaiA9PT0gbGFzdE1ldGFFbGVtZW50LmVsZW1lbnQpIHtcbiAgICAvLyBwb3BwaW5nIGEgbWV0YS1lbGVtZW50LCBlLmcuIGFuIG9iamVjdCB3aG9zZSB2YWx1ZSBpcyBhbm90aGVyIG9iamVjdFxuICAgIG1ldGFTdGFjay5wb3AoKTtcbiAgICBsYXN0TWV0YUVsZW1lbnQgPSBtZXRhU3RhY2tbbWV0YVN0YWNrLmxlbmd0aCAtIDFdO1xuICB9XG4gIHZhciBlbGVtZW50ID0gbGFzdE1ldGFFbGVtZW50LmVsZW1lbnQ7XG4gIHZhciBsYXN0RWxlbWVudEluZGV4ID0gbGFzdE1ldGFFbGVtZW50LmluZGV4O1xuICBpZiAoQXJyYXkuaXNBcnJheShlbGVtZW50KSkge1xuICAgIGVsZW1lbnQucHVzaChvYmopO1xuICB9IGVsc2UgaWYgKGxhc3RFbGVtZW50SW5kZXggPT09IHN0YWNrLmxlbmd0aCAtIDIpIHsgLy8gb2JqIHdpdGgga2V5K3ZhbHVlXG4gICAgdmFyIGtleSA9IHN0YWNrLnBvcCgpO1xuICAgIGVsZW1lbnRba2V5XSA9IG9iajtcbiAgfSBlbHNlIHtcbiAgICBzdGFjay5wdXNoKG9iaik7IC8vIG9iaiB3aXRoIGtleSBvbmx5XG4gIH1cbn1cblxuZXhwb3J0cy5wYXJzZSA9IGZ1bmN0aW9uIChzdHIpIHtcbiAgdmFyIHN0YWNrID0gW107XG4gIHZhciBtZXRhU3RhY2sgPSBbXTsgLy8gc3RhY2sgZm9yIGFycmF5cyBhbmQgb2JqZWN0c1xuICB2YXIgaSA9IDA7XG4gIHZhciBjb2xsYXRpb25JbmRleCxwYXJzZWROdW0sbnVtQ2hhcjtcbiAgdmFyIHBhcnNlZFN0cmluZyxsYXN0Q2gsbnVtQ29uc2VjdXRpdmVTbGFzaGVzLGNoO1xuICB2YXIgYXJyYXlFbGVtZW50LCBvYmpFbGVtZW50O1xuICB3aGlsZSAodHJ1ZSkge1xuICAgIGNvbGxhdGlvbkluZGV4ID0gc3RyW2krK107XG4gICAgaWYgKGNvbGxhdGlvbkluZGV4ID09PSAnfScgfHxcbiAgICAgICAgY29sbGF0aW9uSW5kZXggPT09ICddJyB8fFxuICAgICAgICB0eXBlb2YgY29sbGF0aW9uSW5kZXggPT09ICd1bmRlZmluZWQnKSB7XG4gICAgICBpZiAoc3RhY2subGVuZ3RoID09PSAxKSB7XG4gICAgICAgIHJldHVybiBzdGFjay5wb3AoKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHBvcChzdGFjay5wb3AoKSwgc3RhY2ssIG1ldGFTdGFjayk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgIH1cbiAgICBzd2l0Y2ggKGNvbGxhdGlvbkluZGV4KSB7XG4gICAgICBjYXNlICcgJzpcbiAgICAgIGNhc2UgJ1xcdCc6XG4gICAgICBjYXNlICdcXG4nOlxuICAgICAgY2FzZSAnOic6XG4gICAgICBjYXNlICcsJzpcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICduJzpcbiAgICAgICAgaSArPSAzOyAvLyAndWxsJ1xuICAgICAgICBwb3AobnVsbCwgc3RhY2ssIG1ldGFTdGFjayk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAndCc6XG4gICAgICAgIGkgKz0gMzsgLy8gJ3J1ZSdcbiAgICAgICAgcG9wKHRydWUsIHN0YWNrLCBtZXRhU3RhY2spO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ2YnOlxuICAgICAgICBpICs9IDQ7IC8vICdhbHNlJ1xuICAgICAgICBwb3AoZmFsc2UsIHN0YWNrLCBtZXRhU3RhY2spO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJzAnOlxuICAgICAgY2FzZSAnMSc6XG4gICAgICBjYXNlICcyJzpcbiAgICAgIGNhc2UgJzMnOlxuICAgICAgY2FzZSAnNCc6XG4gICAgICBjYXNlICc1JzpcbiAgICAgIGNhc2UgJzYnOlxuICAgICAgY2FzZSAnNyc6XG4gICAgICBjYXNlICc4JzpcbiAgICAgIGNhc2UgJzknOlxuICAgICAgY2FzZSAnLSc6XG4gICAgICAgIHBhcnNlZE51bSA9ICcnO1xuICAgICAgICBpLS07XG4gICAgICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICAgICAgbnVtQ2hhciA9IHN0cltpKytdO1xuICAgICAgICAgIGlmICgvW1xcZFxcLlxcLWVcXCtdLy50ZXN0KG51bUNoYXIpKSB7XG4gICAgICAgICAgICBwYXJzZWROdW0gKz0gbnVtQ2hhcjtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgaS0tO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHBvcChwYXJzZUZsb2F0KHBhcnNlZE51bSksIHN0YWNrLCBtZXRhU3RhY2spO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ1wiJzpcbiAgICAgICAgcGFyc2VkU3RyaW5nID0gJyc7XG4gICAgICAgIGxhc3RDaCA9IHZvaWQgMDtcbiAgICAgICAgbnVtQ29uc2VjdXRpdmVTbGFzaGVzID0gMDtcbiAgICAgICAgd2hpbGUgKHRydWUpIHtcbiAgICAgICAgICBjaCA9IHN0cltpKytdO1xuICAgICAgICAgIGlmIChjaCAhPT0gJ1wiJyB8fCAobGFzdENoID09PSAnXFxcXCcgJiZcbiAgICAgICAgICAgICAgbnVtQ29uc2VjdXRpdmVTbGFzaGVzICUgMiA9PT0gMSkpIHtcbiAgICAgICAgICAgIHBhcnNlZFN0cmluZyArPSBjaDtcbiAgICAgICAgICAgIGxhc3RDaCA9IGNoO1xuICAgICAgICAgICAgaWYgKGxhc3RDaCA9PT0gJ1xcXFwnKSB7XG4gICAgICAgICAgICAgIG51bUNvbnNlY3V0aXZlU2xhc2hlcysrO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgbnVtQ29uc2VjdXRpdmVTbGFzaGVzID0gMDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHBvcChKU09OLnBhcnNlKCdcIicgKyBwYXJzZWRTdHJpbmcgKyAnXCInKSwgc3RhY2ssIG1ldGFTdGFjayk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnWyc6XG4gICAgICAgIGFycmF5RWxlbWVudCA9IHsgZWxlbWVudDogW10sIGluZGV4OiBzdGFjay5sZW5ndGggfTtcbiAgICAgICAgc3RhY2sucHVzaChhcnJheUVsZW1lbnQuZWxlbWVudCk7XG4gICAgICAgIG1ldGFTdGFjay5wdXNoKGFycmF5RWxlbWVudCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAneyc6XG4gICAgICAgIG9iakVsZW1lbnQgPSB7IGVsZW1lbnQ6IHt9LCBpbmRleDogc3RhY2subGVuZ3RoIH07XG4gICAgICAgIHN0YWNrLnB1c2gob2JqRWxlbWVudC5lbGVtZW50KTtcbiAgICAgICAgbWV0YVN0YWNrLnB1c2gob2JqRWxlbWVudCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAgICd1bmV4cGVjdGVkbHkgcmVhY2hlZCBlbmQgb2YgaW5wdXQ6ICcgKyBjb2xsYXRpb25JbmRleCk7XG4gICAgfVxuICB9XG59O1xuIixudWxsLCIvLyBDb3B5cmlnaHQgSm95ZW50LCBJbmMuIGFuZCBvdGhlciBOb2RlIGNvbnRyaWJ1dG9ycy5cbi8vXG4vLyBQZXJtaXNzaW9uIGlzIGhlcmVieSBncmFudGVkLCBmcmVlIG9mIGNoYXJnZSwgdG8gYW55IHBlcnNvbiBvYnRhaW5pbmcgYVxuLy8gY29weSBvZiB0aGlzIHNvZnR3YXJlIGFuZCBhc3NvY2lhdGVkIGRvY3VtZW50YXRpb24gZmlsZXMgKHRoZVxuLy8gXCJTb2Z0d2FyZVwiKSwgdG8gZGVhbCBpbiB0aGUgU29mdHdhcmUgd2l0aG91dCByZXN0cmljdGlvbiwgaW5jbHVkaW5nXG4vLyB3aXRob3V0IGxpbWl0YXRpb24gdGhlIHJpZ2h0cyB0byB1c2UsIGNvcHksIG1vZGlmeSwgbWVyZ2UsIHB1Ymxpc2gsXG4vLyBkaXN0cmlidXRlLCBzdWJsaWNlbnNlLCBhbmQvb3Igc2VsbCBjb3BpZXMgb2YgdGhlIFNvZnR3YXJlLCBhbmQgdG8gcGVybWl0XG4vLyBwZXJzb25zIHRvIHdob20gdGhlIFNvZnR3YXJlIGlzIGZ1cm5pc2hlZCB0byBkbyBzbywgc3ViamVjdCB0byB0aGVcbi8vIGZvbGxvd2luZyBjb25kaXRpb25zOlxuLy9cbi8vIFRoZSBhYm92ZSBjb3B5cmlnaHQgbm90aWNlIGFuZCB0aGlzIHBlcm1pc3Npb24gbm90aWNlIHNoYWxsIGJlIGluY2x1ZGVkXG4vLyBpbiBhbGwgY29waWVzIG9yIHN1YnN0YW50aWFsIHBvcnRpb25zIG9mIHRoZSBTb2Z0d2FyZS5cbi8vXG4vLyBUSEUgU09GVFdBUkUgSVMgUFJPVklERUQgXCJBUyBJU1wiLCBXSVRIT1VUIFdBUlJBTlRZIE9GIEFOWSBLSU5ELCBFWFBSRVNTXG4vLyBPUiBJTVBMSUVELCBJTkNMVURJTkcgQlVUIE5PVCBMSU1JVEVEIFRPIFRIRSBXQVJSQU5USUVTIE9GXG4vLyBNRVJDSEFOVEFCSUxJVFksIEZJVE5FU1MgRk9SIEEgUEFSVElDVUxBUiBQVVJQT1NFIEFORCBOT05JTkZSSU5HRU1FTlQuIElOXG4vLyBOTyBFVkVOVCBTSEFMTCBUSEUgQVVUSE9SUyBPUiBDT1BZUklHSFQgSE9MREVSUyBCRSBMSUFCTEUgRk9SIEFOWSBDTEFJTSxcbi8vIERBTUFHRVMgT1IgT1RIRVIgTElBQklMSVRZLCBXSEVUSEVSIElOIEFOIEFDVElPTiBPRiBDT05UUkFDVCwgVE9SVCBPUlxuLy8gT1RIRVJXSVNFLCBBUklTSU5HIEZST00sIE9VVCBPRiBPUiBJTiBDT05ORUNUSU9OIFdJVEggVEhFIFNPRlRXQVJFIE9SIFRIRVxuLy8gVVNFIE9SIE9USEVSIERFQUxJTkdTIElOIFRIRSBTT0ZUV0FSRS5cblxuZnVuY3Rpb24gRXZlbnRFbWl0dGVyKCkge1xuICB0aGlzLl9ldmVudHMgPSB0aGlzLl9ldmVudHMgfHwge307XG4gIHRoaXMuX21heExpc3RlbmVycyA9IHRoaXMuX21heExpc3RlbmVycyB8fCB1bmRlZmluZWQ7XG59XG5tb2R1bGUuZXhwb3J0cyA9IEV2ZW50RW1pdHRlcjtcblxuLy8gQmFja3dhcmRzLWNvbXBhdCB3aXRoIG5vZGUgMC4xMC54XG5FdmVudEVtaXR0ZXIuRXZlbnRFbWl0dGVyID0gRXZlbnRFbWl0dGVyO1xuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLl9ldmVudHMgPSB1bmRlZmluZWQ7XG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLl9tYXhMaXN0ZW5lcnMgPSB1bmRlZmluZWQ7XG5cbi8vIEJ5IGRlZmF1bHQgRXZlbnRFbWl0dGVycyB3aWxsIHByaW50IGEgd2FybmluZyBpZiBtb3JlIHRoYW4gMTAgbGlzdGVuZXJzIGFyZVxuLy8gYWRkZWQgdG8gaXQuIFRoaXMgaXMgYSB1c2VmdWwgZGVmYXVsdCB3aGljaCBoZWxwcyBmaW5kaW5nIG1lbW9yeSBsZWFrcy5cbkV2ZW50RW1pdHRlci5kZWZhdWx0TWF4TGlzdGVuZXJzID0gMTA7XG5cbi8vIE9idmlvdXNseSBub3QgYWxsIEVtaXR0ZXJzIHNob3VsZCBiZSBsaW1pdGVkIHRvIDEwLiBUaGlzIGZ1bmN0aW9uIGFsbG93c1xuLy8gdGhhdCB0byBiZSBpbmNyZWFzZWQuIFNldCB0byB6ZXJvIGZvciB1bmxpbWl0ZWQuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLnNldE1heExpc3RlbmVycyA9IGZ1bmN0aW9uKG4pIHtcbiAgaWYgKCFpc051bWJlcihuKSB8fCBuIDwgMCB8fCBpc05hTihuKSlcbiAgICB0aHJvdyBUeXBlRXJyb3IoJ24gbXVzdCBiZSBhIHBvc2l0aXZlIG51bWJlcicpO1xuICB0aGlzLl9tYXhMaXN0ZW5lcnMgPSBuO1xuICByZXR1cm4gdGhpcztcbn07XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUuZW1pdCA9IGZ1bmN0aW9uKHR5cGUpIHtcbiAgdmFyIGVyLCBoYW5kbGVyLCBsZW4sIGFyZ3MsIGksIGxpc3RlbmVycztcblxuICBpZiAoIXRoaXMuX2V2ZW50cylcbiAgICB0aGlzLl9ldmVudHMgPSB7fTtcblxuICAvLyBJZiB0aGVyZSBpcyBubyAnZXJyb3InIGV2ZW50IGxpc3RlbmVyIHRoZW4gdGhyb3cuXG4gIGlmICh0eXBlID09PSAnZXJyb3InKSB7XG4gICAgaWYgKCF0aGlzLl9ldmVudHMuZXJyb3IgfHxcbiAgICAgICAgKGlzT2JqZWN0KHRoaXMuX2V2ZW50cy5lcnJvcikgJiYgIXRoaXMuX2V2ZW50cy5lcnJvci5sZW5ndGgpKSB7XG4gICAgICBlciA9IGFyZ3VtZW50c1sxXTtcbiAgICAgIGlmIChlciBpbnN0YW5jZW9mIEVycm9yKSB7XG4gICAgICAgIHRocm93IGVyOyAvLyBVbmhhbmRsZWQgJ2Vycm9yJyBldmVudFxuICAgICAgfVxuICAgICAgdGhyb3cgVHlwZUVycm9yKCdVbmNhdWdodCwgdW5zcGVjaWZpZWQgXCJlcnJvclwiIGV2ZW50LicpO1xuICAgIH1cbiAgfVxuXG4gIGhhbmRsZXIgPSB0aGlzLl9ldmVudHNbdHlwZV07XG5cbiAgaWYgKGlzVW5kZWZpbmVkKGhhbmRsZXIpKVxuICAgIHJldHVybiBmYWxzZTtcblxuICBpZiAoaXNGdW5jdGlvbihoYW5kbGVyKSkge1xuICAgIHN3aXRjaCAoYXJndW1lbnRzLmxlbmd0aCkge1xuICAgICAgLy8gZmFzdCBjYXNlc1xuICAgICAgY2FzZSAxOlxuICAgICAgICBoYW5kbGVyLmNhbGwodGhpcyk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAyOlxuICAgICAgICBoYW5kbGVyLmNhbGwodGhpcywgYXJndW1lbnRzWzFdKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlIDM6XG4gICAgICAgIGhhbmRsZXIuY2FsbCh0aGlzLCBhcmd1bWVudHNbMV0sIGFyZ3VtZW50c1syXSk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgLy8gc2xvd2VyXG4gICAgICBkZWZhdWx0OlxuICAgICAgICBsZW4gPSBhcmd1bWVudHMubGVuZ3RoO1xuICAgICAgICBhcmdzID0gbmV3IEFycmF5KGxlbiAtIDEpO1xuICAgICAgICBmb3IgKGkgPSAxOyBpIDwgbGVuOyBpKyspXG4gICAgICAgICAgYXJnc1tpIC0gMV0gPSBhcmd1bWVudHNbaV07XG4gICAgICAgIGhhbmRsZXIuYXBwbHkodGhpcywgYXJncyk7XG4gICAgfVxuICB9IGVsc2UgaWYgKGlzT2JqZWN0KGhhbmRsZXIpKSB7XG4gICAgbGVuID0gYXJndW1lbnRzLmxlbmd0aDtcbiAgICBhcmdzID0gbmV3IEFycmF5KGxlbiAtIDEpO1xuICAgIGZvciAoaSA9IDE7IGkgPCBsZW47IGkrKylcbiAgICAgIGFyZ3NbaSAtIDFdID0gYXJndW1lbnRzW2ldO1xuXG4gICAgbGlzdGVuZXJzID0gaGFuZGxlci5zbGljZSgpO1xuICAgIGxlbiA9IGxpc3RlbmVycy5sZW5ndGg7XG4gICAgZm9yIChpID0gMDsgaSA8IGxlbjsgaSsrKVxuICAgICAgbGlzdGVuZXJzW2ldLmFwcGx5KHRoaXMsIGFyZ3MpO1xuICB9XG5cbiAgcmV0dXJuIHRydWU7XG59O1xuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLmFkZExpc3RlbmVyID0gZnVuY3Rpb24odHlwZSwgbGlzdGVuZXIpIHtcbiAgdmFyIG07XG5cbiAgaWYgKCFpc0Z1bmN0aW9uKGxpc3RlbmVyKSlcbiAgICB0aHJvdyBUeXBlRXJyb3IoJ2xpc3RlbmVyIG11c3QgYmUgYSBmdW5jdGlvbicpO1xuXG4gIGlmICghdGhpcy5fZXZlbnRzKVxuICAgIHRoaXMuX2V2ZW50cyA9IHt9O1xuXG4gIC8vIFRvIGF2b2lkIHJlY3Vyc2lvbiBpbiB0aGUgY2FzZSB0aGF0IHR5cGUgPT09IFwibmV3TGlzdGVuZXJcIiEgQmVmb3JlXG4gIC8vIGFkZGluZyBpdCB0byB0aGUgbGlzdGVuZXJzLCBmaXJzdCBlbWl0IFwibmV3TGlzdGVuZXJcIi5cbiAgaWYgKHRoaXMuX2V2ZW50cy5uZXdMaXN0ZW5lcilcbiAgICB0aGlzLmVtaXQoJ25ld0xpc3RlbmVyJywgdHlwZSxcbiAgICAgICAgICAgICAgaXNGdW5jdGlvbihsaXN0ZW5lci5saXN0ZW5lcikgP1xuICAgICAgICAgICAgICBsaXN0ZW5lci5saXN0ZW5lciA6IGxpc3RlbmVyKTtcblxuICBpZiAoIXRoaXMuX2V2ZW50c1t0eXBlXSlcbiAgICAvLyBPcHRpbWl6ZSB0aGUgY2FzZSBvZiBvbmUgbGlzdGVuZXIuIERvbid0IG5lZWQgdGhlIGV4dHJhIGFycmF5IG9iamVjdC5cbiAgICB0aGlzLl9ldmVudHNbdHlwZV0gPSBsaXN0ZW5lcjtcbiAgZWxzZSBpZiAoaXNPYmplY3QodGhpcy5fZXZlbnRzW3R5cGVdKSlcbiAgICAvLyBJZiB3ZSd2ZSBhbHJlYWR5IGdvdCBhbiBhcnJheSwganVzdCBhcHBlbmQuXG4gICAgdGhpcy5fZXZlbnRzW3R5cGVdLnB1c2gobGlzdGVuZXIpO1xuICBlbHNlXG4gICAgLy8gQWRkaW5nIHRoZSBzZWNvbmQgZWxlbWVudCwgbmVlZCB0byBjaGFuZ2UgdG8gYXJyYXkuXG4gICAgdGhpcy5fZXZlbnRzW3R5cGVdID0gW3RoaXMuX2V2ZW50c1t0eXBlXSwgbGlzdGVuZXJdO1xuXG4gIC8vIENoZWNrIGZvciBsaXN0ZW5lciBsZWFrXG4gIGlmIChpc09iamVjdCh0aGlzLl9ldmVudHNbdHlwZV0pICYmICF0aGlzLl9ldmVudHNbdHlwZV0ud2FybmVkKSB7XG4gICAgdmFyIG07XG4gICAgaWYgKCFpc1VuZGVmaW5lZCh0aGlzLl9tYXhMaXN0ZW5lcnMpKSB7XG4gICAgICBtID0gdGhpcy5fbWF4TGlzdGVuZXJzO1xuICAgIH0gZWxzZSB7XG4gICAgICBtID0gRXZlbnRFbWl0dGVyLmRlZmF1bHRNYXhMaXN0ZW5lcnM7XG4gICAgfVxuXG4gICAgaWYgKG0gJiYgbSA+IDAgJiYgdGhpcy5fZXZlbnRzW3R5cGVdLmxlbmd0aCA+IG0pIHtcbiAgICAgIHRoaXMuX2V2ZW50c1t0eXBlXS53YXJuZWQgPSB0cnVlO1xuICAgICAgY29uc29sZS5lcnJvcignKG5vZGUpIHdhcm5pbmc6IHBvc3NpYmxlIEV2ZW50RW1pdHRlciBtZW1vcnkgJyArXG4gICAgICAgICAgICAgICAgICAgICdsZWFrIGRldGVjdGVkLiAlZCBsaXN0ZW5lcnMgYWRkZWQuICcgK1xuICAgICAgICAgICAgICAgICAgICAnVXNlIGVtaXR0ZXIuc2V0TWF4TGlzdGVuZXJzKCkgdG8gaW5jcmVhc2UgbGltaXQuJyxcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fZXZlbnRzW3R5cGVdLmxlbmd0aCk7XG4gICAgICBpZiAodHlwZW9mIGNvbnNvbGUudHJhY2UgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgLy8gbm90IHN1cHBvcnRlZCBpbiBJRSAxMFxuICAgICAgICBjb25zb2xlLnRyYWNlKCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLm9uID0gRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5hZGRMaXN0ZW5lcjtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5vbmNlID0gZnVuY3Rpb24odHlwZSwgbGlzdGVuZXIpIHtcbiAgaWYgKCFpc0Z1bmN0aW9uKGxpc3RlbmVyKSlcbiAgICB0aHJvdyBUeXBlRXJyb3IoJ2xpc3RlbmVyIG11c3QgYmUgYSBmdW5jdGlvbicpO1xuXG4gIHZhciBmaXJlZCA9IGZhbHNlO1xuXG4gIGZ1bmN0aW9uIGcoKSB7XG4gICAgdGhpcy5yZW1vdmVMaXN0ZW5lcih0eXBlLCBnKTtcblxuICAgIGlmICghZmlyZWQpIHtcbiAgICAgIGZpcmVkID0gdHJ1ZTtcbiAgICAgIGxpc3RlbmVyLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgfVxuICB9XG5cbiAgZy5saXN0ZW5lciA9IGxpc3RlbmVyO1xuICB0aGlzLm9uKHR5cGUsIGcpO1xuXG4gIHJldHVybiB0aGlzO1xufTtcblxuLy8gZW1pdHMgYSAncmVtb3ZlTGlzdGVuZXInIGV2ZW50IGlmZiB0aGUgbGlzdGVuZXIgd2FzIHJlbW92ZWRcbkV2ZW50RW1pdHRlci5wcm90b3R5cGUucmVtb3ZlTGlzdGVuZXIgPSBmdW5jdGlvbih0eXBlLCBsaXN0ZW5lcikge1xuICB2YXIgbGlzdCwgcG9zaXRpb24sIGxlbmd0aCwgaTtcblxuICBpZiAoIWlzRnVuY3Rpb24obGlzdGVuZXIpKVxuICAgIHRocm93IFR5cGVFcnJvcignbGlzdGVuZXIgbXVzdCBiZSBhIGZ1bmN0aW9uJyk7XG5cbiAgaWYgKCF0aGlzLl9ldmVudHMgfHwgIXRoaXMuX2V2ZW50c1t0eXBlXSlcbiAgICByZXR1cm4gdGhpcztcblxuICBsaXN0ID0gdGhpcy5fZXZlbnRzW3R5cGVdO1xuICBsZW5ndGggPSBsaXN0Lmxlbmd0aDtcbiAgcG9zaXRpb24gPSAtMTtcblxuICBpZiAobGlzdCA9PT0gbGlzdGVuZXIgfHxcbiAgICAgIChpc0Z1bmN0aW9uKGxpc3QubGlzdGVuZXIpICYmIGxpc3QubGlzdGVuZXIgPT09IGxpc3RlbmVyKSkge1xuICAgIGRlbGV0ZSB0aGlzLl9ldmVudHNbdHlwZV07XG4gICAgaWYgKHRoaXMuX2V2ZW50cy5yZW1vdmVMaXN0ZW5lcilcbiAgICAgIHRoaXMuZW1pdCgncmVtb3ZlTGlzdGVuZXInLCB0eXBlLCBsaXN0ZW5lcik7XG5cbiAgfSBlbHNlIGlmIChpc09iamVjdChsaXN0KSkge1xuICAgIGZvciAoaSA9IGxlbmd0aDsgaS0tID4gMDspIHtcbiAgICAgIGlmIChsaXN0W2ldID09PSBsaXN0ZW5lciB8fFxuICAgICAgICAgIChsaXN0W2ldLmxpc3RlbmVyICYmIGxpc3RbaV0ubGlzdGVuZXIgPT09IGxpc3RlbmVyKSkge1xuICAgICAgICBwb3NpdGlvbiA9IGk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChwb3NpdGlvbiA8IDApXG4gICAgICByZXR1cm4gdGhpcztcblxuICAgIGlmIChsaXN0Lmxlbmd0aCA9PT0gMSkge1xuICAgICAgbGlzdC5sZW5ndGggPSAwO1xuICAgICAgZGVsZXRlIHRoaXMuX2V2ZW50c1t0eXBlXTtcbiAgICB9IGVsc2Uge1xuICAgICAgbGlzdC5zcGxpY2UocG9zaXRpb24sIDEpO1xuICAgIH1cblxuICAgIGlmICh0aGlzLl9ldmVudHMucmVtb3ZlTGlzdGVuZXIpXG4gICAgICB0aGlzLmVtaXQoJ3JlbW92ZUxpc3RlbmVyJywgdHlwZSwgbGlzdGVuZXIpO1xuICB9XG5cbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLnJlbW92ZUFsbExpc3RlbmVycyA9IGZ1bmN0aW9uKHR5cGUpIHtcbiAgdmFyIGtleSwgbGlzdGVuZXJzO1xuXG4gIGlmICghdGhpcy5fZXZlbnRzKVxuICAgIHJldHVybiB0aGlzO1xuXG4gIC8vIG5vdCBsaXN0ZW5pbmcgZm9yIHJlbW92ZUxpc3RlbmVyLCBubyBuZWVkIHRvIGVtaXRcbiAgaWYgKCF0aGlzLl9ldmVudHMucmVtb3ZlTGlzdGVuZXIpIHtcbiAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMClcbiAgICAgIHRoaXMuX2V2ZW50cyA9IHt9O1xuICAgIGVsc2UgaWYgKHRoaXMuX2V2ZW50c1t0eXBlXSlcbiAgICAgIGRlbGV0ZSB0aGlzLl9ldmVudHNbdHlwZV07XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvLyBlbWl0IHJlbW92ZUxpc3RlbmVyIGZvciBhbGwgbGlzdGVuZXJzIG9uIGFsbCBldmVudHNcbiAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPT09IDApIHtcbiAgICBmb3IgKGtleSBpbiB0aGlzLl9ldmVudHMpIHtcbiAgICAgIGlmIChrZXkgPT09ICdyZW1vdmVMaXN0ZW5lcicpIGNvbnRpbnVlO1xuICAgICAgdGhpcy5yZW1vdmVBbGxMaXN0ZW5lcnMoa2V5KTtcbiAgICB9XG4gICAgdGhpcy5yZW1vdmVBbGxMaXN0ZW5lcnMoJ3JlbW92ZUxpc3RlbmVyJyk7XG4gICAgdGhpcy5fZXZlbnRzID0ge307XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICBsaXN0ZW5lcnMgPSB0aGlzLl9ldmVudHNbdHlwZV07XG5cbiAgaWYgKGlzRnVuY3Rpb24obGlzdGVuZXJzKSkge1xuICAgIHRoaXMucmVtb3ZlTGlzdGVuZXIodHlwZSwgbGlzdGVuZXJzKTtcbiAgfSBlbHNlIHtcbiAgICAvLyBMSUZPIG9yZGVyXG4gICAgd2hpbGUgKGxpc3RlbmVycy5sZW5ndGgpXG4gICAgICB0aGlzLnJlbW92ZUxpc3RlbmVyKHR5cGUsIGxpc3RlbmVyc1tsaXN0ZW5lcnMubGVuZ3RoIC0gMV0pO1xuICB9XG4gIGRlbGV0ZSB0aGlzLl9ldmVudHNbdHlwZV07XG5cbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLmxpc3RlbmVycyA9IGZ1bmN0aW9uKHR5cGUpIHtcbiAgdmFyIHJldDtcbiAgaWYgKCF0aGlzLl9ldmVudHMgfHwgIXRoaXMuX2V2ZW50c1t0eXBlXSlcbiAgICByZXQgPSBbXTtcbiAgZWxzZSBpZiAoaXNGdW5jdGlvbih0aGlzLl9ldmVudHNbdHlwZV0pKVxuICAgIHJldCA9IFt0aGlzLl9ldmVudHNbdHlwZV1dO1xuICBlbHNlXG4gICAgcmV0ID0gdGhpcy5fZXZlbnRzW3R5cGVdLnNsaWNlKCk7XG4gIHJldHVybiByZXQ7XG59O1xuXG5FdmVudEVtaXR0ZXIubGlzdGVuZXJDb3VudCA9IGZ1bmN0aW9uKGVtaXR0ZXIsIHR5cGUpIHtcbiAgdmFyIHJldDtcbiAgaWYgKCFlbWl0dGVyLl9ldmVudHMgfHwgIWVtaXR0ZXIuX2V2ZW50c1t0eXBlXSlcbiAgICByZXQgPSAwO1xuICBlbHNlIGlmIChpc0Z1bmN0aW9uKGVtaXR0ZXIuX2V2ZW50c1t0eXBlXSkpXG4gICAgcmV0ID0gMTtcbiAgZWxzZVxuICAgIHJldCA9IGVtaXR0ZXIuX2V2ZW50c1t0eXBlXS5sZW5ndGg7XG4gIHJldHVybiByZXQ7XG59O1xuXG5mdW5jdGlvbiBpc0Z1bmN0aW9uKGFyZykge1xuICByZXR1cm4gdHlwZW9mIGFyZyA9PT0gJ2Z1bmN0aW9uJztcbn1cblxuZnVuY3Rpb24gaXNOdW1iZXIoYXJnKSB7XG4gIHJldHVybiB0eXBlb2YgYXJnID09PSAnbnVtYmVyJztcbn1cblxuZnVuY3Rpb24gaXNPYmplY3QoYXJnKSB7XG4gIHJldHVybiB0eXBlb2YgYXJnID09PSAnb2JqZWN0JyAmJiBhcmcgIT09IG51bGw7XG59XG5cbmZ1bmN0aW9uIGlzVW5kZWZpbmVkKGFyZykge1xuICByZXR1cm4gYXJnID09PSB2b2lkIDA7XG59XG4iLCIvLyBzaGltIGZvciB1c2luZyBwcm9jZXNzIGluIGJyb3dzZXJcblxudmFyIHByb2Nlc3MgPSBtb2R1bGUuZXhwb3J0cyA9IHt9O1xudmFyIHF1ZXVlID0gW107XG52YXIgZHJhaW5pbmcgPSBmYWxzZTtcblxuZnVuY3Rpb24gZHJhaW5RdWV1ZSgpIHtcbiAgICBpZiAoZHJhaW5pbmcpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBkcmFpbmluZyA9IHRydWU7XG4gICAgdmFyIGN1cnJlbnRRdWV1ZTtcbiAgICB2YXIgbGVuID0gcXVldWUubGVuZ3RoO1xuICAgIHdoaWxlKGxlbikge1xuICAgICAgICBjdXJyZW50UXVldWUgPSBxdWV1ZTtcbiAgICAgICAgcXVldWUgPSBbXTtcbiAgICAgICAgdmFyIGkgPSAtMTtcbiAgICAgICAgd2hpbGUgKCsraSA8IGxlbikge1xuICAgICAgICAgICAgY3VycmVudFF1ZXVlW2ldKCk7XG4gICAgICAgIH1cbiAgICAgICAgbGVuID0gcXVldWUubGVuZ3RoO1xuICAgIH1cbiAgICBkcmFpbmluZyA9IGZhbHNlO1xufVxucHJvY2Vzcy5uZXh0VGljayA9IGZ1bmN0aW9uIChmdW4pIHtcbiAgICBxdWV1ZS5wdXNoKGZ1bik7XG4gICAgaWYgKCFkcmFpbmluZykge1xuICAgICAgICBzZXRUaW1lb3V0KGRyYWluUXVldWUsIDApO1xuICAgIH1cbn07XG5cbnByb2Nlc3MudGl0bGUgPSAnYnJvd3Nlcic7XG5wcm9jZXNzLmJyb3dzZXIgPSB0cnVlO1xucHJvY2Vzcy5lbnYgPSB7fTtcbnByb2Nlc3MuYXJndiA9IFtdO1xucHJvY2Vzcy52ZXJzaW9uID0gJyc7IC8vIGVtcHR5IHN0cmluZyB0byBhdm9pZCByZWdleHAgaXNzdWVzXG5wcm9jZXNzLnZlcnNpb25zID0ge307XG5cbmZ1bmN0aW9uIG5vb3AoKSB7fVxuXG5wcm9jZXNzLm9uID0gbm9vcDtcbnByb2Nlc3MuYWRkTGlzdGVuZXIgPSBub29wO1xucHJvY2Vzcy5vbmNlID0gbm9vcDtcbnByb2Nlc3Mub2ZmID0gbm9vcDtcbnByb2Nlc3MucmVtb3ZlTGlzdGVuZXIgPSBub29wO1xucHJvY2Vzcy5yZW1vdmVBbGxMaXN0ZW5lcnMgPSBub29wO1xucHJvY2Vzcy5lbWl0ID0gbm9vcDtcblxucHJvY2Vzcy5iaW5kaW5nID0gZnVuY3Rpb24gKG5hbWUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3Byb2Nlc3MuYmluZGluZyBpcyBub3Qgc3VwcG9ydGVkJyk7XG59O1xuXG4vLyBUT0RPKHNodHlsbWFuKVxucHJvY2Vzcy5jd2QgPSBmdW5jdGlvbiAoKSB7IHJldHVybiAnLycgfTtcbnByb2Nlc3MuY2hkaXIgPSBmdW5jdGlvbiAoZGlyKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdwcm9jZXNzLmNoZGlyIGlzIG5vdCBzdXBwb3J0ZWQnKTtcbn07XG5wcm9jZXNzLnVtYXNrID0gZnVuY3Rpb24oKSB7IHJldHVybiAwOyB9O1xuIl19
