// Live tests read their instance and credentials from `.env.test`; unit tests never need it.
import { config } from "dotenv";

config({ path: ".env.test", quiet: true });
