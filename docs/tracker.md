我想做一个叫task_tracker的REST微服务（nestjs）。用于追踪各种长任务的信息。
位置在apps/server/apps/task-tracker
配置的资源有一个Redis（但是要注意命名空间隔离，比如key前加team9:tracker:），一个postgres数据库。
分别有几个接口：

1. 注册任务，传入task_id(可选，没有自动生成cuid)，taskType string，可选的初始参数(json)等元信息（还有包括超时时间，默认24小时），存入postgres数据库。默认状态是pending。
2. 更新任务状态，传入任务id，状态（进行中（手动接取），完成，失败，手动超时），当前workerId，分别有post接口。完成和失败被调用时，需要上传具体的result json和error json，会自动将redis中保存的历史任务进度（每一个任务进度都是一个有seqId的json对象）数组、任务结果和新状态一起持久化到postgres数据库，然后删除redis中的任务进度缓存数组，通知订阅sse追踪的相关方更新的任务状态，并关闭连接。
3. 查询任务状态，传入任务id，返回任务的当前状态，结果，元信息等。
4. 更新任务进度，传入任务id，发送的更新信息object(如果没有会自动添加需要包含seqId，默认为顺序递增的数字)，存入redis中(增加原有json数组)并发送给追踪方。
5. 追踪任务进度：sse推送。如果任务已完成或失败，直接返回数据库中存储的历史任务进度，结束连接。如果任务在等待或者进行中，则从redis中读取最新的任务进度并推送给客户端，直到任务完成或失败为止。
6. 预留超时检测接口：当任务超时后调用，更新所有超时的任务状态为超时，并持久化当前进度到postgres数据库，删除redis中的任务进度缓存。
7. 接取任务，传入worker可接取的taskType数组、当前workerId。返回接取到的任务。
8. 释放任务，传入workerId和taskId，只有当前workerId和任务绑定的workerId一致时才允许释放，释放后任务状态变为pending，可以被其他worker接取。
9. 重试任务：创建一个新的任务，内容和原任务一致，记录原任务，状态为pending，返回新的taskId。
