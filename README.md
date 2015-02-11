WSMud - A WebSockets-based MUD client
=====================================

This is still under development and is being worked on casually as I
find spare time.  Don't use it for anything serious yet.  :)

The main target for this is for use with Aardwolf MUD.  Intended
feature sets have this in mind.

To use with Aardwolf:

* Launch a WebSockets proxy server.  I've written one for Python 2.7.x
  which is available here: https://github.com/Vultaire/websocket_proxy

* Run "npm install".  (Assumes node.js and npm are installed and on
  the PATH.  This is not a node.js project; I simply use node for a
  little of its infrastructure and for a simple HTTP server.)

* Run "npm run serve".  This will launch the web server on port 8080.

* Navigate to http://localhost:8080/.

At the time of writing, input is done via the input box on the page,
and the MUD's output comes back through the console.  This will likely
change in the near future.
