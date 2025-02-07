## Setup and Installation

### Prerequisites

- **Node.js** (version 14 or later)
- **npm** (Node Package Manager)
- A Google Cloud project with Gmail API enabled
- OAuth2 credentials (`credentials.json`) from the Google Cloud Console

### Steps

1. Clone the repository:
    ```bash
    git clone https://github.com/yourusername/mailmind.git
    cd mailmind
    ```

2. Install the dependencies:
    ```bash
    npm install
    ```

3. Add your Gmail API credentials:
    - Create a file named `credentials.json` in the project root directory with your OAuth2 credentials.

4. Run the server:
    ```bash
    npm start
    ```

5. Navigate to `http://localhost:3000` in your browser.

## Gmail API Setup

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project and enable the **Gmail API**.
3. Configure OAuth2 credentials and download the `credentials.json` file.
4. Place `credentials.json` in the root of your project.

## Usage

- **Login**: Go to the homepage and log in with your Google account.
- **Dashboard**: After logging in, you'll be redirected to the dashboard, where you'll see the subject of your most recent email.
- **Logout**: Use the "Logout" button to safely log out and clear your session.

## Project Structure

```plaintext
.
├── credentials.json      # OAuth2 credentials
├── index.js              # Main server file
├── public
│   ├── login.html        # Login page
│   └── dashboard.html    # Dashboard page
├── package.json          # Project configuration and dependencies
└── README.md             # Project documentation