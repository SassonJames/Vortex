const http = require('http');
const fs = require('fs');
const socketio = require('socket.io');

const backgroundImg = fs.readFileSync(`${__dirname}/../client/vortex.jpg`); // Load in the Background Image
const gemImg = fs.readFileSync(`${__dirname}/../client/gem.png`); // Load in the Gem Image

const port = process.env.PORT || process.env.NODE_PORT || 3000; // Connect through port 3000

// If I'm requesting one of the images, send it back
// Otherwise, I'm opening the page
const handler = (req, res) => {
  if (req.url === '/vortex.jpg') {
    res.writeHead(200, { 'Content-Type': 'image/jpg' });
    res.end(backgroundImg);
  } else if (req.url === '/gem.png') {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(gemImg);
  } else {
    fs.readFile(`${__dirname}/../client/index.html`, (err, data) => {
      // if err, throw it for now
      if (err) {
        throw err;
      }
      res.writeHead(200);
      res.end(data);
    });
  }
};

// start http server and get HTTP server instance
const app = http.createServer(handler);

// io Server
const io = socketio(app);

// start listening
app.listen(port);

const drawstack = []; // Array to hold the drawstack for players that join
const gems = []; // Array to hold the gems that players will collect
let numPlayers = 0; // Number of players currently in the game, used for gem generation

// When the socket connects, set up the events
io.on('connection', (socket) => {
  // Join the Room
  socket.join('room1');
  numPlayers++;

  // A color to keep track of players
  socket.color = null;

  // When a user launches their retriever, add it to the drawstack
  // Also set the socket's color to keep track of the user
  socket.on('addCircle', (data) => {
    drawstack.push(data);

    // This will let us delete the user's retriever if they leave while it is going
    socket.color = data.color;

    socket.broadcast.to('room1').emit('drawChange', drawstack);
  });

  // When they disconnect, leave the room
  // If they have their retriever set out, delete it and update the other players
  socket.on('disconnect', () => {
    socket.leave('room1');
    for (let i = 0; i < drawstack.length; i++) {
      if (socket.color === drawstack[i].color) {
        drawstack.splice(i, 1);
        socket.broadcast.to('room1').emit('drawChange', drawstack);
      }
    }
    numPlayers--;
  });
});

// The distance formula, useful for collisions with circles
const distance = (ax, ay, bx, by) => {
  const a = ax - bx;
  const b = ay - by;
  return Math.abs(Math.sqrt((a * a) + (b * b)));
};

// Velocity calculations for the vortex
// Keeps the balls slowly gravitating to the center
// while still moving them around wildly
const addVelocity = () => {
  if (drawstack.length !== 0) {
    // Vortex Velocity
    for (let i = 0; i < drawstack.length; i++) {
      const circle = drawstack[i];
      const distY = Math.abs(250 - circle.y);
      const distX = Math.abs(250 - circle.x);
      let ratY = 0;
      let ratX = 0;

      // This segment of if statements creates a ratio
      // This ratio determines how strongly the vortex
      // will pull the ball in a certain direction
      // Put simply, it evens out the vortex's gravity
      if (distY > distX) {
        ratX = distX / distY;
        ratY = 1 - ratX;
      } else {
        ratY = distY / distX;
        ratX = 1 - ratY;
      }
      if (circle.y > 250) {
        circle.vy -= 0.2 * ratY;
      } else {
        circle.vy += 0.2 * ratY;
      }
      if (circle.x > 250) {
        circle.vx -= 0.2 * ratX;
      } else {
        drawstack[i].vx += 0.2 * ratX;
      }

      // Dampen the balls velocity every update by just a little
      circle.vx *= 0.999;
      circle.vy *= 0.999;
      circle.x += circle.vx;
      circle.y += circle.vy;
    }

    // Emit the changes to everyone
    io.sockets.in('room1').emit('drawChange', drawstack);
  }
};

// Use the distance formula to see if any retrievers have collided with the
// eye of the storm (center of the vortex). If they have, remove them.
const checkWormHole = () => {
  if (drawstack.length !== 0) {
    for (let i = 0; i < drawstack.length; i++) {
      const circle = drawstack[i];
      if (distance(circle.x, circle.y, 250, 250) <= circle.radius * 2) {
        // Let everyone know that a ball is dismissed
        // The clients check if it is there's
        io.sockets.in('room1').emit('ballDismissed', circle);

        // Splice out the ball that was removed
        drawstack.splice(i, 1);

        // A ball was removed, we have to update the drawstack
        io.sockets.in('room1').emit('drawChange', drawstack);
      }
    }
  }
};

// Use the distance formula to see if any retrievers have collided with
// any of the gems. If they have, remove the gem and give the player
// who collided with it a point
const checkGems = () => {
  if (drawstack.length !== 0) {
    for (let i = 0; i < drawstack.length; i++) {
      for (let j = 0; j < gems.length; j++) {
        const circle = drawstack[i];
        const gem = gems[j];
        if (distance(circle.x, circle.y, gem.x * 0.1, gem.y * 0.1) <= circle.radius * 2) {
          // Let everyone know a gem was scored. The client
          // figures out if it was theirs
          io.sockets.in('room1').emit('scoredGem', circle);

          // Splice out the gem
          gems.splice(j, 1);

          // The gem count has changed, we have to update the gem draws
          io.sockets.in('room1').emit('gemsChange', gems);
        }
      }
    }
  }
};

// Each player brings with them 2 gems.
// If there is every less than twice as many
// gems as players, add gems until the number is met.
const generateGems = () => {
  const prevGems = gems.length;
  while (gems.length < numPlayers * 2) {
    const gem = {
      // The gem x and y look strange. They need to scale for the picture and draws to
      // work. Look at the Draw function in index.html for more information
      x: Math.floor((Math.random() * 4000) + 500),

      // The gem x and y look strange. They need to scale for the picture and draws to
      // work. Look at the Draw function in index.html for more information
      y: Math.floor((Math.random() * 4000) + 500),
    };
    gems.push(gem);
  }
  if (gems.length > prevGems) {
    // More gems were added, we have to update the gem draws
    io.sockets.in('room1').emit('gemsChange', gems);
  }
};

setInterval(addVelocity, 20); // Every 20 miliseconds, increase each retriever's velocity
setInterval(checkWormHole, 60); // Every 60 miliseconds, check to see if anyone fell in the wormhole
setInterval(checkGems, 40); // Every 40 miliseconds, check to see if anyone has collected a gem
setInterval(generateGems, 3000); // Every 3 seconds, refill the gem count
