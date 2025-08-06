import express from 'express';
import cors from 'cors';

const aperiumExpress = () => {
  const app = express();
  app.use(express.json());
  app.use(cors());

  const router = express.Router;

  const startServer = (port = 8000) => {
    app.listen(port, () => {
      console.log(`Server is running on http://localhost:${port}`);
    });
  };

  return { app, startServer, router };
};

export default aperiumExpress;
