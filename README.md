
rpc-multistream is similar to [rpc-stream](https://github.com/dominictarr/rpc-stream) but you can:

* Return streams from both sync and async remote functions
* Return multiple streams per call
* Have multiple callbacks per call
* Have infinite remote callback chains (like [dnode](https://github.com/substack/dnode))
* Mix and match efficient binary streams with text and objectMode streams.

rpc-multistream uses streams2 and [multiplex](https://github.com/maxogden/multiplex) under the hood, so is efficient for binary streams.

If you need authentication then check out [rpc-multiauth](https://github.com/biobricks/rpc-multiauth) which was written to work well with this library.

# Usage 

```javascript
var fs = require('fs');
var rpc = require('rpc-multistream');

var server = rpc({
  foo: rpc.syncStream(function() {
    return fs.createReadStream('foo.txt');
  }),
  bar: function(cb) {
    console.log("bar called");
    cb(null, "bar says hi");
  }
});

var client = rpc();

client.pipe(server).pipe(client)

client.on('methods', function(remote) {

  var stream = remote.foo();
  stream.on('data', function(data) {
    console.log(data);
  });

  remote.bar(function(err, msg) {
    console.log(msg);
  });
});
```

# Options

These are are the defaults:

```javascript
rpc({ ...methods... }, {

  init: true, // automatically send rpc methods manifest on instantiation
  encoding: 'utf8', // default encoding for streams
  objectMode: false, // default objectMode for streams
  explicit: true, // include encoding/objectMode even if they match defaults
  heartbeat: 0, // how often to send heartbeat. 0 disables
  maxMissedBeats: 3.5, // die after missing this many heartbeats
  debug: false, // Enable debug output
  flattenError: <function_or_false>, // function for serializing errors, or false
  expandError: <function>, // function for deserializing errors, or false
  onError: <function> // function to run on orphaned errors, or false
})
```

If you set init to false then the list of functions will not be sent and the remote end will not emit a 'methods' event until you call rpc.init().

The encoding and objectMode options will be used as for streams returned by synchronous-style calls unless you explicity define these per-stream. If you set the encoding and objectMode options to the same on both ends then all streams that have these options will forego sending the options across the stream, saving you bandwidth. If you don't set encoding and objectMode to the same on both ends then you _must_ set explicit to true (the default), which turns off this bandwidth-saving feature.

# Heartbeat

If `opts.heartbeat` is set to a positive integer then a heartbeat message will be sent out every `opts.heartbeat` milliseconds. The other endpoint will respond to this message immediately. Note that you need not enable heartbeat on both endpoints, though you can if you want the redundancy. When a heartbeat response is received then a 'heartbeat' event is emitted. If longer than `opts.heartbeat` * `opts.maxMissedBeats` passes without a heartbeat response, then at the next heartbeat interval a 'death' event is emitted. This does not affect any other behaviour and it is up to the user of this module to act on the death event. 

The heartbeat can be started or restarted after initialization with `.revive()` (which takes the same two heartbeat opts as the constructor). The heartbeat can be stopped with `.die()` and `.playDead(true/false)` can be used to stop/start responding to heartbeat requests. 

See `examples/heartbeat.js` for an example.

# Error handling

If an error occurs internally in rpc-multistream while calling a remote function, and the last argument to the remote function is a function, then that last-argument-function will be treated as the primary callback and will called with an error as first argument. Likewise if an uncaught exception occurs while calling a function with a callback then the exception will be converted to an error and passed as the first argument to the assumed callback. See examples/asyncException.js for a demonstation.

For synchronous calls that return one or more streams, an 'error' event is emitted on all streams.

By setting flattenError and expandError you can change how rpc-multistream serializes and deserializes error objects. The default results in an Error object with the original .message intact to be re-created on the remote end. Disable by setting both to false or overwrite with your own like so:

```javascript
var rpc = require('rpc-multistream');

var endpoint = rpc({ ... some methods ... }, {
  flattenError: function(err) {
    // prepare err before serialization here
    return err; 
  },
  expandError: function(err) {
    // process err after serialization here
    return err;
  }
});
```

Orphaned errors are errors where neither a callback nor a stream exists that can be used to report the error back to the caller. The default action is to emit an 'error' event on both ends of the parent rpc-multistream stream. Disable this by setting onError to false or overwrite with your own function like so:

```javascript
var rpc = require('rpc-multistream');

var endpoint = rpc({ ... some methods ... }, {
  onError: function(err) {

  }
});
```

# Static arguments

## .setStaticInArgs()

You can use `.setStaticInArgs()` to set one or more static arguments which will then be prepended to every incoming RPC call, e.g:

```javascript

var myRPC = rpc({
  test: function(myStaticArg, arg) {
    console.log(myStaticArg, arg)
  }
});

myRPC.setStaticInArgs('foo');
```

Now calling `remote.test('bar')` from the other endpoint will result in the output `foo bar`.

`.setStaticInArgs` is useful for saving connection-specific information in a way that makes it easily accessible to the RPC functions. E.g. one could set `stream.socket.remoteAddress` as a static input argument so RPC functions will always know which IP is making the call.


## .setStaticOutArgs()

You can use `.setStaticOutArgs()` to set one or more static arguments which will then be prepended to every outgoing RPC call, e.g:

```javascript

var server = rpc({
  test: function(myStaticArg, arg) {
    console.log(myStaticArg, arg)
  }
});

var client = rpc();
       
client.setStaticOutArgs('foo');
  
client.pipe(server).pipe(client);
  
client.on('methods', function(methods) {    
  methods.test('bar');
});
```

The server will then output `foo bar`.


# Bi-directional RPC

There is no difference between server and client: Both can call remote functions if remote end has specified any functions.

# Synchronous calls

If you declare a function with no wrapper then rpc-multistream assumes that is is an asynchronous function.

It is also possible to define functions that directly return only a stream by wrapping your functions using e.g:

```javascript
var server = rpc({
  foo: rpc.syncReadStream(function() {
    return fs.createReadStream('foo.txt');
  })
};
```

See examples/sync.js for a demo.

The following wrappers exist:

* rpc.syncStream: For functions returning a duplex stream
* rpc.syncReadStream: For functions returning a readable stream
* rpc.syncWriteStream: For functions returning a writable stream

It is _not_ possible to define synchronous functions that return something other than a stream. Why not? Because the function call would have to block until the server responded. For synchronous functions returning streams the streams are instantly created on the client and when the server creates the other endpoint of the stream at some later point in time the two streams are piped together.

For synchronous functions remote errors are reported via the returned stream emitting an error. This is true even if an exception occurs before the remote stream has been created. Here's how it works:

```javascript
var server = rpc({
  myFunc: rpc.syncReadStream(function() {
    throw new Error("I am an error!");
  })
});

// ... more code here ...

var stream = remote.myFunc()
stream.on('error', function(err) {
  console.error("Remote error:", err);
});
```

# Per stream options

For streams returned via callbacks it will be auto-detected whether the stream is a readable, writable or duplex stream and both encoding and objectMode will be auto-detected and set correctly on both ends.

For streams returned via synchronous-style calling there is no way to know in advance what the remote stream options are going to be. If you do not specify any options then the encoding and objectMode from the parent rpc-multistream options will be used. Both `encoding` and `objectMode` can be explicitly specified on a per-stream basis like so:

```javascript
var server = rpc({
  foo: rpc.syncReadStream(function() {
    return fs.createReadStream('foo.txt');
  }, {
    encoding: 'utf8',
    objectMode: false
  })
};
```

# Gotchas 

Either both ends must agree on the following opts (as passed to rpc-multistream):

* encoding
* objectMode

or you must set explicit to true (the default). Setting explicit to true will cost more bandwidth since each call will include stream options even if they match your defaults.

The streams returns by async callbacks are currently all duplex streams, no matter if the original stream on the remote side was only a read or write stream.

If using synchronous calls then both RPC server and client cannot be in the same process or error reporting won't work. But why would you even use an RPC system in that situation in the first place?

# ToDo

* Add a way to bind arbitrary data accessible as .this from inside RPC functions
* Implement opts.detectEncoding and opts.detectStreamType
* Automatically close irrelevant ends of read/write streams
* Use pump everywhere instead of .pipe
* More unit tests

## More examples

* Multiple-callbacks per call
* Async call with multiple streams + client sending stream to server
* Calling remote callbacks from remote callbacks (turtles)

## Ideas for future versions

* Backpressure support

# Copyright and license

* Copyright 2020 renegade.bio
* Copyright 2016-2017 BioBrick Foundation
* Copyright 2014-2015 Marc Juul <npm@juul.io>

* License: AGPLv3 (full license text in `LICENSE` file)

