
onload = function(){
  var $ = function(id){return document.getElementById(id);};
  var urlInput = $('url');
  var docIdInput = $('docId');
  var submitButton = $('submit');
  var origVal = submitButton.value;
  var status = $('status');

  var done = function(){
    status.innerHTML = "OK";
  };

  var error = function(err){
    status.innerHTML = "Can't visualize document due to error (error: " + err.error + "; reason: " + err.reason + ")";
    done();
    return;
  };

  var initDB = function(callback){
    if (!urlInput.value || !docIdInput.value) return alert('Fill in the forms, please!');
    status.innerHTML = "working";
    var url = urlInput.value.replace(/^\s+|\s+$/g, '')
    var docId = docIdInput.value;
    var corsProxy = 'http://cors.io/';
    if($('cors').checked){
      name = corsProxy + url.replace(/^https?:\/\//, '');
    }else{
        name = url;
      }
      console.log(name, docId);
      Pouch(name, function(err, db){
        callback(err, db, docId);
      });
  };

  $('form').onsubmit = function(){
    initDB(function(err, db, docId){
      if(err){
        return error(err);
      }
      visualizeRevTree(db, docId, function(err, box){
        if(err){
          return error(err);
        }
        status.innerHTML = "OK";
        var svg = box.getElementsByTagName('svg')[0];
        svg.style.width = svg.getAttribute('viewBox').split(' ')[2] * 7 + 'px';
        svg.style.height = svg.getAttribute('viewBox').split(' ')[3] * 7 + 'px';
        svg.style.border = '2px solid';
        document.body.appendChild(box);
        done();
      });
    });
    return false;
  };

  $('export').onclick = function(){
    initDB(function(err, db, docId){
      db.get(docId, {revs: true, open_revs: "all"}, function(err, results){
        var docs = [];
        results.forEach(function(row){
          docs.push(row.ok);
        });
        console.log("Exported docs: ", JSON.stringify(docs));
        console.log("Pouchdb format: ", "db.bulkDocs({docs:"+JSON.stringify(docs)+"}, {new_edits:false}, function(err, res){})");
        done();
      });
    });
  };
}
