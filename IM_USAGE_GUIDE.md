# IM Feature Usage Guide

## 📱 How to Add Friends and Start Chatting

### Method 1: Add from Direct Messages Page

1. **Enter Direct Messages Page**
   - Click the "Direct Messages" icon in the left main navigation bar

2. **Click "New Message" Button**
   - There is a purple "New Message" button at the bottom of the direct messages list

3. **Search for Users**
   - In the pop-up dialog, enter username or email
   - The system will search for matching users in real-time

4. **Select User to Start Chat**
   - Click on the user you want to chat with
   - The system will automatically create a direct message channel and navigate to the chat interface

### Method 2: Add from Home Page

1. **On Home Page Sidebar**
   - There is a "+" button at the bottom of the purple sidebar on the left side of the home page

2. **Click the "+" Button**
   - The same user search dialog will appear
   - Subsequent steps are the same as Method 1

## 🏢 About Workspace

### Current Status

**Backend Supported (Database Level)**:

- ✅ Tenant/Workspace multi-tenancy architecture
- ✅ Workspace member management
- ✅ Workspace settings (plan, storage limits, etc.)

**Frontend Not Yet Implemented**:

- ❌ Workspace switching interface
- ❌ Create new Workspace
- ❌ Workspace settings management
- Currently hardcoded to display "Weight Watch"

### Database Structure

```
tenants table:
- id: Workspace ID
- name: Workspace name
- slug: URL slug
- domain: Custom domain
- plan: free/pro/enterprise
- settings: JSON configuration

tenant_members table:
- tenantId: Workspace the user belongs to
- userId: User ID
- role: owner/admin/member/guest
```

## 🔑 Core Features

### 1. Channels

**Public Channels**:

- Marked with # icon
- Visible to all Workspace members
- Can join/leave

**Private Channels**:

- Marked with 🔒 icon
- Only visible to invited members
- Requires admin invitation

### 2. Direct Messages

**How to Create**:

- Through user search dialog
- Click on user to create 1v1 chat

**Features**:

- Automatically detects if conversation already exists (avoids duplicates)
- Real-time online status display (green dot)
- Unread message notifications (red badge)

### 3. Real-time Communication

**WebSocket Features**:

- ✅ Real-time message push
- ✅ Online status synchronization
- ✅ Typing indicators
- ✅ Unread count updates
- ✅ Automatic reconnection mechanism

**Connection Timing**:

- Automatically connects after user login
- Automatically joins room when entering channel
- Automatically disconnects when leaving page

## 🎯 Usage Flow Examples

### Scenario: Start Chatting with a Colleague

1. Log into the system
2. Click "Direct Messages" to enter direct messages page (or from home page)
3. Click the "New Message" button at the bottom
4. Enter colleague's username, e.g., "zhangsan"
5. Click on the colleague in the search results
6. System creates direct message channel and navigates
7. Enter message in input box and click "Send"
8. The other party will receive message in real-time (if online)

### Scenario: View Channel Messages

1. See channel list on the left side of home page
2. Click the channel you want to view (e.g., "#revenues")
3. View message history
4. Scroll to top to load more historical messages
5. Enter new message to participate in discussion

## 🔧 Technical Implementation

### API Endpoints

```
Channel Management:
GET    /v1/im/channels                    - Get channel list
POST   /v1/im/channels/direct/:userId     - Create direct message
GET    /v1/im/channels/:id/messages       - Get messages

User Search:
GET    /v1/im/users?q=<query>             - Search users
GET    /v1/im/users/online                - Get online users

Real-time Communication:
WebSocket: /im                            - WebSocket connection
```

### Frontend Components

```
NewMessageDialog       - User search dialog
HomeSubSidebar        - Home page channel list (including direct messages list)
MessagesSubSidebar    - Direct messages dedicated list
ChannelView           - Channel/direct message chat interface
```

## ⚠️ Important Notes

1. **Users Must Be in the Same Workspace**
   - Currently can only search users within the same Workspace
   - Cross-Workspace chat is not yet supported

2. **Search Requires at Least One Character**
   - Empty search will not return results
   - Supports fuzzy matching on username and email

3. **Direct Message Channel Auto-Deduplication**
   - If conversation already exists, will return existing channel directly
   - Will not create duplicate direct message channels

4. **WebSocket Reconnection**
   - Will automatically attempt to reconnect after network disconnection
   - Maximum of 5 retry attempts
   - After successful reconnection, will automatically rejoin channels

## 🚀 Next Steps and Improvement Suggestions

### Short-term (1-2 weeks)

1. **Improve Direct Message Experience**
   - [ ] Display real name of the other party (instead of channel name)
   - [ ] Display last message preview
   - [ ] Message timestamp optimization

2. **User Search Optimization**
   - [ ] Add recent contacts
   - [ ] Search history
   - [ ] User status filtering

### Mid-term (1-2 months)

3. **Workspace Management**
   - [ ] Workspace switching interface
   - [ ] Create new Workspace
   - [ ] Member invitation feature
   - [ ] Workspace settings page

4. **Enhanced Channel Features**
   - [ ] Create public/private channels
   - [ ] Channel member management
   - [ ] Channel permission control

### Long-term (3-6 months)

5. **Advanced Features**
   - [ ] Message search
   - [ ] File upload and sharing
   - [ ] Voice/video calls
   - [ ] Message notification settings
   - [ ] Theme customization

## 📞 Need Help?

If you encounter problems:

1. Check browser console for errors
2. Verify WebSocket connection is successful (check `[WS]` logs)
3. Verify backend service is running normally
4. Check that environment variable `VITE_API_BASE_URL` is configured correctly
