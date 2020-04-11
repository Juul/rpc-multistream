var rpc = require('../')
var test = require('tape')

test('setStaticOutArgs', function (t) {

  t.plan(1)

  var server = rpc({
    test: function(staticArg1, staticArg2, normalArg, cb) {
      cb(null, staticArg1+' '+staticArg2+' '+normalArg);
    }
  });

  var client = rpc();
  
  client.setStaticOutArgs('foo', 'bar');
  
  client.pipe(server).pipe(client);
  
  client.on('methods', function(methods) {
    
    methods.test('baz', function(err, msg) {
      if(err) console.error("Error:", err);
      t.equal(msg, 'foo bar baz')
    });
  });

})
