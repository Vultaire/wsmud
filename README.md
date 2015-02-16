WSMud - A WebSockets-based MUD client
=====================================

This is still under development and is being worked on casually as I
find spare time.  Don't use it for anything serious yet.  :)

The main target for this is for use with Aardwolf MUD.  Intended
feature sets have this in mind.

To use:

* If the MUD in question does not have a working WebSockets port,
  launch a WebSockets proxy server.  I've written one (a simple/buggy
  one which seems good enough for dev purposes) for Python 2.7.x which
  is available here: https://github.com/Vultaire/websocket_proxy

* Run "npm install".  (Assumes node.js and npm are installed and on
  the PATH.  This is not a node.js project; I simply use node for a
  little of its infrastructure and for a simple HTTP server.)

* Run "npm run serve".  This will launch the web server on port 8080.

* Navigate to http://localhost:8080/.

At the time of writing, only Google Chrome works properly.  However,
the client does work at a basic level.  Note that any telnet codes are
not yet handled, but they are logged in the JavaScript console.
