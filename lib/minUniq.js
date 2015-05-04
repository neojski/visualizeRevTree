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
