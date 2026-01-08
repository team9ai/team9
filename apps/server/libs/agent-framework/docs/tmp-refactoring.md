我想对agent-framework进行一个重构。
主要是将Component的接口扩展，大部分功能以Component为核心进行组织（比如Todo，Agent，Workflow等等）。Component是蓝图层和逻辑层，chunk作为数据层、运行时层的概念。Component在agent初始化时指定（以及配置初始数据），以此生成初始chunk。同时，Component提供chunk渲染成大模型可读的内容的方式（渲染到system prompt（不变部分（在前），可变部分？（在后），有个order排序）、还是在后面的UserPrompt？）。Component同时还会提供对应的Operation、Reducer、Event。
Component可以在执行的时候热拔插。Component也可以外部传入。
