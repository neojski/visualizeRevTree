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
